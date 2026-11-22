import test from 'node:test'
import assert from 'node:assert/strict'
import context from '../../extension/lib/context.js'

function fakeEditor(fsPath, { text = '', selectionText = '' } = {}) {
  return {
    document: {
      uri: { fsPath },
      getText: () => text,
      lineCount: text.split('\n').length,
      languageId: 'python',
      isDirty: false,
    },
    selection: {
      isEmpty: selectionText.length === 0,
      text: selectionText,
      start: { line: 1, character: 0 },
      end: { line: 2, character: 3 },
    },
  }
}

function fakeVscode({ active, editors = [], diagnostics = [], folders = [] } = {}) {
  return {
    window: { activeTextEditor: active, visibleTextEditors: editors },
    workspace: {
      workspaceFolders: folders.map((fsPath) => ({ uri: { fsPath }, name: fsPath.split('\\').pop() })),
      textDocuments: editors.map((editor) => editor.document),
    },
    languages: { getDiagnostics: () => diagnostics },
    Uri: { file: (fsPath) => ({ fsPath, toString: () => `file:///${fsPath}` }) },
  }
}

test('没有活动编辑器时 selection 返回 empty', () => {
  const value = context.selection({ vscode: fakeVscode({}) })
  assert.equal(value.empty, true)
  assert.equal(value.editor, null)
})

test('selection 返回选中的文本与范围', () => {
  const editor = fakeEditor('C:\\ws\\a.py', { text: 'print(1)', selectionText: 'print' })
  const value = context.selection({ vscode: fakeVscode({ active: editor }) })
  assert.equal(value.empty, false)
  assert.equal(value.text, 'print')
  assert.equal(value.editor.path, 'C:\\ws\\a.py')
})

test('diagnostics 按严重级过滤并按文件截断', () => {
  const diagnostics = []
  for (let index = 0; index < 80; index += 1) {
    diagnostics.push([[{ fsPath: 'C:\\ws\\a.py' }], [{
      severity: index < 60 ? 0 : 1,
      message: `m${index}`,
      range: { start: { line: index, character: 0 } },
    }]])
  }
  const value = context.diagnostics(
    { vscode: fakeVscode({ diagnostics }) },
    { severity: 'error' },
  )
  assert.equal(value.total, 60)
  assert.equal(value.items.length, context.MAX_ITEMS_PER_FILE)
  assert.equal(value.truncated, true)
  assert.ok(value.items.every((item) => item.severity === 'error'))
})

test('openEditors 去重并标记活动与脏状态', () => {
  const active = fakeEditor('C:\\ws\\a.py', { text: 'x' })
  active.document.isDirty = true
  const value = context.openEditors({ vscode: fakeVscode({ active, editors: [active, active] }) })
  assert.equal(value.editors.length, 1)
  assert.equal(value.editors[0].isActive, true)
  assert.equal(value.editors[0].isDirty, true)
})

test('open_editors 过滤掉 Git 等非文件虚拟文档', () => {
  const real = fakeEditor('C:\\ws\\a.py', { text: 'x' })
  const scmInput = {
    document: { uri: { scheme: 'git', fsPath: 'git\\scm0\\input' }, languageId: 'scminput', getText: () => '', lineCount: 1, isDirty: false },
    selection: { isEmpty: true, text: '', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  }
  const vscode = {
    window: { activeTextEditor: real, visibleTextEditors: [real, scmInput] },
    workspace: { textDocuments: [real.document, scmInput.document], workspaceFolders: [] },
    languages: { getDiagnostics: () => [] },
  }
  const value = context.openEditors({ vscode })
  assert.deepEqual(value.editors.map((editor) => editor.path), ['C:\\ws\\a.py'])
})

test('workspaceFolders 返回文件夹与仓库根', () => {
  const value = context.workspaceFolders({ vscode: fakeVscode({ folders: ['C:\\ws\\a', 'C:\\ws\\b'] }) })
  assert.deepEqual(value.folders.map((folder) => folder.path), ['C:\\ws\\a', 'C:\\ws\\b'])
  assert.deepEqual(value.folders.map((folder) => folder.name), ['a', 'b'])
})

test('activeEditor 无编辑器时返回 null', () => {
  assert.equal(context.activeEditor({ vscode: fakeVscode({}) }), null)
})
