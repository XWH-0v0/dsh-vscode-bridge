'use strict'

const MAX_OUTPUT_CHARS = 32 * 1024
const SHELL_INTEGRATION_TIMEOUT_MS = 5000

function codedError(code, message, detail) {
  const error = new Error(message)
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

function trimTail(output) {
  if (output.length <= MAX_OUTPUT_CHARS) return { output, truncated: false }
  const dropped = output.length - MAX_OUTPUT_CHARS
  return {
    output: `…（前 ${dropped} 字符已截断）\n${output.slice(-MAX_OUTPUT_CHARS)}`,
    truncated: true,
  }
}

/** 新终端要等一下才挂上 shell integration；不要创建完就立刻判定没有。 */
function waitForShellIntegration({ vscode, terminal, timeoutMs }) {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration)
  const subscribe = vscode.window.onDidChangeTerminalShellIntegration
  if (typeof subscribe !== 'function') return Promise.resolve(undefined)

  return new Promise((resolve) => {
    let settled = false
    let subscription
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        subscription?.dispose?.()
      } catch {
        // 清理失败不影响结果
      }
      resolve(value)
    }
    subscription = subscribe((event) => {
      if (!event || event.terminal !== terminal) return
      finish(event.shellIntegration ?? terminal.shellIntegration)
    })
    timer = setTimeout(() => finish(terminal.shellIntegration), timeoutMs)
  })
}

/**
 * 在 VSCode 集成终端里执行命令并取回输出。
 * 依赖 shell integration；等不到就明确报错，不假装成功。
 */
async function runCommand({ vscode }, { command, cwd, timeoutMs = 60_000, name, shellIntegrationTimeoutMs = SHELL_INTEGRATION_TIMEOUT_MS } = {}) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw codedError('BAD_REQUEST', 'terminal run 需要 command')
  }

  let terminal
  try {
    terminal = vscode.window.createTerminal({ name: name || `DSH: ${command.slice(0, 40)}`, cwd })
    terminal.show?.(true)
  } catch (error) {
    throw codedError('INTERNAL', `创建终端失败：${error?.message ?? error}`)
  }

  const shell = await waitForShellIntegration({ vscode, terminal, timeoutMs: shellIntegrationTimeoutMs })
  if (!shell) {
    throw codedError(
      'TERMINAL_NO_SHELL_INTEGRATION',
      '这个终端没有 shell integration，拿不到命令输出。请在 VSCode 设置里开启 terminal.integrated.shellIntegration.enabled，或用 pwsh 工具执行',
    )
  }

  // 1) 先挂"结束"监听（快命令可能在 executeCommand 返回后立刻结束）。
  // 2) 再启动命令。
  // 3) 命令一启动就持续读输出流 —— 等到结束事件才读，数据已经流过去了。
  let settleEnd
  const endPromise = new Promise((resolve) => {
    settleEnd = resolve
  })
  let endSubscription
  let timer

  const cleanup = () => {
    clearTimeout(timer)
    try {
      endSubscription?.dispose?.()
    } catch {
      // 清理失败不影响结果
    }
  }

  endSubscription = vscode.window.onDidEndTerminalShellExecution((event) => {
    if (event?.terminal !== terminal) return
    if (event?.execution !== execution) return
    cleanup()
    settleEnd(event)
  })

  let execution
  try {
    execution = shell.executeCommand(command)
  } catch (error) {
    cleanup()
    throw codedError('INTERNAL', `启动命令失败：${error?.message ?? error}`)
  }

  let output = ''
  let readError
  const reading = (async () => {
    try {
      for await (const chunk of execution.read()) output += String(chunk)
    } catch (error) {
      readError = error
    }
  })()

  const timedOut = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        endSubscription?.dispose?.()
      } catch {
        // 清理失败不影响结果
      }
      reject(codedError('TIMEOUT', `命令在 ${timeoutMs}ms 内没有结束`, output))
    }, timeoutMs)
  })

  const event = await Promise.race([endPromise, timedOut]).catch((error) => {
    cleanup()
    throw error
  })
  cleanup()
  await reading
  // 结束事件之后可能还有最后一小段数据在路上。
  await new Promise((resolve) => setTimeout(resolve, 30))

  const trimmed = trimTail(output)
  const result = {
    output: trimmed.output,
    truncated: trimmed.truncated,
    usedShellIntegration: true,
    terminal: terminal.name,
  }
  // 输出 schema 里 exitCode 是 number：拿不到退出码就省略，不要写 null
  if (typeof event.exitCode === 'number') result.exitCode = event.exitCode
  if (readError) result.readError = String(readError?.message ?? readError)
  return result
}

function listTerminals({ vscode }) {
  const terminals = vscode.window.terminals ?? []
  return {
    terminals: terminals.map((terminal) => ({
      name: terminal.name,
      processId: terminal.processId,
      usedShellIntegration: Boolean(terminal.shellIntegration),
    })),
  }
}

function showTerminal({ vscode }, { name } = {}) {
  const terminals = vscode.window.terminals ?? []
  const terminal = name ? terminals.find((item) => item.name === name) : vscode.window.activeTerminal ?? terminals[0]
  if (!terminal) throw codedError('NOT_FOUND', `没有这个终端：${name ?? '(活动终端)'}`)
  terminal.show?.()
  return { name: terminal.name }
}

function killTerminal({ vscode }, { name } = {}) {
  const terminals = vscode.window.terminals ?? []
  const terminal = name ? terminals.find((item) => item.name === name) : vscode.window.activeTerminal
  if (!terminal) throw codedError('NOT_FOUND', `没有这个终端：${name ?? '(活动终端)'}`)
  terminal.dispose?.()
  return { killed: terminal.name }
}

module.exports = { runCommand, listTerminals, showTerminal, killTerminal, MAX_OUTPUT_CHARS }
