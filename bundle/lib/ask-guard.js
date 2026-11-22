/**
 * "要不要在 VSCode 里做" 这件事不能只靠系统提示：
 * 实测过（2026-11-22）策略在 prompt 里、模型照样直接开工。
 * 这里做**一次性**提醒：每个会话的第一次代码改动被拦一次，
 * 模型要么去问用户，要么再调一次（第二次放行）。
 */

const CODE_EXTENSIONS = new Set([
  '.py', '.pyw', '.pyi',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.cs', '.fs',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm', '.swift',
  '.rb', '.php', '.lua', '.dart', '.ex', '.exs', '.erl', '.hs', '.clj', '.sql',
  '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd',
  '.html', '.css', '.scss', '.less',
])

const GIT_WRITE = /(?:^|[;&|]\s*)git\b[^;&|]*\b(commit|push|merge|rebase|cherry-pick|tag|revert|reset\s+--hard|branch\s+-[dD]|stash)\b/

export const NUDGE_TEXT = [
  '先问一句再动手：这次在 VSCode 里做吗？',
  '',
  '用 ask_user_question 问用户（本会话只问一次）：',
  '- 用户说做 → 用 vscode_read → vscode_edit → vscode_open(diff) 改代码；VSCode 没开就 vscode_open(action:"folder") 自己开。',
  '- 用户说不用，或这是子代理/非交互场景 → 直接重新执行刚才那次调用即可，不会再被拦。',
].join('\n')

export function isCodePath(target) {
  if (typeof target !== 'string' || target.length === 0) return false
  const dot = target.lastIndexOf('.')
  if (dot < 0) return false
  const ext = target.slice(dot).toLowerCase()
  // 目录名里带点（如 v1.2/file）不算扩展名：扩展名不会带路径分隔符
  if (ext.includes('\\') || ext.includes('/')) return false
  return CODE_EXTENSIONS.has(ext)
}

export function isGitWrite(command) {
  if (typeof command !== 'string' || !command.includes('git')) return false
  return GIT_WRITE.test(command)
}

function writeTargetOf(args) {
  if (!args || typeof args !== 'object') return undefined
  return args.file_path ?? args.path ?? args.filePath
}

export function shouldNudge({ toolName, args, agentId, state, settings }) {
  if (!settings || settings.preferVscodeForCode === 'never') return undefined
  if (!agentId) return undefined
  if (typeof toolName !== 'string' || toolName.startsWith('vscode_')) return undefined
  if (!state || !state.nudged || !state.usedVscode) return undefined
  if (state.nudged.has(agentId) || state.usedVscode.has(agentId)) return undefined

  let hit = false
  if (toolName === 'edit' || toolName === 'write') {
    hit = isCodePath(writeTargetOf(args))
  } else if (toolName === 'pwsh') {
    hit = isGitWrite(args?.command ?? args?.script ?? '')
  }
  if (!hit) return undefined

  state.nudged.add(agentId)
  return NUDGE_TEXT
}
