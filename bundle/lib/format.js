export function truncate(text, limit = 200) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const KEYPAD = /\u001b[=>]/g
const CHARSET = /\u001b[()#][0-9A-Za-z]/g
const OTHER_ESCAPE = /\u001b[@-_]/g

/** 终端输出里的颜色码、OSC 标题/提示与其余转义序列，对模型没有信息量。 */
export function stripAnsi(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  return text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(KEYPAD, '')
    .replace(CHARSET, '')
    .replace(OTHER_ESCAPE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function folderLine(instance) {
  const folders = (instance.folders ?? []).join(', ') || '（无文件夹）'
  return `pid ${instance.pid} · ${folders}${instance.title ? ` · ${instance.title}` : ''}`
}

export function formatStatus(value) {
  if (!value?.connected) {
    const lines = [`VSCode 桥接：未连上（${value?.code ?? 'UNKNOWN'}）`, value?.message ?? '']
    if ((value?.candidates ?? []).length > 0) {
      lines.push('当前活着的窗口：')
      for (const instance of value.candidates) lines.push(`- ${folderLine(instance)}`)
      lines.push('用 window 参数（pid 或文件夹）指定要操作哪个窗口。')
    } else {
      lines.push('没有活着的窗口：请打开对应文件夹的 VSCode，或用 vscode_open(action:"folder") 打开。')
    }
    return lines.join('\n')
  }

  const bridge = value.bridge ?? {}
  const lines = [
    `VSCode 桥接：已连上 ${bridge.title || '（未命名窗口）'}`,
    `端口 ${bridge.port} · pid ${bridge.pid} · VSCode ${bridge.vscodeVersion} · 扩展 ${bridge.version}`,
    `文件夹：${(bridge.folders ?? []).join(', ') || '（无）'}`,
    `仓库：${(bridge.repoRoots ?? []).join(', ') || '（未检测到）'}`,
    `运行时 cwd：${value.runtime?.cwd ?? '未知'} · 代码开发策略：${value.runtime?.preferVscodeForCode ?? 'ask'}`,
  ]
  return lines.join('\n')
}

export function formatError(error) {
  return `${error?.code ?? 'ERROR'}: ${truncate(error?.message ?? error, 500)}`
}
