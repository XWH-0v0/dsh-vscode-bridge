import test from 'node:test'
import assert from 'node:assert/strict'
import terminal from '../../extension/lib/terminal.js'

function fakeTerminal({ withShellIntegration = true } = {}) {
  const created = []
  let listener
  const execution = {
    commandLine: 'echo hi',
    async *read() {
      yield 'he'
      yield 'llo\n'
    },
  }
  const instance = {
    name: 'DSH: echo hi',
    shown: 0,
    show() { this.shown += 1 },
    shellIntegration: withShellIntegration
      ? { executeCommand: () => execution }
      : undefined,
  }
  const vscode = {
    window: {
      createTerminal: () => { created.push(instance); return instance },
      terminals: [],
      onDidEndTerminalShellExecution: (callback) => {
        listener = callback
        return { dispose() {} }
      },
      showErrorMessage: () => undefined,
    },
  }
  return { vscode, instance, execution, fire: (payload) => listener(payload), created }
}

test('有 shell integration 时返回输出与退出码', async () => {
  const { vscode, instance, execution, fire } = fakeTerminal()
  const pending = terminal.runCommand({ vscode }, { command: 'echo hi' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  fire({ terminal: instance, execution, exitCode: 0 })
  const result = await pending
  assert.equal(result.exitCode, 0)
  assert.equal(result.output, 'hello\n')
  assert.equal(result.usedShellIntegration, true)
})

test('没有 shell integration 时抛 TERMINAL_NO_SHELL_INTEGRATION', async () => {
  const { vscode } = fakeTerminal({ withShellIntegration: false })
  await assert.rejects(
    terminal.runCommand({ vscode }, { command: 'echo hi' }),
    (error) => error.code === 'TERMINAL_NO_SHELL_INTEGRATION',
  )
})

test('超时抛 TIMEOUT 并在 detail 里保留已收到的部分输出', async () => {
  const { vscode } = fakeTerminal()
  await assert.rejects(
    terminal.runCommand({ vscode }, { command: 'sleep 999', timeoutMs: 20 }),
    (error) => error.code === 'TIMEOUT' && typeof error.detail === 'string',
  )
})

test('输出超限时保留尾部并标 truncated', async () => {
  const { vscode, instance, fire } = fakeTerminal()
  const execution = {
    commandLine: 'big',
    async *read() {
      yield 'A'.repeat(40_000)
      yield 'B'.repeat(40_000)
    },
  }
  instance.shellIntegration = { executeCommand: () => execution }
  const pending = terminal.runCommand({ vscode }, { command: 'big' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  fire({ terminal: instance, execution, exitCode: 0 })
  const result = await pending
  assert.equal(result.truncated, true)
  assert.ok(result.output.length <= terminal.MAX_OUTPUT_CHARS + 200)
  assert.ok(result.output.endsWith('B'))
})

test('shell integration 稍后才出现时等待它再执行', async () => {
  const execution = {
    commandLine: 'echo hi',
    async *read() {
      yield 'ok\n'
    },
  }
  let started = false
  let endListener
  let notifyIntegration
  const instance = {
    name: 'late',
    show() {},
    shellIntegration: undefined,
  }
  const vscode = {
    window: {
      createTerminal: () => {
        setTimeout(() => {
          instance.shellIntegration = {
            executeCommand: () => {
              started = true
              return execution
            },
          }
          notifyIntegration({ terminal: instance, shellIntegration: instance.shellIntegration })
        }, 1)
        return instance
      },
      onDidEndTerminalShellExecution: (callback) => {
        endListener = callback
        return { dispose() {} }
      },
      onDidChangeTerminalShellIntegration: (callback) => {
        notifyIntegration = callback
        return { dispose() {} }
      },
    },
  }

  const pending = terminal.runCommand({ vscode }, { command: 'echo hi', shellIntegrationTimeoutMs: 500 })
  for (let index = 0; index < 200 && !started; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(started, true, '等了 shell integration 之后应该执行命令')
  endListener({ terminal: instance, execution, exitCode: 0 })
  const result = await pending
  assert.equal(result.output, 'ok\n')
})

test('等了超时仍没有 shell integration 时才报错', async () => {
  const instance = { name: 'never', show() {}, shellIntegration: undefined }
  const vscode = {
    window: {
      createTerminal: () => instance,
      onDidEndTerminalShellExecution: () => ({ dispose() {} }),
      onDidChangeTerminalShellIntegration: () => ({ dispose() {} }),
    },
  }
  await assert.rejects(
    terminal.runCommand({ vscode }, { command: 'x', shellIntegrationTimeoutMs: 30 }),
    (error) => error.code === 'TERMINAL_NO_SHELL_INTEGRATION',
  )
})

test('不属于本次执行的结束事件被忽略', async () => {
  const { vscode, instance, execution, fire } = fakeTerminal()
  const pending = terminal.runCommand({ vscode }, { command: 'echo hi' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  fire({ terminal: instance, execution: { commandLine: 'other' }, exitCode: 1 })
  fire({ terminal: instance, execution, exitCode: 0 })
  const result = await pending
  assert.equal(result.exitCode, 0)
})
