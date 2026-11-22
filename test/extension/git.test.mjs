import test from 'node:test'
import assert from 'node:assert/strict'
import git from '../../extension/lib/git.js'

function fakeRepo(root, state = {}) {
  return {
    rootUri: { fsPath: root },
    state: {
      HEAD: { name: 'main', ahead: 1, behind: 0 },
      workingTreeChanges: [{ uri: { fsPath: `${root}\\a.py` }, status: 5 }],
      indexChanges: [],
      ...state,
    },
    diffWithHEAD: async (target) => `diff for ${target ?? '<all>'}`,
    log: async ({ maxEntries }) => Array.from({ length: Math.min(maxEntries, 3) }, (_, index) => ({
      hash: `h${index}`,
      message: `m${index}`,
      authorName: 'dev',
      authorDate: new Date('2026-11-01T00:00:00Z'),
    })),
  }
}

function fakeVscode(extensions) {
  return { extensions: { getExtension: (id) => extensions[id] } }
}

const apiOf = (repositories) => ({ repositories })

test('pickRepository 选包含目标路径的最深仓库', () => {
  const outer = fakeRepo('C:\\ws\\projects\\bili-player')
  const inner = fakeRepo('C:\\ws\\projects\\bili-player\\sub')
  const api = apiOf([outer, inner])
  assert.equal(git.pickRepository(api, 'C:\\ws\\projects\\bili-player\\sub\\main.py'), inner)
  assert.equal(git.pickRepository(api, 'C:\\ws\\projects\\bili-player\\main.py'), outer)
})

test('pickRepository 无匹配仓库时抛 NO_REPO', () => {
  const api = apiOf([fakeRepo('C:\\ws\\projects\\a')])
  assert.throws(() => git.pickRepository(api, 'D:\\elsewhere\\x.py'), (error) => error.code === 'NO_REPO')
})

test('pickRepository 未给路径时取第一个仓库', () => {
  const only = fakeRepo('C:\\ws\\a')
  assert.equal(git.pickRepository(apiOf([only])), only)
})

test('getGitApi 在扩展刚激活时重试一次', async () => {
  const api = apiOf([fakeRepo('C:\\ws\\a')])
  const extension = {
    activate: async () => undefined,
    exports: { getAPI: () => api },
  }
  let calls = 0
  const vscode = { extensions: { getExtension: () => (calls++ === 0 ? undefined : extension) } }
  const resolved = await git.getGitApi({ vscode, waitMs: 1 })
  assert.equal(resolved, api)
  assert.equal(calls, 2)
})

test('getGitApi 没有内置 Git 扩展时抛 NO_REPO', async () => {
  await assert.rejects(git.getGitApi({ vscode: fakeVscode({}), waitMs: 1 }), (error) => error.code === 'NO_REPO')
})

test('gitStatus 归一化分支与改动，并标注是否已暂存', () => {
  const repo = fakeRepo('C:\\ws\\a', {
    indexChanges: [{ uri: { fsPath: 'C:\\ws\\a\\b.py' }, status: 1 }],
  })
  const status = git.gitStatus(repo)
  assert.equal(status.branch, 'main')
  assert.equal(status.ahead, 1)
  assert.deepEqual(status.changes.map((change) => [change.path, change.staged]).sort(), [
    ['C:\\ws\\a\\a.py', false],
    ['C:\\ws\\a\\b.py', true],
  ])
})

test('gitLog 按 maxEntries 截断并保留字段', async () => {
  const repo = fakeRepo('C:\\ws\\a')
  const log = await git.gitLog(repo, 2)
  assert.equal(log.entries.length, 2)
  assert.deepEqual(Object.keys(log.entries[0]).sort(), ['author', 'date', 'hash', 'message'])
})

test('gitDiff 有 path 时比对该文件，无 path 时比对全仓', async () => {
  const repo = fakeRepo('C:\\ws\\a')
  assert.equal((await git.gitDiff(repo, { path: 'C:\\ws\\a\\a.py' })).text, 'diff for C:\\ws\\a\\a.py')
  assert.equal((await git.gitDiff(repo, {})).text, 'diff for <all>')
})

test('gitDiff 超长时标记 truncated 而不是把整坨塞回来', async () => {
  const repo = fakeRepo('C:\\ws\\a')
  repo.diffWithHEAD = async () => 'x'.repeat(200_000)
  const diff = await git.gitDiff(repo, {})
  assert.equal(diff.truncated, true)
  assert.ok(diff.text.length < 200_000)
})
