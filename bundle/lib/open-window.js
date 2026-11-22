import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { discoverInstances, selectInstance } from './client.js'

function codedError(code, message) {
  return Object.assign(new Error(message), { code })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 找 Code.exe 而不是 code.cmd：直接 spawn 可执行文件才能 shell:false，
 * 参数不会被拼进命令行（带空格的路径不会被拆开，`&` 也不会变成命令分隔符）。
 */
export function resolveCodeExe({ env = process.env, exists = existsSync } = {}) {
  const override = env.DSH_VSCODE_EXE
  if (override && exists(override)) return override

  const candidates = []
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const cmd = path.join(dir, 'code.cmd')
    if (!exists(cmd)) continue
    candidates.push(path.resolve(path.dirname(cmd), '..', 'Code.exe'))
  }
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'))
  if (env['ProgramFiles(x86)']) candidates.push(path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'))

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return undefined
}

export function spawnWindow({ path: target, exe, spawnImpl = spawn, env = process.env } = {}) {
  if (!exe) {
    throw codedError('UNSUPPORTED', '找不到 VSCode 的 Code.exe：请用 vscode_open 之外的方式打开窗口，或设置 DSH_VSCODE_EXE')
  }
  // DSH 自己是 Electron 应用，环境里带 ELECTRON_RUN_AS_NODE=1；
  // 继承下去会让 Code.exe 以 node 模式跑完就退，窗口根本不会出现。
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const child = spawnImpl(exe, ['-n', target], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    env: childEnv,
  })
  // spawn 失败会发 error 事件；不接住会变成未捕获异常把插件带崩
  child.on?.('error', () => undefined)
  child.unref?.()
  return child
}

/** 轮询到出现一个能处理该路径的窗口为止。 */
export async function waitForInstance({
  path,
  settings,
  window,
  timeoutMs = 20_000,
  intervalMs = 400,
  discover = discoverInstances,
} = {}) {
  const deadline = Date.now() + timeoutMs
  let lastCandidates = []
  while (Date.now() < deadline) {
    const instances = await discover({ dir: settings.bridgeDir, timeoutMs: 500 })
    lastCandidates = instances
    const picked = selectInstance(instances, { window, targetPath: path, cwd: path })
    if (picked.instance) {
      return {
        opened: true,
        pid: picked.instance.pid,
        port: picked.instance.port,
        folders: picked.instance.folders,
        waitedMs: timeoutMs - Math.max(0, deadline - Date.now()),
      }
    }
    await sleep(intervalMs)
  }
  throw codedError(
    'TIMEOUT',
    `等了 ${timeoutMs}ms 仍没有窗口能处理 ${path}（当前活着的窗口：${lastCandidates.map((item) => (item.folders ?? []).join(',')).join(' | ') || '无'}）`,
  )
}

/** 复用已有窗口；没有就 code -n 开一个，再等桥接就绪。 */
export async function openFolderWindow({ path, settings, window, discover = discoverInstances } = {}) {
  const existing = await discover({ dir: settings.bridgeDir, timeoutMs: 500 })
  const picked = selectInstance(existing, { window, targetPath: path, cwd: path })
  if (picked.instance) {
    return { opened: false, reused: true, pid: picked.instance.pid, port: picked.instance.port, folders: picked.instance.folders }
  }
  if (!settings.autoOpenWindow) {
    throw codedError('UNSUPPORTED', '配置里关掉了 autoOpenWindow；请用户手动打开对应的 VSCode 窗口')
  }

  const child = spawnWindow({ path, exe: resolveCodeExe() })
  void child
  const ready = await waitForInstance({ path, settings, window, discover })
  return { opened: true, reused: false, ...ready }
}
