import Schema from '@deepseek-ai/schemastery'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createTools } from './lib/tools.js'
import { policyText, runtimeContextText } from './lib/policy.js'

export const name = 'dsh-vscode-bridge'
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

export const Config = Schema.object({
  preferVscodeForCode: Schema.union(['ask', 'always', 'never']).default('ask').volatile()
    .description('never = 关闭全部 vscode_* 工具；ask/always 都表示"按需使用，不主动询问"（保留旧值只为兼容已存配置）'),
  autoOpenWindow: Schema.boolean().default(true).volatile()
    .description('需要时是否允许自己执行 code -n 打开 VSCode 窗口'),
  defaultSave: Schema.boolean().default(true).volatile()
    .description('vscode_edit 默认是否保存文件'),
  bridgeDir: Schema.string().default('')
    .description('实例文件目录，留空使用 ~/.dsh/vscode-bridge'),
  requestTimeoutMs: Schema.number().default(15_000)
    .description('单次桥接请求超时（毫秒），修改会重启插件'),
})

function readSettings(config) {
  const dir = typeof config?.bridgeDir === 'string' && config.bridgeDir.length > 0 ? config.bridgeDir : undefined
  const timeout = Number(config?.requestTimeoutMs)
  return {
    preferVscodeForCode: ['ask', 'always', 'never'].includes(config?.preferVscodeForCode) ? config.preferVscodeForCode : 'ask',
    autoOpenWindow: config?.autoOpenWindow !== false,
    defaultSave: config?.defaultSave !== false,
    bridgeDir: dir,
    requestTimeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 15_000,
  }
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  const settings = readSettings(config)
  const tools = createTools({ ctx, settings, logger })

  for (const tool of tools) {
    ctx.tools.register(tool, {
      when: () => settings.preferVscodeForCode !== 'never',
    })
  }

  ctx.tools.guard((execution) => {
    const name = typeof execution?.name === 'string' ? execution.name : ''
    if (!name.startsWith('vscode_')) return undefined
    if (settings.preferVscodeForCode === 'never') {
      return 'VSCode 工作台已在配置里关闭（preferVscodeForCode=never）。请用户改回 ask 或 always 再试，不要重试。'
    }
    return undefined
  })

  ctx.systemPrompt.section({
    name: 'vscode-bridge',
    order: 61,
    text: () => policyText(settings),
  })

  ctx.systemPrompt.context({
    name: 'vscode-bridge-status',
    order: 30,
    text: () => runtimeContextText(settings, bridgeLikelyConnected(settings.bridgeDir)),
  })
}

let bridgeCache = { at: 0, connected: false }

function bridgeLikelyConnected(dir) {
  const now = Date.now()
  if (now - bridgeCache.at < 5000) return bridgeCache.connected
  let connected = false
  try {
    const target = dir || join(homedir(), '.dsh', 'vscode-bridge')
    connected = readdirSync(target).some((name) => /^instance-\d+\.json$/.test(name))
  } catch {
    connected = false
  }
  bridgeCache = { at: now, connected }
  return connected
}
