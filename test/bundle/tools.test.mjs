import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalTimeouts, createTools } from '../../bundle/lib/tools.js'

test('不传 timeoutMs 时命令按 60s、请求层多留 10s', () => {
  assert.deepEqual(terminalTimeouts({}, 15_000), { commandMs: 60_000, requestMs: 70_000 })
})

function buildTools() {
  return createTools({
    ctx: { workingDirectory: { get: () => 'C:\\ws' } },
    settings: {
      preferVscodeForCode: 'ask',
      autoOpenWindow: true,
      defaultSave: true,
      bridgeDir: undefined,
      requestTimeoutMs: 15_000,
    },
    logger: console,
  })
}

test('vscode_open 的工具超时够覆盖开窗等待（20s）', () => {
  const open = buildTools().find((tool) => tool.name === 'vscode_open')
  assert.ok(open, 'vscode_open 应该存在')
  assert.ok(open.timeoutMs >= 45_000, `当前是 ${open.timeoutMs}ms，不足以覆盖 20s 的开窗等待`)
})

test('vscode_git 的输出 schema 覆盖写操作的返回字段', () => {
  const git = buildTools().find((tool) => tool.name === 'vscode_git')
  const properties = git.output.schema.properties ?? {}
  for (const key of ['action', 'message', 'all', 'branch', 'remote', 'setUpstream', 'name', 'checkout', 'current', 'ref', 'branches', 'paths']) {
    assert.ok(properties[key], `output schema 缺 ${key}，会导致写操作被判定为 invalid output`)
  }
})

test('传了 timeoutMs 时两层都跟着它走', () => {
  assert.deepEqual(terminalTimeouts({ timeoutMs: 120_000 }, 15_000), { commandMs: 120_000, requestMs: 130_000 })
})

test('非法 timeoutMs 回落到默认值', () => {
  assert.deepEqual(terminalTimeouts({ timeoutMs: 'abc' }, 15_000), { commandMs: 60_000, requestMs: 70_000 })
  assert.deepEqual(terminalTimeouts({ timeoutMs: -5 }, 15_000), { commandMs: 60_000, requestMs: 70_000 })
})
