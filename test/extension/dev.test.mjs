import test from 'node:test'
import assert from 'node:assert/strict'
import dev from '../../extension/lib/dev.js'

function fakeVscode() {
  const calls = []
  return {
    calls,
    commands: {
      executeCommand: async (command) => { calls.push(command) },
    },
  }
}

test('reload 先回响应、后重启扩展宿主', async () => {
  const vscode = fakeVscode()
  const scheduled = []
  const result = await dev.reloadExtensionHost({
    vscode,
    schedule: (callback) => scheduled.push(callback),
  })
  assert.deepEqual(result, { action: 'restart_extensions', scheduled: true })
  assert.deepEqual(vscode.calls, [], '不能在返回响应前重启，否则请求会被掐断')

  scheduled[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(vscode.calls, ['workbench.action.restartExtensionHost'])
})

test('reload_window 走 workbench.action.reloadWindow', async () => {
  const vscode = fakeVscode()
  const scheduled = []
  await dev.reloadWindow({ vscode, schedule: (callback) => scheduled.push(callback) })
  scheduled[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(vscode.calls, ['workbench.action.reloadWindow'])
})

test('重载命令失败不会冒成未捕获异常', async () => {
  const scheduled = []
  await dev.reloadExtensionHost({
    vscode: { commands: { executeCommand: async () => { throw new Error('nope') } } },
    schedule: (callback) => scheduled.push(callback),
  })
  scheduled[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

test('连续文件变更被合并成一次重启', () => {
  let restarted = 0
  const clock = {
    setTimeout: (callback) => { clock.pending = callback; return 1 },
    clearTimeout: () => { clock.pending = undefined },
    pending: undefined,
  }
  const scheduler = dev.createReloadScheduler({ restart: () => { restarted += 1 }, timers: clock, debounceMs: 10 })
  scheduler.notify()
  scheduler.notify()
  scheduler.notify()
  assert.equal(restarted, 0)
  assert.equal(scheduler.pending(), true)
  clock.pending()
  assert.equal(restarted, 1)
  assert.equal(scheduler.pending(), false)
})

test('dispose 之后不再触发重启', () => {
  let restarted = 0
  const clock = {
    setTimeout: (callback) => { clock.pending = callback; return 1 },
    clearTimeout: () => { clock.pending = undefined },
    pending: undefined,
  }
  const scheduler = dev.createReloadScheduler({ restart: () => { restarted += 1 }, timers: clock })
  scheduler.notify()
  scheduler.dispose()
  clock.pending?.()
  assert.equal(restarted, 0)
})

test('热更新忽略 .git 变更，并对普通文件变更安排重启', () => {
  let listener
  const closed = []
  const vscode = fakeVscode()
  const watcher = dev.createHotReload({
    vscode,
    dir: 'C:\\ext',
    watch: (_dir, _options, callback) => {
      listener = callback
      return { close: () => closed.push(true) }
    },
    debounceMs: 0,
  })

  listener('change', '.git/HEAD')
  assert.deepEqual(vscode.calls, [])

  listener('change', 'lib/terminal.js')
  return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
    assert.deepEqual(vscode.calls, ['workbench.action.restartExtensionHost'])
    watcher.dispose()
    assert.deepEqual(closed, [true])
  })
})
