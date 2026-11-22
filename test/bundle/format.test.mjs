import test from 'node:test'
import assert from 'node:assert/strict'
import { stripAnsi, formatStatus } from '../../bundle/lib/format.js'

test('stripAnsi 去掉颜色码与 OSC 控制序列', () => {
  const raw = '\u001b[33m69f248a\u001b[m fix: x\n\u001b]0;管理员: powershell.exe\u0007done\n'
  assert.equal(stripAnsi(raw), '69f248a fix: x\ndone\n')
})

test('stripAnsi 保留普通文本与换行', () => {
  assert.equal(stripAnsi('a\r\nb\n'), 'a\nb\n')
})

test('stripAnsi 对空值安全', () => {
  assert.equal(stripAnsi(undefined), '')
  assert.equal(stripAnsi(''), '')
})

test('stripAnsi 去掉键盘模式与字符集切换残留', () => {
  assert.equal(stripAnsi('\u001b=a\n\u001b>b\n\u001b(Bc\n'), 'a\nb\nc\n')
})

test('formatStatus 报告未连接时给出候选窗口', () => {
  const text = formatStatus({
    connected: false,
    code: 'BRIDGE_UNAVAILABLE',
    message: '没有窗口',
    candidates: [{ pid: 7, port: 50007, folders: ['C:\\ws\\a'], title: 'a' }],
  })
  assert.match(text, /未连上/)
  assert.match(text, /pid 7/)
})
