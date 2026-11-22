'use strict'

const nodePath = require('node:path')

const MAX_READ_CHARS = 200 * 1024

function codedError(code, message, detail) {
  const error = new Error(message)
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

function offsetOf(text, position) {
  const line = Math.max(0, Number(position?.line) || 0)
  const character = Math.max(0, Number(position?.character) || 0)
  let offset = 0
  for (let current = 0; current < line; current += 1) {
    const nextLineBreak = text.indexOf('\n', offset)
    if (nextLineBreak === -1) return text.length
    offset = nextLineBreak + 1
  }
  return Math.min(text.length, offset + character)
}

/** 把一组编辑规划成"降序的应用计划"；同一批编辑基于同一份原文。 */
function planEdits(text, edits) {
  const planned = []
  for (const edit of edits ?? []) {
    const hasRange = edit?.start !== undefined || edit?.end !== undefined
    if (hasRange && edit?.fullText !== undefined) {
      throw codedError('BAD_REQUEST', '同一处编辑不能同时给 range 和 fullText')
    }
    if (edit?.fullText !== undefined) {
      planned.push({ start: 0, end: text.length, text: String(edit.fullText) })
      continue
    }
    if (edit?.start === undefined || edit?.end === undefined) {
      throw codedError('BAD_REQUEST', '编辑要么给 fullText，要么同时给 start 与 end')
    }
    const start = offsetOf(text, edit.start)
    const end = offsetOf(text, edit.end)
    if (end < start) throw codedError('BAD_REQUEST', 'range 的 end 在 start 之前')
    planned.push({ start, end, text: String(edit.text ?? '') })
  }
  planned.sort((a, b) => b.start - a.start || b.end - a.end)
  let nextStart = text.length + 1
  for (const item of planned) {
    if (item.end > nextStart) throw codedError('BAD_REQUEST', '同一文件的多处编辑区间重叠')
    nextStart = item.start
  }
  return planned
}

function applyPlanned(text, planned) {
  let output = text
  for (const item of planned) {
    output = output.slice(0, item.start) + item.text + output.slice(item.end)
  }
  return output
}

function sliceRange(text, range) {
  const start = offsetOf(text, range.start)
  const end = offsetOf(text, range.end)
  return text.slice(start, Math.max(start, end))
}

function truncateRead(text) {
  if (text.length <= MAX_READ_CHARS) return { text, truncated: false }
  return { text: `${text.slice(0, MAX_READ_CHARS)}\n…（内容已截断，共 ${text.length} 字符）`, truncated: true }
}

async function openDoc(vscode, target) {
  try {
    return await vscode.workspace.openTextDocument(vscode.Uri.file(target))
  } catch (error) {
    const message = String(error?.message ?? error)
    // VSCode 对"不存在"和"存在但打不开（二进制/超大/被占用/无权限）"都会抛错，
    // 必须区分开：后者绝不能被当成"新建文件"而覆盖原内容。
    const missing = /cannot open|FileNotFound|ENOENT|不存在|无法读取文件/i.test(message)
    throw codedError(missing ? 'NOT_FOUND' : 'UNSUPPORTED', `打不开文件：${target}（${message}）`)
  }
}

async function filePresent(vscode, uri) {
  const fsApi = vscode.workspace.fs
  if (!fsApi || typeof fsApi.stat !== 'function') return true
  try {
    await fsApi.stat(uri)
    return true
  } catch {
    return false
  }
}

async function readDocuments({ vscode, fileExists }, { paths, range } = {}) {
  const list = Array.isArray(paths) ? paths.filter((item) => typeof item === 'string' && item.length > 0) : []
  if (list.length === 0) throw codedError('BAD_REQUEST', 'read 需要至少一个路径')

  const results = []
  for (const target of list) {
    const doc = await openDoc(vscode, target)
    const content = range ? sliceRange(doc.getText(), range) : doc.getText()
    const parsed = truncateRead(content)
    let existsOnDisk = true
    if (typeof fileExists === 'function') {
      try {
        existsOnDisk = await fileExists(target)
      } catch {
        existsOnDisk = true
      }
    }
    results.push({
      path: target,
      text: parsed.text,
      truncated: parsed.truncated,
      version: doc.version,
      isDirty: doc.isDirty === true,
      existsOnDisk,
    })
  }
  return results
}

/**
 * 批量应用编辑。同一文件先算出最终全文，再一次替换整个文档：
 * 可单步撤销，且不会因为行号位移写错位置。
 */
async function applyEdits({ vscode, defaultSave = true }, { edits, save, format } = {}) {
  const groups = new Map()
  for (const edit of edits ?? []) {
    if (typeof edit?.path !== 'string' || edit.path.length === 0) {
      throw codedError('BAD_REQUEST', '每个编辑都需要 path')
    }
    if (!groups.has(edit.path)) groups.set(edit.path, [])
    groups.get(edit.path).push(edit)
  }
  if (groups.size === 0) throw codedError('BAD_REQUEST', '没有任何编辑')

  const workspaceEdit = new vscode.WorkspaceEdit()
  const pending = []
  const results = []

  for (const [target, list] of groups) {
    const uri = vscode.Uri.file(target)
    if (typeof vscode.workspace.getWorkspaceFolder === 'function' && !vscode.workspace.getWorkspaceFolder(uri)) {
      throw codedError('OUTSIDE_WINDOW', `不在当前 VSCode 窗口的文件夹里：${target}`)
    }
    let doc
    const canCreate = list.length === 1 && list[0].fullText !== undefined
    const present = await filePresent(vscode, uri)
    if (canCreate && !present) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(String(list[0].fullText), 'utf8'))
      results.push({ path: target, applied: true, created: true, version: 1, saved: true })
      continue
    }
    try {
      doc = await openDoc(vscode, target)
    } catch (error) {
      // 文件明明存在却打不开：不能当成新建，直接报错交给用户判断
      if (present && error?.code === 'NOT_FOUND') {
        throw codedError('UNSUPPORTED', error.message)
      }
      throw error
    }
    const baseVersions = list.map((item) => item.baseVersion).filter((value) => typeof value === 'number')
    if (baseVersions.length > 0 && baseVersions.some((value) => value !== doc.version)) {
      results.push({ path: target, applied: false, conflict: true, version: doc.version })
      continue
    }
    const text = doc.getText()
    const next = applyPlanned(text, planEdits(text, list))
    workspaceEdit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), next)
    pending.push({ target, doc })
    results.push({ path: target, applied: true, version: doc.version + 1, saved: false })
  }

  if (pending.length === 0) return results

  const applied = await vscode.workspace.applyEdit(workspaceEdit)
  if (!applied) throw codedError('INTERNAL', 'VSCode 拒绝了这次编辑')

  const shouldSave = save !== false && defaultSave !== false
  if (shouldSave) {
    for (const item of pending) {
      try {
        await item.doc.save?.()
      } catch {
        // 保存失败不影响编辑已生效这一事实，结果里 saved 会体现
      }
    }
  }
  for (const result of results) {
    if (result.applied) result.saved = shouldSave
  }
  if (format === true) {
    await vscode.commands?.executeCommand?.('editor.action.formatDocument')
  }
  return results
}

