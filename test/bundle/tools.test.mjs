import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalTimeouts, createTools, waitForNewInstance } from '../../bundle/lib/tools.js'

const inst = (pid, folders) => ({ pid, port: 50000 + pid, token: `t${pid}`, folders, repoRoots: folders, version: '0.2.0' })

test('waitForNewInstance 只认目标窗口的新实例，不把别的窗口当成功', async () => {
  let calls = 0
  const discover = async () => {
    calls += 1
    // 111 = 目标窗口旧实例；222 = 另一个窗口一直在跑；第 2 轮出现目标窗口的新实例 333
    return calls === 1 ? [inst(111, ['C:\\a']), inst(222, ['C:\\b'])] : [inst(333, ['C:\\a']), inst(222, ['C:\\b'])]
  }
  const fresh = await waitForNewInstance({
    previousPid: 111,
    targetFolders: ['C:\\a'],
    excludePids: new Set([111, 222]),
    intervalMs: 1,
    timeoutMs: 200,
    discover,
  })
  assert.equal(fresh.pid, 333)
})

test('目标窗口没重启时不会拿别的窗口顶包', async () => {
  const discover = async () => [inst(111, ['C:\\a']), inst(222, ['C:\\b'])]
  const fresh = await waitForNewInstance({
    previousPid: 111,
    targetFolders: ['C:\\a'],
    excludePids: new Set([111, 222]),
    intervalMs: 1,
    timeoutMs: 30,
    discover,
  })
  assert.equal(fresh, undefined)
})

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
