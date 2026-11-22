import test from 'node:test'
import assert from 'node:assert/strict'
import documents from '../../extension/lib/documents.js'

const ROOT = 'C:\\ws'

function fakeDoc(fsPath, text, { version = 1, isDirty = false } = {}) {
  return {
    uri: { fsPath, scheme: 'file' },
    version,
    isDirty,
    getText: () => text,
    positionAt: (offset) => ({ offset }),
    save: async () => true,
  }
}

function fakeVscode(docs, { outside = false } = {}) {
  const applied = []
  let appliedCount = 0
  return {
    applied,
    get appliedCount() { return appliedCount },
    Uri: { file: (fsPath) => ({ fsPath, scheme: 'file' }) },
    Range: class { constructor(start, end) { this.start = start; this.end = end } },
    WorkspaceEdit: class {
      replace(uri, range, text) { applied.push({ fsPath: uri.fsPath, range, text }) }
    },
    workspace: {
      getWorkspaceFolder: () => (outside ? undefined : { uri: { fsPath: ROOT } }),
      openTextDocument: async (uri) => {
        const doc = docs[uri.fsPath]
        if (!doc) throw new Error(`cannot open ${uri.fsPath}`)
        return doc
      },
      applyEdit: async () => { appliedCount += 1; return true },
    },
  }
}

test('同一文件多个 edit 按位置从后往前应用，行号不位移', () => {
  const text = 'a\nb\nc\nd\n'
  const planned = documents.planEdits(text, [
    { start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, text: 'A' },
    { start: { line: 2, character: 0 }, end: { line: 2, character: 1 }, text: 'C' },
  ])
  assert.equal(documents.applyPlanned(text, planned), 'A\nb\nC\nd\n')
})

test('CRLF 行尾在只改内容区时保持不变', () => {
  const text = 'one\r\ntwo\r\n'
  const planned = documents.planEdits(text, [
    { start: { line: 1, character: 0 }, end: { line: 1, character: 3 }, text: 'TWO' },
  ])
  assert.equal(documents.applyPlanned(text, planned), 'one\r\nTWO\r\n')
})

test('fullText 与 range 互斥，同时给报 BAD_REQUEST', () => {
  assert.throws(
    () => documents.planEdits('x', [{ fullText: 'y', start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, text: 'z' }]),
    (error) => error.code === 'BAD_REQUEST',
  )
})

test('read 返回实时内容、版本号与 isDirty；磁盘已删也不报错', async () => {
  const doc = fakeDoc('C:\\ws\\a.py', 'dirty content', { version: 7, isDirty: true })
  const vscode = fakeVscode({ 'C:\\ws\\a.py': doc })
  const found = await documents.readDocuments({ vscode, fileExists: async () => false }, { paths: ['C:\\ws\\a.py'] })
  assert.equal(found.length, 1)
  assert.equal(found[0].text, 'dirty content')
  assert.equal(found[0].version, 7)
  assert.equal(found[0].isDirty, true)
  assert.equal(found[0].existsOnDisk, false)
})

test('edit 的 baseVersion 与文档版本不一致时返回 conflict，不应用', async () => {
  const doc = fakeDoc('C:\\ws\\a.py', 'abc', { version: 9 })
  const vscode = fakeVscode({ 'C:\\ws\\a.py': doc })
  const result = await documents.applyEdits({ vscode }, {
    edits: [{ path: 'C:\\ws\\a.py', fullText: 'zzz', baseVersion: 3 }],
  })
  assert.equal(result[0].applied, false)
  assert.equal(result[0].conflict, true)
  assert.equal(vscode.appliedCount, 0)
})

