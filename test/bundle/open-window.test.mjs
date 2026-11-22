import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForInstance, openFolderWindow, spawnWindow, resolveCodeExe } from '../../bundle/lib/open-window.js'
import * as openWindow from '../../bundle/lib/open-window.js'
import { policyText } from '../../bundle/lib/policy.js'

const settings = { bridgeDir: 'C:\\tmp\\bridge', autoOpenWindow: true }

const instance = (pid, folder) => ({
  pid,
  port: 50000 + pid,
  token: `tok-${pid}`,
  folders: [folder],
  repoRoots: [folder],
  version: '0.1.0',
  vscodeVersion: '1.116.0',
  title: folder,
})

test('waitForInstance 轮询到窗口出现为止', async () => {
  let calls = 0
  const discover = async () => {
    calls += 1
    return calls < 3 ? [] : [instance(42, 'C:\\ws\\proj')]
  }
  const result = await waitForInstance({ path: 'C:\\ws\\proj', settings, discover, intervalMs: 1 })
  assert.equal(result.pid, 42)
  assert.equal(calls, 3)
})

test('waitForInstance 一直没有窗口时抛 TIMEOUT', async () => {
  const discover = async () => []
  await assert.rejects(
    waitForInstance({ path: 'C:\\ws\\none', settings, discover, intervalMs: 1, timeoutMs: 15 }),
    (error) => error.code === 'TIMEOUT',
  )
})

test('openFolderWindow 复用已存在的窗口，不 spawn', async () => {
  const discover = async () => [instance(7, 'C:\\ws\\proj')]
  const result = await openFolderWindow({ path: 'C:\\ws\\proj', settings, discover })
  assert.equal(result.reused, true)
  assert.equal(result.pid, 7)
})

test('autoOpenWindow 关闭且没有窗口时明确拒绝', async () => {
  const discover = async () => []
  await assert.rejects(
    openFolderWindow({ path: 'C:\\ws\\proj', settings: { ...settings, autoOpenWindow: false }, discover }),
    (error) => error.code === 'UNSUPPORTED',
  )
})

test('spawnWindow 把路径当单个参数传，且不用 shell', async () => {
  const calls = []
  const child = { on: () => child, unref: () => undefined }
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    return child
  }
  openWindow.spawnWindow({
    path: 'C:\\ws\\my proj & calc',
    exe: 'C:\\vscode\\Code.exe',
    spawnImpl,
  })
  assert.equal(calls[0].command, 'C:\\vscode\\Code.exe')
  assert.deepEqual(calls[0].args, ['-n', 'C:\\ws\\my proj & calc'])
  assert.equal(calls[0].options.shell, false)
})

test('spawnWindow 找不到 Code.exe 时明确拒绝', () => {
  assert.throws(
    () => openWindow.spawnWindow({ path: 'C:\\ws', exe: undefined, spawnImpl: () => ({ on() {}, unref() {} }) }),
    (error) => error.code === 'UNSUPPORTED',
  )
})

test('spawnWindow 会从环境里去掉 ELECTRON_RUN_AS_NODE', async () => {
  // DSH 自己是 Electron：继承来的 ELECTRON_RUN_AS_NODE 会让 Code.exe 以 node 模式跑完就退
  const previous = process.env.ELECTRON_RUN_AS_NODE
  process.env.ELECTRON_RUN_AS_NODE = '1'
  try {
    const calls = []
    openWindow.spawnWindow({
      path: 'C:\\ws',
      exe: 'C:\\vscode\\Code.exe',
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options })
        return { on: () => undefined, unref: () => undefined }
      },
    })
    assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(calls[0].options.detached, true)
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = previous
  }
})

test('resolveCodeExe 优先用环境变量，其次从 PATH 上的 code.cmd 推导', () => {
  const env = {
    DSH_VSCODE_EXE: 'D:\\custom\\Code.exe',
    PATH: 'C:\\vscode\\bin;C:\\Windows',
  }
  const exists = (target) => target === 'D:\\custom\\Code.exe'
  assert.equal(openWindow.resolveCodeExe({ env, exists }), 'D:\\custom\\Code.exe')

  const derived = openWindow.resolveCodeExe({
    env: { PATH: 'C:\\vscode\\bin' },
    exists: (target) => ['C:\\vscode\\bin\\code.cmd', 'C:\\vscode\\Code.exe'].includes(target),
  })
  assert.equal(derived, 'C:\\vscode\\Code.exe')
})

test('policyText 随策略变化', () => {
  assert.match(policyText({ preferVscodeForCode: 'ask' }), /先问一次/)
  assert.doesNotMatch(policyText({ preferVscodeForCode: 'always' }), /先问一次/)
  assert.match(policyText({ preferVscodeForCode: 'never' }), /关闭/)
})
