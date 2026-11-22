'use strict'

const path = require('node:path')

const MAX_DIFF_CHARS = 64 * 1024
const DEFAULT_LOG_ENTRIES = 20

// VSCode Status 枚举 → 单字母状态码
const STATUS_NAMES = [
  'M', 'A', 'D', 'R', 'C', // 0-4：已暂存的修改/新增/删除/重命名/复制
  'M', 'D', 'U', 'I', 'A', // 5-9：工作区修改/删除/未跟踪/忽略/待加入
]

function codedError(code, message, detail) {
  const error = new Error(message)
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

function normalize(target) {
  if (typeof target !== 'string' || target.length === 0) return ''
  return path.resolve(target.replace(/\//g, '\\')).toLowerCase().replace(/\\+$/, '')
}

function isUnder(child, parent) {
  const c = normalize(child)
  const p = normalize(parent)
  if (!c || !p) return false
  return c === p || c.startsWith(p.endsWith('\\') ? p : `${p}\\`)
}

function repoRootOf(repository) {
  const uri = repository?.rootUri
  return uri?.fsPath ?? uri?.path ?? ''
}

async function getGitApi({ vscode, waitMs = 300 }) {
  const find = () => vscode.extensions.getExtension('vscode.git')
  let extension = find()
  if (!extension && waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    extension = find()
  }
  if (!extension) throw codedError('NO_REPO', 'VSCode 内置 Git 扩展不可用；请确认 VSCode 里已启用源代码管理')
  try {
    await extension.activate?.()
  } catch (error) {
    throw codedError('NO_REPO', `VSCode Git 扩展激活失败：${error?.message ?? error}`)
  }
  const api = extension.exports?.getAPI?.(1)
  if (!api) throw codedError('NO_REPO', 'VSCode Git 扩展没有提供 API')
  return api
}

function pickRepository(api, targetPath) {
  const repositories = api?.repositories ?? []
  if (repositories.length === 0) {
    throw codedError('NO_REPO', '这个窗口没有打开任何 git 仓库')
  }
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return repositories[0]
  }
  let best
  let bestLength = -1
  for (const repository of repositories) {
    const root = repoRootOf(repository)
    if (!root || !isUnder(targetPath, root)) continue
    const length = normalize(root).length
    if (length > bestLength) {
      best = repository
      bestLength = length
    }
  }
  if (!best) {
    throw codedError('NO_REPO', `目标路径不在任何已打开的仓库里：${targetPath}`)
  }
  return best
}

function changeOf(change, staged) {
  const uri = change?.uri
  const statusCode = Number(change?.status ?? -1)
  return {
    path: uri?.fsPath ?? uri?.path ?? '',
    statusCode: STATUS_NAMES[statusCode] ?? '?',
    rawStatusCode: statusCode,
    staged,
  }
}

function gitStatus(repository) {
  const state = repository?.state ?? {}
  const head = state.HEAD ?? {}
  const changes = [
    ...(state.workingTreeChanges ?? []).map((change) => changeOf(change, false)),
    ...(state.indexChanges ?? []).map((change) => changeOf(change, true)),
  ]
  return {
    root: repoRootOf(repository),
    branch: head.name ?? '',
    commit: head.commit ?? '',
    ahead: head.ahead ?? 0,
    behind: head.behind ?? 0,
    changes,
  }
}

function trimDiff(text) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (value.length <= MAX_DIFF_CHARS) return { text: value, truncated: false }
  return { text: `${value.slice(0, MAX_DIFF_CHARS)}\n…（diff 已截断，共 ${value.length} 字符）`, truncated: true }
}

async function gitLog(repository, maxEntries = DEFAULT_LOG_ENTRIES) {
  const limit = Math.max(1, Math.min(100, Number(maxEntries) || DEFAULT_LOG_ENTRIES))
  let commits
  try {
    commits = await repository.log({ maxEntries: limit, historyItemRef: undefined })
  } catch (error) {
    throw codedError('GIT_ERROR', `读取提交历史失败：${error?.message ?? error}`)
  }
  return {
    entries: (commits ?? []).slice(0, limit).map((commit) => ({
      hash: commit.hash,
      message: commit.message,
      author: commit.authorName,
      date: commit.authorDate instanceof Date ? commit.authorDate.toISOString() : String(commit.authorDate ?? ''),
    })),
  }
}

async function gitDiff(repository, { path: targetPath, ref } = {}) {
  let text
  try {
    if (ref) text = await repository.diffWith(ref, targetPath)
    else text = await repository.diffWithHEAD(targetPath)
  } catch (error) {
    throw codedError('GIT_ERROR', `读取 diff 失败：${error?.message ?? error}`)
  }
  return trimDiff(text)
}

async function assertIdentity(repository) {
  let name
  let email
  try {
    name = await repository.getConfig?.('user.name')
    email = await repository.getConfig?.('user.email')
  } catch {
    return
  }
  if (!name || !email) {
    throw codedError(
      'IDENTITY_MISSING',
      '这个仓库没有可用的 git 身份（user.name / user.email），提交会被拒。请先运行：git config user.name "你的名字" 与 git config user.email "你的邮箱"',
    )
  }
}

function headOf(repository) {
  return repository?.state?.HEAD ?? {}
}

async function gitAdd(repository, { paths } = {}) {
  const list = Array.isArray(paths) ? paths.filter((item) => typeof item === 'string' && item.length > 0) : []
  if (list.length === 0) throw codedError('BAD_REQUEST', 'add 需要至少一个路径')
  try {
    await repository.add(list)
  } catch (error) {
    throw codedError('GIT_ERROR', `暂存失败：${error?.message ?? error}`)
  }
  return { action: 'add', paths: list }
}

async function gitCommit(repository, { message, all } = {}) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw codedError('BAD_REQUEST', 'commit 需要非空的 message')
  }
  await assertIdentity(repository)
  try {
    await repository.commit(message, { all: Boolean(all) })
  } catch (error) {
    throw codedError('GIT_ERROR', `提交失败：${error?.message ?? error}`)
  }
  return { action: 'commit', branch: headOf(repository).name ?? '', message, all: Boolean(all) }
}

