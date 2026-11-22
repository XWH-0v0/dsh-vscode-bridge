export function policyText(settings) {
  if (settings.preferVscodeForCode === 'never') {
    return 'VSCode 工作台当前关闭（preferVscodeForCode=never），vscode_* 工具不可用；直接用原生工具工作。'
  }

  return [
    'VSCode 是你的工作台，不是每次改代码的必经之路。',
    '',
    '默认用原生工具：读文件、改代码、批量编辑、跑测试都用 read/write/edit/pwsh，快且直接。',
    '',
    '需要工作台时自己用，不用问用户：',
    '- 要让用户看改动 → vscode_edit + vscode_open(action:"diff")',
    '- 要真实环境跑命令（构建、安装包、dev server）→ vscode_terminal',
    '- 要你的选区、未保存内容、红波浪线 → vscode_context / vscode_read',
    '- 要 git 且想用 VSCode 已登录的凭据 → vscode_git',
    '- 用户明确说"在 VSCode 里做"→ 整段开发都在工作台里做',
    '',
    'VSCode 没开就自己开：vscode_open(action:"folder")，然后等 vscode_status 显示已连接。',
    '不要问"这次要不要用 VSCode"——需要就直接用，不需要就无声地用原生工具。',
    '改完扩展代码后用 vscode_dev(action:"reload") 让窗口加载新代码，不需要用户手动重载。',
    'git 写操作（commit/push/建分支/checkout）只在用户明确要求时执行；push 前确认分支不是受保护分支。',
  ].join('\n')
}

export function runtimeContextText(settings, connected) {
  if (settings.preferVscodeForCode === 'never') return ''
  return connected
    ? 'VSCode 工作台已连接：需要看 diff、真实终端、诊断或 git 时直接用 vscode_* 工具；平时用原生工具。'
    : 'VSCode 工作台当前没有活动窗口：需要时用 vscode_open(action:"folder") 打开（不用问用户）。'
}
