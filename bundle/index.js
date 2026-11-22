import Schema from '@deepseek-ai/schemastery'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createTools } from './lib/tools.js'
import { policyText, runtimeContextText } from './lib/policy.js'
import { shouldNudge } from './lib/ask-guard.js'

export const name = 'dsh-vscode-bridge'
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

export const Config = Schema.object({
  preferVscodeForCode: Schema.union(['ask', 'always', 'never']).default('ask').volatile()
    .description('代码开发是否走 VSCode：ask 每次先问，always 直接走，never 关闭全部 vscode_* 工具'),
  autoOpenWindow: Schema.boolean().default(true).volatile()
    .description('需要时是否允许自动执行 code -n 打开 VSCode 窗口'),
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
  // 每个 agent 一次：nudged 记录"已经提醒过"，usedVscode 记录"已经决定用桥"
  const state = { nudged: new Set(), usedVscode: new Set() }
  const tools = createTools({ ctx, settings, logger })

  for (const tool of tools) {
    ctx.tools.register(tool, {
      when: () => settings.preferVscodeForCode !== 'never',
    })
  }

  ctx.tools.guard((execution) => {
    const name = typeof execution?.name === 'string' ? execution.name : ''
    const agentId = execution?.agent?.id

    if (name.startsWith('vscode_')) {
      if (settings.preferVscodeForCode === 'never') {
        return 'VSCode 桥接已在配置里关闭（preferVscodeForCode=never）。请用户改回 ask 或 always 再试，不要重试。'
      }
      if (agentId) state.usedVscode.add(agentId)
      return undefined
    }

    // 软约束实测会被忽略（2026-11-22）：第一次改代码时硬拦一次，逼出那句询问
    return shouldNudge({ toolName: name, args: execution?.arguments, agentId, state, settings })
  })

  ctx.systemPrompt.section({
    name: 'vscode-bridge',
    order: 61,
    text: () => policyText(settings),
  })

  // 动态上下文每轮重新注入，比埋在长 prompt 里的静态段落更难被忽略
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
