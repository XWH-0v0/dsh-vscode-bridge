import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const INSTANCE_PATTERN = /^instance-(\d+)\.json$/

export class BridgeError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

export function defaultBridgeDir(home = homedir()) {
  return path.join(home, '.dsh', 'vscode-bridge')
}

function normalize(target) {
  if (typeof target !== 'string' || target.length === 0) return ''
  const resolved = path.resolve(target.replace(/\//g, '\\'))
  return resolved.toLowerCase().replace(/\\+$/, '')
}

function isUnder(child, parent) {
  const c = normalize(child)
  const p = normalize(parent)
  if (!c || !p) return false
  return c === p || c.startsWith(p.endsWith('\\') ? p : `${p}\\`)
}

function bestByScore(instances, score) {
  const scored = instances.map((instance) => ({ instance, score: score(instance) })).filter((row) => row.score >= 0)
  if (scored.length === 0) return []
  const max = Math.max(...scored.map((row) => row.score))
  return scored.filter((row) => row.score === max).map((row) => row.instance)
}

function targetScore(instance) {
  if (typeof instance._target !== 'string') return -1
  const roots = [...(instance.repoRoots ?? []), ...(instance.folders ?? [])]
  let best = -1
  for (const root of roots) {
    if (!isUnder(instance._target, root)) continue
    best = Math.max(best, normalize(root).length)
  }
  return best
}

function cwdScore(instance) {
  if (typeof instance._cwd !== 'string') return -1
  let best = -1
  for (const folder of instance.folders ?? []) {
    if (isUnder(instance._cwd, folder) || isUnder(folder, instance._cwd)) {
      best = Math.max(best, normalize(folder).length)
    }
  }
  return best
}

export async function discoverInstances({ dir = defaultBridgeDir(), fetchImpl = globalThis.fetch, timeoutMs = 800 } = {}) {
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const found = []
  for (const name of names) {
    if (!INSTANCE_PATTERN.test(name)) continue
    let record
    try {
      record = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
    } catch {
      continue
    }
    if (typeof record?.port !== 'number' || typeof record?.token !== 'string') continue

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`http://127.0.0.1:${record.port}/ping`, { signal: controller.signal })
      if (!response?.ok) continue
      const body = await response.json()
      if (!body?.ok) continue
      found.push({ ...record, ...body.result, port: record.port, token: record.token })
    } catch {
      // 窗口关掉后残留的实例文件：跳过
    } finally {
      clearTimeout(timer)
    }
  }
  return found
}

export function selectInstance(instances, { window, targetPath, cwd } = {}) {
  if (!Array.isArray(instances) || instances.length === 0) {
    return { code: 'BRIDGE_UNAVAILABLE', candidates: [] }
  }

  if (window !== undefined && window !== null && window !== '') {
    const byPid = typeof window === 'number' || /^\d+$/.test(String(window))
      ? instances.filter((instance) => Number(instance.pid) === Number(window))
      : instances.filter((instance) => (instance.folders ?? []).some((folder) => isUnder(window, folder) || isUnder(folder, window)))
    if (byPid.length === 1) return { instance: byPid[0] }
    if (byPid.length > 1) return { code: 'AMBIGUOUS_WINDOW', candidates: byPid }
    return { code: 'BRIDGE_UNAVAILABLE', candidates: [] }
  }

  if (typeof targetPath === 'string' && targetPath.length > 0) {
    const decorated = instances.map((instance) => ({ ...instance, _target: targetPath }))
    const matched = bestByScore(decorated, targetScore).map(({ _target, ...rest }) => rest)
    if (matched.length === 1) return { instance: matched[0] }
    if (matched.length > 1) return { code: 'AMBIGUOUS_WINDOW', candidates: matched }
    // 明确给了目标路径却没有窗口包含它：不能用别的窗口去写这个文件
    return { code: 'BRIDGE_UNAVAILABLE', candidates: instances }
  }

  if (typeof cwd === 'string' && cwd.length > 0) {
    const decorated = instances.map((instance) => ({ ...instance, _cwd: cwd }))
    const matched = bestByScore(decorated, cwdScore).map(({ _cwd, ...rest }) => rest)
    if (matched.length === 1) return { instance: matched[0] }
    if (matched.length > 1) return { code: 'AMBIGUOUS_WINDOW', candidates: matched }
  }

  return { code: 'BRIDGE_UNAVAILABLE', candidates: [] }
}

export async function callBridge(instance, op, args = {}, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(`http://127.0.0.1:${instance.port}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-bridge-token': instance.token,
      },
      body: JSON.stringify({ op, args }),
      signal: controller.signal,
    })
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    throw new BridgeError(
      aborted ? 'TIMEOUT' : 'BRIDGE_UNAVAILABLE',
      aborted ? `桥接 ${timeoutMs}ms 内没有响应` : `连不上桥接：${error?.message ?? error}`,
    )
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401) {
    throw new BridgeError('BAD_TOKEN', 'token 不匹配；VSCode 窗口可能已重开，先重新发现实例')
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new BridgeError('INTERNAL', `桥接返回了非 JSON 响应（HTTP ${response.status}）`)
  }

  if (!body?.ok) {
    throw new BridgeError(
      body?.error?.code ?? 'INTERNAL',
      body?.error?.message ?? '桥接调用失败',
      body?.error?.detail,
    )
  }
  return body.result
}

export async function resolveBridge({ dir, window, targetPath, cwd, fetchImpl, timeoutMs, pingTimeoutMs } = {}) {
  const instances = await discoverInstances({ dir, fetchImpl, timeoutMs: pingTimeoutMs })
  const picked = selectInstance(instances, { window, targetPath, cwd })
  if (picked.instance) return picked.instance

  if (picked.code === 'AMBIGUOUS_WINDOW') {
    const list = picked.candidates.map((item) => `${item.pid}@${(item.folders ?? []).join(',')}`).join('；')
    throw new BridgeError('AMBIGUOUS_WINDOW', `多个 VSCode 窗口都匹配，请用 window 参数指定：${list}`, {
      candidates: picked.candidates.map((item) => ({ pid: item.pid, folders: item.folders, title: item.title })),
    })
  }

  throw new BridgeError(
    'BRIDGE_UNAVAILABLE',
    '没有可用的 VSCode 桥接：请打开对应的 VSCode 窗口（扩展会自动起桥），或用 vscode_open(action:"folder") 打开',
  )
}
