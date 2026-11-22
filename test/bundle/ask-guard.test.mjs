import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldNudge, isCodePath, isGitWrite, NUDGE_TEXT } from '../../bundle/lib/ask-guard.js'
import { runtimeContextText } from '../../bundle/lib/policy.js'

const settings = { preferVscodeForCode: 'ask' }
const state = () => ({ nudged: new Set(), usedVscode: new Set() })
const check = (overrides) => shouldNudge({
  toolName: 'edit',
  args: { file_path: 'C:\\ws\\app\\main.py' },
  agentId: 'a1',
  state: state(),
  settings,
  ...overrides,
})

test('第一次改代码文件时给一次提醒', () => {
  const message = check({})
  assert.equal(message, NUDGE_TEXT)
  assert.match(message, /VSCode/)
})

test('第二次同样操作放行（一次性）', () => {
  const shared = state()
  assert.equal(check({ state: shared }), NUDGE_TEXT)
  assert.equal(check({ state: shared }), undefined)
})

test('已经用过 vscode_* 工具的会话不再提醒', () => {
  const shared = state()
  shared.usedVscode.add('a1')
  assert.equal(check({ state: shared }), undefined)
})

test('改文档/配置不提醒', () => {
  assert.equal(check({ args: { file_path: 'C:\\ws\\docs\\a.md' } }), undefined)
  assert.equal(check({ args: { file_path: 'C:\\ws\\config.json' } }), undefined)
})

test('git 写命令提醒，只读命令不提醒', () => {
  assert.equal(check({ toolName: 'pwsh', args: { command: 'git commit -m "x"' } }), NUDGE_TEXT)
  assert.equal(check({ toolName: 'pwsh', args: { command: 'git push origin main' } }), NUDGE_TEXT)
  assert.equal(check({ toolName: 'pwsh', args: { command: 'git status' } }), undefined)
  assert.equal(check({ toolName: 'pwsh', args: { command: 'python -m pytest' } }), undefined)
})

test('preferVscodeForCode=never 时完全不打扰', () => {
  assert.equal(check({ settings: { preferVscodeForCode: 'never' } }), undefined)
})

test('没有 agent 归属的调用不提醒（避免拦到系统调用）', () => {
  assert.equal(check({ agentId: undefined }), undefined)
})

test('vscode_* 工具本身永远不被拦', () => {
  assert.equal(check({ toolName: 'vscode_edit', args: { edits: [{ path: 'C:\\ws\\a.py' }] } }), undefined)
})

test('isCodePath 认扩展名，不认目录名', () => {
  assert.equal(isCodePath('C:\\ws\\a.PY'), true)
  assert.equal(isCodePath('C:\\ws\\python\\readme.md'), false)
  assert.equal(isCodePath('C:\\ws\\a.ts'), true)
  assert.equal(isCodePath(''), false)
  assert.equal(isCodePath(undefined), false)
})

test('isGitWrite 覆盖提交/推送/合并，放过查询', () => {
  assert.equal(isGitWrite('git -C . commit -am "x"'), true)
  assert.equal(isGitWrite('git merge dev'), true)
  assert.equal(isGitWrite('git log --oneline'), false)
  assert.equal(isGitWrite('echo git commit'), false)
})

test('动态上下文在 ask 模式下无论桥是否连着都要求先问', () => {
  assert.match(runtimeContextText({ preferVscodeForCode: 'ask' }, true), /问一次/)
  assert.match(runtimeContextText({ preferVscodeForCode: 'ask' }, false), /问一次/)
})

test('never 模式下不注入动态上下文', () => {
  assert.equal(runtimeContextText({ preferVscodeForCode: 'never' }, true), '')
})