async function openDocument({ vscode }, { path: target, line, column } = {}) {
  const doc = await openDoc(vscode, target)
  const position = line !== undefined
    ? new vscode.Position(Math.max(0, Number(line) - 1), Math.max(0, Number(column ?? 1) - 1))
    : undefined
  await vscode.window.showTextDocument(doc, position ? { selection: new vscode.Range(position, position) } : undefined)
  return { path: target, line: line ?? null, uri: doc.uri?.fsPath ?? target }
}

/** 用自建虚拟文档打开 before/after 对比。 */
async function openDiff({ vscode, store }, { path: target, before, after, ref } = {}) {
  if (typeof target !== 'string' || target.length === 0) {
    throw codedError('BAD_REQUEST', 'diff 需要 path')
  }
  const hasRef = typeof ref === 'string' && ref.length > 0
  // 不给 after 就用当前内容：否则右侧会是空文档，看起来像整个文件被删了
  let afterText = after
  if (afterText === undefined || afterText === null) {
    const doc = await openDoc(vscode, target)
    afterText = doc.getText()
  }
  const name = encodeURI(nodePath.basename(target))
  const left = hasRef
    ? vscode.Uri.file(target).with({ scheme: 'git', query: JSON.stringify({ path: target, ref }) })
    : vscode.Uri.parse(`dsh-bridge:${name}?id=${store.put(String(before ?? ''))}`)
  const right = vscode.Uri.parse(`dsh-bridge:${name}?id=${store.put(String(afterText))}`)
  const title = `${nodePath.basename(target)} ↔ ${hasRef ? ref : '现在'}`
  await vscode.commands.executeCommand('vscode.diff', left, right, title)
  return { title }
}

function createDiffStore() {
  let counter = 0
  const contents = new Map()
  return {
    put(text) {
      counter += 1
      const id = String(counter)
      contents.set(id, text)
      return id
    },
    get(id) {
      return contents.get(id) ?? ''
    },
    clear() {
      contents.clear()
    },
  }
}

function createDiffProvider(vscode, store) {
  return vscode.workspace.registerTextDocumentContentProvider('dsh-bridge', {
    provideTextDocumentContent(uri) {
      const id = new URL(uri.toString()).searchParams.get('id')
      return store.get(id)
    },
  })
}

module.exports = {
  planEdits,
  applyPlanned,
  offsetOf,
  readDocuments,
  applyEdits,
  openDocument,
  openDiff,
  createDiffStore,
  createDiffProvider,
  MAX_READ_CHARS,
}