async function gitFetch(repository, { all } = {}) {
  try {
    await repository.fetch({ all: Boolean(all) })
  } catch (error) {
    throw codedError('GIT_ERROR', `fetch 失败：${error?.message ?? error}`)
  }
  return { action: 'fetch', all: Boolean(all) }
}

async function gitPull(repository) {
  try {
    await repository.pull()
  } catch (error) {
    throw codedError('GIT_ERROR', `pull 失败：${error?.message ?? error}`)
  }
  return { action: 'pull', branch: headOf(repository).name ?? '' }
}

async function gitPush(repository, { setUpstream } = {}) {
  const head = headOf(repository)
  const branch = head.name
  if (!branch) throw codedError('GIT_ERROR', '当前是 detached HEAD，先 checkout 一个分支再 push')
  let remote = 'origin'
  try {
    remote = (await repository.getConfig?.(`branch.${branch}.remote`)) || 'origin'
  } catch {
    // 没有配置就用 origin
  }
  const needsUpstream = setUpstream === true || !head.upstream
  try {
    await repository.push(remote, branch, needsUpstream)
  } catch (error) {
    throw codedError(
      'GIT_ERROR',
      `push 失败：${error?.message ?? error}。如果是要你登录，请到 VSCode 窗口完成授权后重试`,
    )
  }
  return { action: 'push', branch, remote, setUpstream: needsUpstream }
}

async function gitBranchCreate(repository, { name, checkout = true } = {}) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw codedError('BAD_REQUEST', 'branch_create 需要分支名')
  }
  try {
    await repository.createBranch(name, Boolean(checkout))
  } catch (error) {
    throw codedError('GIT_ERROR', `建分支失败：${error?.message ?? error}`)
  }
  return { action: 'branch_create', name, checkout: Boolean(checkout) }
}

async function gitBranchList(repository) {
  let branches
  try {
    branches = await repository.getBranches()
  } catch (error) {
    throw codedError('GIT_ERROR', `读取分支失败：${error?.message ?? error}`)
  }
  const current = headOf(repository).name
  return {
    action: 'branch_list',
    current: current ?? '',
    branches: (branches ?? []).map((branch) => ({
      name: branch.name,
      current: branch.name === current,
      upstream: branch.upstream?.name ?? '',
      ahead: branch.ahead ?? 0,
      behind: branch.behind ?? 0,
    })),
  }
}

async function gitCheckout(repository, { ref } = {}) {
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw codedError('BAD_REQUEST', 'checkout 需要分支名或提交')
  }
  try {
    await repository.checkout(ref)
  } catch (error) {
    throw codedError('GIT_ERROR', `checkout 失败：${error?.message ?? error}`)
  }
  return { action: 'checkout', ref }
}

async function gitStash() {
  throw codedError(
    'UNSUPPORTED',
    'VSCode 的 Git 扩展没有公开 stash API；需要 stash 时用 vscode_terminal 跑 git stash / git stash pop',
  )
}

module.exports = {
  getGitApi,
  pickRepository,
  gitStatus,
  gitLog,
  gitDiff,
  gitAdd,
  gitCommit,
  gitFetch,
  gitPull,
  gitPush,
  gitBranchCreate,
  gitBranchList,
  gitCheckout,
  gitStash,
  isUnder,
  normalize,
  MAX_DIFF_CHARS,
}
