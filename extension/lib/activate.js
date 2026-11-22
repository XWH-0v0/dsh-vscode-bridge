'use strict'

const crypto = require('node:crypto')
const discovery = require('./discovery.js')
const { createServer } = require('./server.js')

/**
 * 启动桥接：起草稿——只碰 workspace 信息，不碰任何 UI，便于在 node:test 里注入伪 vscode。
 * @returns {Promise<undefined | { port:number, token:string, instanceDir:string, dispose:() => Promise<void> }>}
 */
async function startBridge({ vscode, extensionVersion, instanceDir, autoStart = true, extraHandlers = {}, repoRootsProvider }) {
  if (autoStart === false) return undefined

  const startedAt = new Date().toISOString()
  const token = crypto.randomBytes(24).toString('hex')
  const folders = () => (vscode.workspace?.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
  const repoRoots = async () => {
    try {
      return (await repoRootsProvider?.()) ?? []
    } catch {
      return []
    }
  }
  const info = () => ({
    version: extensionVersion,
    pid: process.pid,
    vscodeVersion: vscode.version,
    folders: folders(),
    repoRoots: [],
    title: vscode.workspace?.name ?? '',
  })

  const handlers = {
    ping: async () => info(),
    status: async () => ({ ...info(), repoRoots: await repoRoots(), startedAt }),
    ...extraHandlers,
  }

  const server = await createServer({ token, handlers })
  const dir = instanceDir || discovery.defaultBridgeDir()
  await discovery.writeInstanceFile(dir, { ...info(), port: server.port, token, startedAt })

  let disposed = false
  return {
    port: server.port,
    token,
    instanceDir: dir,
    async dispose() {
      if (disposed) return
      disposed = true
      await discovery.removeInstanceFile(dir, process.pid)
      await server.close()
    },
  }
}

module.exports = { startBridge }
