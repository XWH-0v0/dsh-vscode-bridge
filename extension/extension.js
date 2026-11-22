'use strict'

// 这是扩展里唯一 require('vscode') 的文件；其余 lib/ 只接受注入的 vscode。
const vscode = require('vscode')
const { startBridge } = require('./lib/activate.js')
const { createHandlers } = require('./lib/handlers.js')
const { getGitApi } = require('./lib/git.js')
const { createDiffStore, createDiffProvider } = require('./lib/documents.js')

let current
let diffStore

async function activate(context) {
  const config = vscode.workspace.getConfiguration('dshVscodeBridge')
  diffStore = createDiffStore()
  context.subscriptions.push(createDiffProvider(vscode, diffStore))
  try {
    current = await startBridge({
      vscode,
      extensionVersion: context.extension.packageJSON.version,
      instanceDir: config.get('instanceDir') || undefined,
      autoStart: config.get('autoStart', true),
      extraHandlers: createHandlers({ vscode, diffStore }),
      repoRootsProvider: async () => {
        const api = await getGitApi({ vscode })
        return api.repositories.map((repository) => repository.rootUri?.fsPath ?? '').filter(Boolean)
      },
    })
  } catch (error) {
    vscode.window.showErrorMessage(`DSH 桥启动失败：${error?.message ?? error}`)
    return
  }
  if (!current) return

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  item.text = `$(broadcast) DSH:${current.port}`
  item.tooltip = 'DeepSeek Harness 桥接已就绪，点击查看连接信息'
  item.command = 'dshVscodeBridge.showInfo'
  item.show()
  context.subscriptions.push(item)

  context.subscriptions.push(
    vscode.commands.registerCommand('dshVscodeBridge.showInfo', () => {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).join('\n')
      vscode.window.showInformationMessage(
        `DSH 桥：127.0.0.1:${current.port}\n实例目录：${current.instanceDir}\n文件夹：\n${folders || '（未打开文件夹）'}`,
        { modal: true },
      )
    }),
  )

  context.subscriptions.push({
    dispose() {
      const bridge = current
      current = undefined
      bridge?.dispose().catch(() => undefined)
    },
  })
}

async function deactivate() {
  const bridge = current
  current = undefined
  await bridge?.dispose().catch(() => undefined)
}

module.exports = { activate, deactivate }
