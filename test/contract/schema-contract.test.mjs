import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { validateValue } from './json-schema.mjs'
import { createTools } from '../../bundle/lib/tools.js'

const require = createRequire(import.meta.url)
const { createHandlers } = require('../../extension/lib/handlers.js')
const documents = require('../../extension/lib/documents.js')
const terminal = require('../../extension/lib/terminal.js')

function fakeDoc(fsPath, text) {
  return {
    uri: { fsPath, scheme: 'file' },
    version: 3,
    isDirty: false,
    getText: () => text,
    positionAt: (offset) => ({ offset }),
    save: async () => true,
  }
}

function fakeVscode() {
  const repo = {
    rootUri: { fsPath: 'C:\\ws' },
    state: { HEAD: { name: 'main', ahead: 0, behind: 0 }, workingTreeChanges: [], indexChanges: [] },
    add: async () => undefined,
    commit: async () => undefined,
    createBranch: async () => undefined,
    getBranches: async () => [{ name: 'main', type: 0 }],
    checkout: async () => undefined,
    fetch: async () => undefined,
    pull: async () => undefined,
    push: async () => undefined,
    log: async () => [{ hash: 'h1', message: 'm', authorName: 'dev', authorDate: new Date('2026-01-01T00:00:00Z') }],
    diffWithHEAD: async () => '',
    getConfig: async () => 'dev',
  }

  let endListener
  const terminalInstance = {
    name: 'DSH: t',
    show() {},
    shellIntegration: { executeCommand: () => terminalExecution },
  }
  const terminalExecution = {
    commandLine: 'echo hi',
    async *read() { yield 'ok\n' },
  }

  const vscode = {
    version: '1.116.0',
    extensions: {
      getExtension: (id) => (id === 'vscode.git'
        ? { activate: async () => undefined, exports: { getAPI: () => ({ repositories: [repo] }) } }
        : undefined),
    },
    Uri: {
      file: (fsPath) => ({ fsPath, scheme: 'file', with: (patch) => ({ ...patch, fsPath }) }),
      parse: (value) => ({ toString: () => value }),
    },
    Range: class { constructor(start, end) { this.start = start; this.end = end } },
    Position: class { constructor(line, character) { this.line = line; this.character = character } },
    WorkspaceEdit: class { replace() {} },
    workspace: {
      name: 'ws',
      workspaceFolders: [{ uri: { fsPath: 'C:\\ws' }, name: 'ws' }],
      textDocuments: [fakeDoc('C:\\ws\\a.js', 'x')],
      openTextDocument: async (uri) => {
        if (String(uri.fsPath).includes('missing')) throw new Error('cannot open file')
        return fakeDoc(uri.fsPath, 'x')
      },
      getWorkspaceFolder: () => ({ uri: { fsPath: 'C:\\ws' } }),
      applyEdit: async () => true,
      fs: { stat: async () => ({}), writeFile: async () => undefined },
      registerTextDocumentContentProvider: () => ({ dispose() {} }),
    },
    window: {
      activeTextEditor: undefined,
      terminals: [],
      createTerminal: () => terminalInstance,
      showTextDocument: async () => undefined,
      onDidEndTerminalShellExecution: (callback) => {
        endListener = callback
        setTimeout(() => callback({ terminal: terminalInstance, execution: terminalExecution, exitCode: 0 }), 0)
        return { dispose() {} }
      },
      onDidChangeTerminalShellIntegration: () => ({ dispose() {} }),
    },
    languages: { getDiagnostics: () => [] },
    commands: { executeCommand: async () => undefined },
  }
  return { vscode, repo, terminalInstance, terminalExecution, fireEnd: () => endListener }
}

const settings = {
  preferVscodeForCode: 'ask',
  autoOpenWindow: true,
  defaultSave: true,
  bridgeDir: undefined,
  requestTimeoutMs: 15_000,
}

