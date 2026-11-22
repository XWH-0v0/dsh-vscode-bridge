'use strict'

const path = require('node:path')

const DEFAULT_RELOAD_DELAY_MS = 150
const DEFAULT_DEBOUNCE_MS = 800
const TRIGGER_NAME = 'reload.trigger'

function defaultSchedule(callback, delay) {
  setTimeout(callback, delay)
}

/**
 * 先回响应、再重启宿主：重启会掐断这次请求，所以必须延后一点。
 * 命令失败只记日志——调用方靠轮询实例 pid 判断是否真的重启了。
 * @returns {Promise<{action: string, scheduled: boolean}>}
 */
async function reloadExtensionHost({ vscode, schedule = defaultSchedule, delayMs = DEFAULT_RELOAD_DELAY_MS, logger } = {}) {
  schedule(() => {
    Promise.resolve()
      .then(() => vscode.commands.executeCommand('workbench.action.restartExtensionHost'))
      .catch((error) => logger?.warn?.(`[dsh-vscode-bridge] 重启扩展宿主失败：${error?.message ?? error}`))
  }, delayMs)
  return { action: 'restart_extensions', scheduled: true }
}

async function reloadWindow({ vscode, schedule = defaultSchedule, delayMs = DEFAULT_RELOAD_DELAY_MS, logger } = {}) {
  schedule(() => {
    Promise.resolve()
      .then(() => vscode.commands.executeCommand('workbench.action.reloadWindow'))
      .catch((error) => logger?.warn?.(`[dsh-vscode-bridge] 重载窗口失败：${error?.message ?? error}`))
  }, delayMs)
  return { action: 'reload_window', scheduled: true }
}

/**
 * 固定窗口防抖：第一个事件开一个 timer，窗口内的后续事件不重置它。
 * 事件风暴下最多每 debounceMs 触发一次，不会被无限推迟。
 */
function createReloadScheduler({ restart, debounceMs = DEFAULT_DEBOUNCE_MS, timers } = {}) {
  const clock = timers ?? { setTimeout, clearTimeout }
  let timer
  return {
    notify() {
      if (timer !== undefined) return
      timer = clock.setTimeout(() => {
        timer = undefined
        restart()
      }, debounceMs)
    },
    pending() {
      return timer !== undefined
    },
    dispose() {
      clock.clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * 监听一个**不会被安装脚本删除**的触发文件目录。
 * 安装脚本把新代码拷进扩展目录后 touch 这个文件，扩展据此重启宿主。
 * （早期版本监听安装目录本身，Windows 下目录被删会进入事件风暴且永不重启。）
 */
function createHotReload({ vscode, triggerFile, watch, debounceMs = DEFAULT_DEBOUNCE_MS, logger } = {}) {
  if (typeof triggerFile !== 'string' || triggerFile.length === 0) {
    return { dispose() {} }
  }
  const watchFactory = watch ?? require('node:fs').watch
  const dir = path.dirname(triggerFile)
  const name = path.basename(triggerFile)

  const scheduler = createReloadScheduler({
    debounceMs,
    restart: () => {
      logger?.info?.('[dsh-vscode-bridge] 检测到重载触发文件，重启扩展宿主')
      Promise.resolve()
        .then(() => vscode.commands.executeCommand('workbench.action.restartExtensionHost'))
        .catch((error) => logger?.warn?.(`[dsh-vscode-bridge] 重启扩展宿主失败：${error?.message ?? error}`))
    },
  })

  let watcher
  try {
    watcher = watchFactory(dir, { persistent: false }, (_event, file) => {
      if (typeof file !== 'string' || file !== name) return
      scheduler.notify()
    })
    watcher?.on?.('error', (error) => {
      logger?.warn?.(`[dsh-vscode-bridge] 触发文件监听出错：${error?.message ?? error}`)
    })
  } catch (error) {
    logger?.warn?.(`[dsh-vscode-bridge] 热更新不可用：${error?.message ?? error}`)
    return { dispose() {} }
  }

  return {
    dispose() {
      scheduler.dispose()
      try {
        watcher.close()
      } catch {
        // 关闭失败不影响后续
      }
    },
  }
}

module.exports = {
  reloadExtensionHost,
  reloadWindow,
  createReloadScheduler,
  createHotReload,
  TRIGGER_NAME,
  DEFAULT_RELOAD_DELAY_MS,
  DEFAULT_DEBOUNCE_MS,
}
