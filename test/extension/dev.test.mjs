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

function fakeClock() {
  const clock = {
    pending: undefined,
    setTimeout: (callback) => { clock.pending = callback; return 1 },
    clearTimeout: () => { clock.pending = undefined },
  }
  return clock
}

test('reload 先回响应、后重启扩展宿主', async () => {
  const vscode = fakeVscode()
  const scheduled = []
  const result = await dev.reloadExtensionHost({ vscode, schedule: (callback) => scheduled.push(callback) })
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

test('重载命令失败只记日志，不抛未捕获异常', async () => {
  const warnings = []
  const scheduled = []
  await dev.reloadExtensionHost({
    vscode: { commands: { executeCommand: async () => { throw new Error('nope') } } },
    schedule: (callback) => scheduled.push(callback),
    logger: { warn: (message) => warnings.push(message) },
  })
  scheduled[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /nope/)
})

test('固定窗口防抖：窗口内的事件不会重置计时器', () => {
  let restarted = 0
  const clock = fakeClock()
  const scheduler = dev.createReloadScheduler({ restart: () => { restarted += 1 }, timers: clock, debounceMs: 10 })
  scheduler.notify()
  const first = clock.pending
  scheduler.notify()
  scheduler.notify()
  assert.equal(clock.pending, first, '后续事件不能重置已开的窗口')
  first()
  assert.equal(restarted, 1)
  assert.equal(scheduler.pending(), false)

  scheduler.notify()
  assert.equal(scheduler.pending(), true, '窗口结束后可以再次触发')
})

test('dispose 之后不再触发重启', () => {
  let restarted = 0
  const clock = fakeClock()
  const scheduler = dev.createReloadScheduler({ restart: () => { restarted += 1 }, timers: clock })
  scheduler.notify()
  scheduler.dispose()
  clock.pending?.()
  assert.equal(restarted, 0)
})

test('热更新只认触发文件，同一个目录里的其它文件不算', async () => {
  let listener
  const vscode = fakeVscode()
  const hot = dev.createHotReload({
    vscode,
    triggerFile: 'C:\\bridge\\reload.trigger',
    watch: (_dir, _options, callback) => {
      listener = callback
      return { close: () => undefined, on: () => undefined }
    },
    debounceMs: 0,
  })

  listener('change', 'instance-1234.json')
  listener('rename', 'something-else')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(vscode.calls, [])

  listener('change', 'reload.trigger')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(vscode.calls, ['workbench.action.restartExtensionHost'])
  hot.dispose()
})

test('watcher 报错时记录日志而不是崩掉', () => {
  const warnings = []
  const errors = []
  dev.createHotReload({
    vscode: fakeVscode(),
    triggerFile: 'C:\\bridge\\reload.trigger',
    watch: () => ({ close: () => undefined, on: (name, handler) => { if (name === 'error') errors.push(handler) } }),
    logger: { warn: (message) => warnings.push(message) },
  })
  errors[0](new Error('watch failed'))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /watch failed/)
})