const tools = createTools({ ctx: { workingDirectory: { get: () => 'C:\\ws' } }, settings, logger: console })
const schemaOf = (name) => tools.find((tool) => tool.name === name).output.schema

test('校验器本身能抓到未声明字段与类型不符', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { a: { type: 'number' } } }
  assert.deepEqual(validateValue(schema, { a: 1 }), [])
  assert.equal(validateValue(schema, { a: '1' }).length, 1)
  assert.equal(validateValue(schema, { a: 1, b: 2 }).length, 1)
})

test('git 族返回值全部能通过 vscode_git 的输出 schema', async () => {
  const { vscode } = fakeVscode()
  const handlers = createHandlers({ vscode, diffStore: documents.createDiffStore() })
  const cases = [
    ['git.status', {}, 'vscode_git'],
    ['git.log', { maxEntries: 3 }, 'vscode_git'],
    ['git.diff', {}, 'vscode_git'],
    ['git.add', { paths: ['C:\\ws\\a.js'] }, 'vscode_git'],
    ['git.commit', { message: 'x' }, 'vscode_git'],
    ['git.branchCreate', { name: 'dev' }, 'vscode_git'],
    ['git.branchList', {}, 'vscode_git'],
    ['git.checkout', { ref: 'main' }, 'vscode_git'],
    ['git.fetch', { all: true }, 'vscode_git'],
    ['git.pull', {}, 'vscode_git'],
    ['git.push', {}, 'vscode_git'],
  ]
  for (const [op, args, toolName] of cases) {
    const value = await handlers[op](args)
    const errors = validateValue(schemaOf(toolName), JSON.parse(JSON.stringify(value)))
    assert.deepEqual(errors, [], `${op} 的返回值与 schema 不符`)
  }
})

test('doc.open 的返回值能通过 vscode_open 的 schema', async () => {
  const { vscode } = fakeVscode()
  const handlers = createHandlers({ vscode, diffStore: documents.createDiffStore() })
  const value = await handlers['doc.open']({ path: 'C:\\ws\\a.js' })
  const errors = validateValue(schemaOf('vscode_open'), JSON.parse(JSON.stringify(value)))
  assert.deepEqual(errors, [])
})

test('无编辑器时 context.selection 能通过 vscode_context 的 schema', async () => {
  const { vscode } = fakeVscode()
  const handlers = createHandlers({ vscode, diffStore: documents.createDiffStore() })
  for (const op of ['context.selection', 'context.activeEditor', 'context.openEditors', 'context.diagnostics', 'context.workspaceFolders']) {
    const value = await handlers[op]({})
    const errors = validateValue(schemaOf('vscode_context'), JSON.parse(JSON.stringify(value)))
    assert.deepEqual(errors, [], `${op} 的返回值与 schema 不符`)
  }
})

test('term.run 的返回值能通过 vscode_terminal 的 schema', async () => {
  const { vscode } = fakeVscode()
  const handlers = createHandlers({ vscode, diffStore: documents.createDiffStore() })
  const value = await handlers['term.run']({ command: 'echo hi', timeoutMs: 5_000 })
  const errors = validateValue(schemaOf('vscode_terminal'), JSON.parse(JSON.stringify(value)))
  assert.deepEqual(errors, [])
})

test('term.run 没有退出码时也不会写出 schema 外的值', async () => {
  const { vscode, terminalInstance, terminalExecution } = fakeVscode()
  vscode.window.onDidEndTerminalShellExecution = (callback) => {
    setTimeout(() => callback({ terminal: terminalInstance, execution: terminalExecution, exitCode: undefined }), 0)
    return { dispose() {} }
  }
  const handlers = createHandlers({ vscode, diffStore: documents.createDiffStore() })
  const value = await handlers['term.run']({ command: 'x', timeoutMs: 5_000 })
  const errors = validateValue(schemaOf('vscode_terminal'), JSON.parse(JSON.stringify(value)))
  assert.deepEqual(errors, [])
})
