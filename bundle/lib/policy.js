export function policyText(settings) {
  if (settings.preferVscodeForCode === 'never') {
    return 'VSCode 桥接当前关闭（preferVscodeForCode=never），vscode_* 工具不可用；直接用原生工具工作。'
  }

  const ask = settings.preferVscodeForCode === 'ask'

  const lines = [
    'VSCode 桥接（vscode_*）让你在用户的编辑器里工作：改文件、看 diff、跑集成终端、走源代码管理做 git。',
    '',
    '铁律：',
    ask
      ? '- **改任何代码文件之前，必须先问一次**"这次在 VSCode 里做吗？"（用 ask_user_question）。没问就直接改 = 违规。'
      : '- 代码开发默认走 VSCode，不必每次询问；但用户明确说用原生工具时照办。',
    '- 守卫会在本会话**第一次**改代码文件或执行 git 写命令时拦你一次并要求先问；问过或用户说不用后，重试即放行。',
    '- VSCode 没开**不是**跳过询问的理由：用户同意后，用 vscode_open(action:"folder") 自己把窗口打开。',
    '- 写文档、改配置、临时脚本用原生写文件工具，不要为这些去打扰用户。',
    '',
    '改代码的顺序：vscode_read 拿实时内容和版本号 → vscode_edit（带 baseVersion）→ vscode_open(action:"diff") 给用户看。',
    '用户可能手改未保存的内容；下一次编辑前必须重新 vscode_read，冲突时（CONFLICT）停下来问，不要覆盖。',
    'git 写操作（commit/push/建分支/checkout）只在用户明确要求时执行；push 前确认分支不是受保护分支。',
    '常规命令仍用 pwsh 工具；vscode_terminal 只用于用户需要亲眼看过程的命令（构建、dev server、跑测试）。',
    '桥接工具报 BRIDGE_UNAVAILABLE 时：先看 vscode_status 的候选，必要时 vscode_open(folder 开窗)，不要反复重试。',
  ]
  return lines.join('\n')
}

export function runtimeContextText(settings, connected) {
  if (settings.preferVscodeForCode === 'never') return ''
  if (settings.preferVscodeForCode === 'always') {
    return connected
      ? 'VSCode 桥接已连接，代码改动默认走 vscode_* 工具。'
      : 'VSCode 桥接当前没有活动窗口：需要时用 vscode_open(action:"folder") 打开。'
  }
  return connected
    ? 'VSCode 桥接已连接。改任何代码文件之前，先用 ask_user_question 问一次"这次在 VSCode 里做吗？"，不要直接改。'
    : 'VSCode 桥接当前没有活动窗口。改任何代码文件之前仍要先问一次；用户同意后用 vscode_open(action:"folder") 打开窗口。'
}
