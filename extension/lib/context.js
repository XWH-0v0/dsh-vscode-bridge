'use strict'

const MAX_ITEMS_PER_FILE = 50
const MAX_TOTAL_ITEMS = 200
const SEVERITY_NAMES = { 0: 'error', 1: 'warning', 2: 'information', 3: 'hint' }

function editorSummary(editor) {
  if (!editor) return null
  const doc = editor.document
  return {
    path: doc.uri?.fsPath ?? '',
    languageId: doc.languageId ?? '',
    lineCount: doc.lineCount ?? 0,
    isDirty: doc.isDirty === true,
  }
}

function activeEditor({ vscode }) {
  const editor = vscode.window.activeTextEditor
  if (!editor) return null
  const doc = editor.document
  return {
    ...editorSummary(editor),
    length: doc.getText().length,
    preview: doc.getText().slice(0, 2000),
  }
}

function selection({ vscode }) {
  const editor = vscode.window.activeTextEditor
  if (!editor) return { empty: true, editor: null }
  const range = editor.selection
  return {
    empty: range.isEmpty === true,
    text: range.text ?? '',
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
    editor: editorSummary(editor),
  }
}

function openEditors({ vscode }) {
  const activePath = vscode.window.activeTextEditor?.document?.uri?.fsPath
  const seen = new Map()
  for (const doc of vscode.workspace.textDocuments ?? []) {
    const scheme = doc.uri?.scheme
    // Git 扩展会打开 git: 虚拟文档（scm input / diff 副本），这些不是用户打开的文件
    if (scheme && scheme !== 'file') continue
    const filePath = doc.uri?.fsPath
    if (!filePath || seen.has(filePath)) continue
    seen.set(filePath, {
      path: filePath,
      languageId: doc.languageId ?? '',
      isActive: filePath === activePath,
      isDirty: doc.isDirty === true,
    })
  }
  return { editors: [...seen.values()] }
}

function diagnostics({ vscode }, { path: targetPath, severity } = {}) {
  const wanted = typeof severity === 'string' && severity.length > 0 ? severity.toLowerCase() : undefined
  const wantedPath = typeof targetPath === 'string' && targetPath.length > 0 ? targetPath.toLowerCase() : undefined
  const perFile = new Map()
  let total = 0

  for (const [uri, entries] of vscode.languages.getDiagnostics() ?? []) {
    const filePath = uri?.fsPath ?? String(uri)
    if (wantedPath && filePath.toLowerCase() !== wantedPath) continue
    for (const entry of entries ?? []) {
      const level = SEVERITY_NAMES[entry.severity] ?? 'information'
      if (wanted && level !== wanted) continue
      total += 1
      if (!perFile.has(filePath)) perFile.set(filePath, [])
      perFile.get(filePath).push({
        path: filePath,
        severity: level,
        message: entry.message,
        line: (entry.range?.start?.line ?? 0) + 1,
      })
    }
  }

  const items = []
  let truncated = false
  for (const [filePath, list] of perFile) {
    if (list.length > MAX_ITEMS_PER_FILE) truncated = true
    items.push(...list.slice(0, MAX_ITEMS_PER_FILE))
    if (items.length >= MAX_TOTAL_ITEMS) {
      truncated = true
      break
    }
    void filePath
  }

  return { total, truncated, items: items.slice(0, MAX_TOTAL_ITEMS) }
}

function workspaceFolders({ vscode }) {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    path: folder.uri.fsPath,
    name: folder.name ?? '',
  }))
  return { folders }
}

module.exports = {
  activeEditor,
  selection,
  openEditors,
  diagnostics,
  workspaceFolders,
  MAX_ITEMS_PER_FILE,
  MAX_TOTAL_ITEMS,
}
