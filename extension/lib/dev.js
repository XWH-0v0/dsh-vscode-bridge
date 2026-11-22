'use strict'

const DEFAULT_RELOAD_DELAY_MS = 150
const DEFAULT_DEBOUNCE_MS = 800

function defaultSchedule(callback, delay) {
  setTimeout(callback, delay)
}

/**
 * 先回响应、再重启宿主：重启会掐断这次请求，所以必须延后一点。
 * @returns {Promise<{action: string, scheduled: boolean}>}
 */
async function reloadExtensionHost({ vscode, schedule = defaultSchedule, delayMs = DEFAULT_RELOAD_DELAY_MS } = {}) {
  schedule(() => {
    Promise.resolve()
      .then(() => vscode.commands.executeCommand('workbench.action.restartExtensionHost'))
      .catch(() => undefined)
  }, delayMs)
  return { action: 'restart_extensions', scheduled: true }
}

async function reloadWindow({ vscode, schedule = defaultSchedule, delayMs = DEFAULT_RELOAD_DELAY_MS } = {}) {
  schedule(() => {
    Promise.resolve()
      .then(() => vscode.commands.executeCommand('workbench.action.reloadWindow'))
      .catch(() => undefined)
  }, delayMs)
  return { action: 'reload_window', scheduled: true }
}

/** 把连续的文件变更合并成一次重启。 */
function createReloadScheduler({ restart, debounceMs = DEFAULT_DEBOUNCE_MS, timers } = {}) {
  const clock = timers ?? { setTimeout, clearTimeout }
  let timer
  return {
    notify() {
      clock.clearTimeout(timer)
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
 * 监听已安装的扩展目录：源码被重新拷贝进去就自动重启扩展宿主。
 * 这样改扩展不需要用户手动 Developer: Reload Window。
 */
function createHotReload({ vscode, dir, watch, debounceMs = DEFAULT_DEBOUNCE_MS, logger } = {}) {
  const watcherFactory = watch ?? require('node:fs').watch
  const scheduler = createReloadScheduler({
    debounceMs,
    restart: () => {
      logger?.info?.('[dsh-vscode-bridge] 检测到扩展文件变化，重启扩展宿主')
      Promise.resolve()
        .then(() => vscode.commands.executeCommand('workbench.action.restartExtensionHost'))
        .catch(() => undefined)
    },
  })

  let watcher
  try {
    watcher = watcherFactory(dir, { recursive: true }, (_event, file) => {
      if (typeof file === 'string' && file.startsWith('.git')) return
      scheduler.notify()
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
  DEFAULT_RELOAD_DELAY_MS,
  DEFAULT_DEBOUNCE_MS,
}
