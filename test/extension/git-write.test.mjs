import test from 'node:test'
import assert from 'node:assert/strict'
import git from '../../extension/lib/git.js'

function fakeRepo(root, overrides = {}) {
  const calls = []
  const repository = {
    rootUri: { fsPath: root },
    state: { HEAD: { name: 'main', ahead: 0, behind: 0 } },
    add: async (paths) => calls.push(['add', paths]),
    commit: async (message, options) => calls.push(['commit', message, options]),
    createBranch: async (name, checkout) => calls.push(['createBranch', name, checkout]),
    getBranches: async () => [{ name: 'main', type: 0 }, { name: 'dev', type: 0, upstream: { name: 'origin/dev' } }],
    checkout: async (ref) => calls.push(['checkout', ref]),
    fetch: async (options) => calls.push(['fetch', options]),
    pull: async () => calls.push(['pull']),
    push: async (remote, branch, setUpstream) => calls.push(['push', remote, branch, setUpstream]),
    getConfig: async (key) => ({ 'user.name': 'dev', 'user.email': 'dev@local', 'branch.main.remote': 'origin' })[key],
    ...overrides,
  }
  return { repository, calls }
}

test('commit 默认只提交已暂存（all:false）', async () => {
  const { repository, calls } = fakeRepo('C:\\ws\\a')
  const result = await git.gitCommit(repository, { message: 'feat: x' })
  assert.deepEqual(calls[0], ['commit', 'feat: x', { all: false }])
  assert.equal(result.branch, 'main')
})

test('commit all:true 时传 { all: true }', async () => {
  const { repository, calls } = fakeRepo('C:\\ws\\a')
  await git.gitCommit(repository, { message: 'x', all: true })
  assert.deepEqual(calls[0], ['commit', 'x', { all: true }])
})

test('仓库没有 git 身份时抛 IDENTITY_MISSING 并给修法', async () => {
  const { repository } = fakeRepo('C:\\ws\\a', { getConfig: async () => undefined })
  await assert.rejects(
    git.gitCommit(repository, { message: 'x' }),
    (error) => error.code === 'IDENTITY_MISSING' && /git config user\.name/.test(error.message),
  )
})

test('push 在分支无 upstream 时自动 set-upstream', async () => {
  const { repository, calls } = fakeRepo('C:\\ws\\a')
  const result = await git.gitPush(repository)
  assert.deepEqual(calls[0], ['push', 'origin', 'main', true])
  assert.equal(result.setUpstream, true)
})

test('push 已有 upstream 时不重复设置', async () => {
  const { repository, calls } = fakeRepo('C:\\ws\\a', {
    state: { HEAD: { name: 'main', upstream: { name: 'origin/main' } } },
  })
  await git.gitPush(repository)
  assert.deepEqual(calls[0], ['push', 'origin', 'main', false])
})

test('push 失败保留原始错误并标 GIT_ERROR', async () => {
  const { repository } = fakeRepo('C:\\ws\\a', { push: async () => { throw new Error('no upstream') } })
  await assert.rejects(git.gitPush(repository), (error) => error.code === 'GIT_ERROR' && /no upstream/.test(error.message))
})

test('fetch / pull / branch_create / checkout 转发参数', async () => {
  const { repository, calls } = fakeRepo('C:\\ws\\a')
  await git.gitFetch(repository, { all: true })
  await git.gitPull(repository)
  await git.gitBranchCreate(repository, { name: 'dev', checkout: true })
  await git.gitCheckout(repository, { ref: 'main' })
  assert.deepEqual(calls.map((call) => call[0]), ['fetch', 'pull', 'createBranch', 'checkout'])
  assert.deepEqual(calls[2], ['createBranch', 'dev', true])
  assert.deepEqual(calls[3], ['checkout', 'main'])
})

test('branchList 归一化分支信息', async () => {
  const { repository } = fakeRepo('C:\\ws\\a')
  const list = await git.gitBranchList(repository)
  assert.deepEqual(list.branches.map((branch) => [branch.name, Boolean(branch.upstream)]), [
    ['main', false],
    ['dev', true],
  ])
})

test('stash 明确报 UNSUPPORTED，并指向终端', async () => {
  const { repository } = fakeRepo('C:\\ws\\a')
  await assert.rejects(
    git.gitStash(repository),
    (error) => error.code === 'UNSUPPORTED' && /git stash/.test(error.message),
  )
})
