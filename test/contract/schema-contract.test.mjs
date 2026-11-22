import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateValue } from './json-schema.mjs'
import { createTools } from '../../bundle/lib/tools.js'

const require = createRequire(import.meta.url)
const { createHandlers } = require('../../extension/lib/handlers.js')
const documents = require('../../extension/lib/documents.js')

/** 规范：每个注册的工具都必须在这里被真实校验过一次。 */
const exercised = new Set()

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

  const terminalExecution = {
    commandLine: 'echo hi',
    async *read() { yield 'ok\n' },
  }
  const terminalInstance = {
    name: 'DSH: t',
    show() {},
    shellIntegration: { executeCommand: () => terminalExecution },
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
        setTimeout(() => callback({ terminal: terminalInstance, execution: terminalExecution, exitCode: 0 }), 0)
        return { dispose() {} }
      },
      onDidChangeTerminalShellIntegration: () => ({ dispose() {} }),
    },
    languages: { getDiagnostics: () => [] },
    commands: { executeCommand: async () => undefined },
  }
  return { vscode, terminalInstance, terminalExecution }
}

const settings = {
  preferVscodeForCode: 'ask',
  autoOpenWindow: true,
  defaultSave: true,
  bridgeDir: undefined,
  requestTimeoutMs: 15_000,
}

const tools = createTools({ ctx: { workingDirectory: { get: () => 'C:\\ws' } }, settings, logger: console })
const toolByName = (name) => tools.find((tool) => tool.name === name)
const schemaOf = (name) => toolByName(name).output.schema

/** 把工具真实产出的值对着它自己声明的 schema 验一遍，并记录覆盖率。 */
function validateFor(toolName, value) {
  exercised.add(toolName)
  return validateValue(schemaOf(toolName), JSON.parse(JSON.stringify(value)))
}

async function handlersFor() {
  const { vscode } = fakeVscode()
  return createHandlers({ vscode, diffStore: documents.createDiffStore() })
}

test('校验器本身能抓到未声明字段与类型不符', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { a: { type: 'number' } } }
  assert.deepEqual(validateValue(schema, { a: 1 }), [])
  assert.equal(validateValue(schema, { a: '1' }).length, 1)
  assert.equal(validateValue(schema, { a: 1, b: 2 }).length, 1)
})

test('git 族返回值全部能通过 vscode_git 的输出 schema', async () => {
  const handlers = await handlersFor()
  const cases = [
    ['git.status', {}],
    ['git.log', { maxEntries: 3 }],
    ['git.diff', {}],
    ['git.add', { paths: ['C:\\ws\\a.js'] }],
    ['git.commit', { message: 'x' }],
    ['git.branchCreate', { name: 'dev' }],
    ['git.branchList', {}],
    ['git.checkout', { ref: 'main' }],
    ['git.fetch', { all: true }],
    ['git.pull', {}],
    ['git.push', {}],
  ]
  for (const [op, args] of cases) {
    assert.deepEqual(validateFor('vscode_git', await handlers[op](args)), [], `${op} 的返回值与 schema 不符`)
  }
})

test('doc.open / doc.read / doc.edit 的返回值能通过对应 schema', async () => {
  const handlers = await handlersFor()
  assert.deepEqual(validateFor('vscode_open', await handlers['doc.open']({ path: 'C:\\ws\\a.js' })), [])
  assert.deepEqual(validateFor('vscode_read', await handlers['doc.read']({ paths: ['C:\\ws\\a.js'] })), [])
  assert.deepEqual(
    validateFor('vscode_edit', await handlers['doc.edit']({ edits: [{ path: 'C:\\ws\\a.js', fullText: 'y' }] })),
    [],
  )
})

test('无编辑器时 context 全动作都能通过 vscode_context 的 schema', async () => {
  const handlers = await handlersFor()
  for (const op of ['context.selection', 'context.activeEditor', 'context.openEditors', 'context.diagnostics', 'context.workspaceFolders']) {
    assert.deepEqual(validateFor('vscode_context', await handlers[op]({})), [], `${op} 的返回值与 schema 不符`)
  }
})

test('term 系列返回值能通过 vscode_terminal 的 schema', async () => {
  const handlers = await handlersFor()
  assert.deepEqual(validateFor('vscode_terminal', await handlers['term.list']({})), [])
  assert.deepEqual(validateFor('vscode_terminal', await handlers['term.run']({ command: 'echo hi', timeoutMs: 5_000 })), [])
})

test('dev.reload 的返回值能通过 vscode_dev 的 schema', async () => {
  const handlers = await handlersFor()
  assert.deepEqual(validateFor('vscode_dev', await handlers['dev.reload']({})), [])
})

test('vscode_status 连不上时也符合自己的 schema', async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), 'dsh-contract-'))
  const statusTools = createTools({
    ctx: { workingDirectory: { get: () => 'C:\\ws' } },
    settings: { ...settings, bridgeDir: emptyDir },
    logger: console,
  })
  const status = statusTools.find((tool) => tool.name === 'vscode_status')
  const value = await status.execute({}, { agent: { session: {} } })

  exercised.add('vscode_status')
  assert.deepEqual(validateValue(status.output.schema, JSON.parse(JSON.stringify(value))), [])
})

test('规范：每个注册的工具都必须有真实契约校验（新增工具必须在这里补用例）', () => {
  const registered = tools.map((tool) => tool.name).sort()
  const covered = [...exercised].sort()
  assert.deepEqual(covered, registered, '有工具没被契约测试覆盖：补用例，或删掉这个工具')
})
