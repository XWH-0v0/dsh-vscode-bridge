import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalTimeouts, createTools } from '../../bundle/lib/tools.js'

test('不传 timeoutMs 时命令按 60s、请求层多留 10s', () => {
  assert.deepEqual(terminalTimeouts({}, 15_000), { commandMs: 60_000, requestMs: 70_000 })
})

test('vscode_open 的工具超时够覆盖开窗等待（20s）', () => {
  const tools = createTools({
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
  const open = tools.find((tool) => tool.name === 'vscode_open')
  assert.ok(open, 'vscode_open 应该存在')
  assert.ok(open.timeoutMs >= 45_000, `当前是 ${open.timeoutMs}ms，不足以覆盖 20s 的开窗等待`)
})

test('传了 timeoutMs 时两层都跟着它走', () => {
  assert.deepEqual(terminalTimeouts({ timeoutMs: 120_000 }, 15_000), { commandMs: 120_000, requestMs: 130_000 })
})

test('非法 timeoutMs 回落到默认值', () => {
  assert.deepEqual(terminalTimeouts({ timeoutMs: 'abc' }, 15_000), { commandMs: 60_000, requestMs: 70_000 })
  assert.deepEqual(terminalTimeouts({ timeoutMs: -5 }, 15_000), { commandMs: 60_000, requestMs: 70_000 })
})