test('edit 正常应用后写回全文并保存', async () => {
  let saved = 0
  const doc = fakeDoc('C:\\ws\\a.py', 'abc', { version: 4 })
  doc.save = async () => { saved += 1; return true }
  const vscode = fakeVscode({ 'C:\\ws\\a.py': doc })
  const result = await documents.applyEdits({ vscode }, {
    edits: [{ path: 'C:\\ws\\a.py', fullText: 'xyz', baseVersion: 4 }],
    save: true,
  })
  assert.equal(result[0].applied, true)
  assert.equal(result[0].saved, true)
  assert.equal(vscode.applied[0].text, 'xyz')
  assert.equal(saved, 1)
})

test('目标文件不在任何工作区文件夹内 → OUTSIDE_WINDOW', async () => {
  const doc = fakeDoc('D:\\outside\\a.py', 'abc')
  const vscode = fakeVscode({ 'D:\\outside\\a.py': doc }, { outside: true })
  await assert.rejects(
    documents.applyEdits({ vscode }, { edits: [{ path: 'D:\\outside\\a.py', fullText: 'x' }] }),
    (error) => error.code === 'OUTSIDE_WINDOW',
  )
})

test('文件不存在时用 fullText 创建', async () => {
  const written = []
  const vscode = fakeVscode({})
  vscode.workspace.fs = {
    stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    writeFile: async (uri, bytes) => { written.push([uri.fsPath, Buffer.from(bytes).toString('utf8')]) },
  }
  const result = await documents.applyEdits({ vscode }, {
    edits: [{ path: 'C:\\ws\\new.md', fullText: 'hello' }],
  })
  assert.equal(result[0].applied, true)
  assert.equal(result[0].created, true)
  assert.deepEqual(written, [['C:\\ws\\new.md', 'hello']])
  assert.equal(vscode.appliedCount, 0)
})

test('文件存在但打不开（二进制/被占用）时报 UNSUPPORTED，绝不覆盖', async () => {
  const written = []
  const vscode = fakeVscode({})
  vscode.workspace.fs = {
    stat: async () => ({ type: 1, size: 10 }),
    writeFile: async (uri, bytes) => { written.push([uri.fsPath, Buffer.from(bytes).toString('utf8')]) },
  }
  await assert.rejects(
    documents.applyEdits({ vscode }, { edits: [{ path: 'C:\\ws\\bin.dat', fullText: 'x' }] }),
    (error) => error.code === 'UNSUPPORTED',
  )
  assert.deepEqual(written, [])
})

test('diff 不给 after 时用当前文件内容做右侧', async () => {
  const store = documents.createDiffStore()
  const doc = fakeDoc('C:\\ws\\a.py', 'current text', { version: 2 })
  const calls = []
  const vscode = {
    Uri: {
      file: (fsPath) => ({ fsPath, toString: () => `file:///${fsPath}` }),
      parse: (value) => ({ toString: () => value }),
    },
    workspace: { openTextDocument: async () => doc, getWorkspaceFolder: () => ({}) },
    commands: { executeCommand: async (...args) => { calls.push(args) } },
  }
  await documents.openDiff({ vscode, store }, { path: 'C:\\ws\\a.py' })
  const rightUri = String(calls[0][2])
  const id = new URL(rightUri).searchParams.get('id')
  assert.equal(store.get(id), 'current text')
})

test('文件不存在且不是整文件写入时报错，不猜内容', async () => {
  const vscode = fakeVscode({})
  vscode.workspace.fs = {
    stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    writeFile: async () => undefined,
  }
  await assert.rejects(
    documents.applyEdits({ vscode }, {
      edits: [{ path: 'C:\\ws\\missing.md', start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, text: 'x' }],
    }),
    (error) => error.code === 'NOT_FOUND',
  )
})

test('中文与空格路径往返不变', async () => {
  const target = 'C:\\ws\\我的 项目\\a.py'
  const doc = fakeDoc(target, 'abc', { version: 2 })
  const vscode = fakeVscode({ [target]: doc })
  const result = await documents.applyEdits({ vscode }, { edits: [{ path: target, fullText: 'xyz', baseVersion: 2 }], save: false })
  assert.equal(result[0].path, target)
  assert.equal(vscode.applied[0].fsPath, target)
})
