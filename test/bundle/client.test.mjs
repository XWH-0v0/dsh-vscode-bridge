import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as client from '../../bundle/lib/client.js'

const instance = (pid, port, folders, repoRoots = folders) => ({
  version: '0.1.0',
  pid,
  port,
  token: `tok-${pid}`,
  vscodeVersion: '1.116.0',
  folders,
  repoRoots,
  title: `w${pid}`,
  startedAt: '2026-11-21T14:00:00.000Z',
})

const W1 = instance(101, 51001, ['C:\\ws\\projects\\bili-player'])
const W2 = instance(202, 51002, ['C:\\ws\\projects\\other'])
const W3 = instance(303, 51003, ['C:\\ws'])

test('显式 window(pid) 直接命中', () => {
  const picked = client.selectInstance([W1, W2], { window: 202, cwd: 'C:\\elsewhere' })
  assert.equal(picked.instance.pid, 202)
})

test('targetPath 命中仓库，且取最深的那个', () => {
  const nested = instance(404, 51004, ['C:\\ws\\projects\\bili-player\\sub'], ['C:\\ws\\projects\\bili-player\\sub'])
  const picked = client.selectInstance([W1, nested], { targetPath: 'C:\\ws\\projects\\bili-player\\sub\\main.py' })
  assert.equal(picked.instance.pid, 404)

  const outer = client.selectInstance([W1, nested], { targetPath: 'C:\\ws\\projects\\bili-player\\main.py' })
  assert.equal(outer.instance.pid, 101)
})

test('cwd 与窗口是父子关系都算命中', () => {
  // DSH 在工作区根，VSCode 开的是子目录
  assert.equal(client.selectInstance([W1], { cwd: 'C:\\ws' }).instance.pid, 101)
  // DSH 在子目录，VSCode 开的是父目录
  assert.equal(client.selectInstance([W3], { cwd: 'C:\\ws\\projects\\bili-player' }).instance.pid, 303)
})

test('同样具体的多个候选 → AMBIGUOUS_WINDOW 并带候选', () => {
  const a = instance(501, 51005, ['C:\\ws\\projects\\a'])
  const b = instance(502, 51006, ['C:\\ws\\projects\\b'])
  const picked = client.selectInstance([a, b], { cwd: 'C:\\ws' })
  assert.equal(picked.code, 'AMBIGUOUS_WINDOW')
  assert.deepEqual(picked.candidates.map((c) => c.pid).sort(), [501, 502])
})

test('没有任何命中 → BRIDGE_UNAVAILABLE', () => {
  const picked = client.selectInstance([W1], { cwd: 'D:\\totally\\elsewhere' })
  assert.equal(picked.code, 'BRIDGE_UNAVAILABLE')
})

test('targetPath 无命中时不退回 cwd 兜底', () => {
  // cwd 能命中 W1，但目标文件在别的项目里：不能拿 W1 去写
  const picked = client.selectInstance([W1], { targetPath: 'C:\\ws\\projects\\other\\x.py', cwd: 'C:\\ws' })
  assert.equal(picked.code, 'BRIDGE_UNAVAILABLE')
  assert.deepEqual(picked.candidates.map((c) => c.pid), [101])
})

test('discoverInstances 过滤掉 ping 不通的实例，并采用 ping 返回的 folders', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-bundle-'))
  const alive = instance(101, 51001, ['C:\\stale'])
  const dead = instance(202, 51002, ['C:\\dead'])
  for (const record of [alive, dead]) {
    await writeFile(join(dir, `instance-${record.pid}.json`), JSON.stringify(record), 'utf8')
  }
  const fetchImpl = async (url) => {
    if (String(url).includes('51002')) throw new Error('ECONNREFUSED')
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { version: '0.1.0', pid: 101, folders: ['C:\\fresh'], vscodeVersion: '1.116.0', title: 'w101' } }),
    }
  }
  const found = await client.discoverInstances({ dir, fetchImpl })
  assert.equal(found.length, 1)
  assert.equal(found[0].pid, 101)
  assert.deepEqual(found[0].folders, ['C:\\fresh'])
})

test('callBridge 带 token 调用 op，错误码映射成 BridgeError', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: { code: 'NO_REPO', message: '没有仓库' } }),
    }
  }
  await assert.rejects(
    client.callBridge(W1, 'git.status', {}, { fetchImpl }),
    (error) => error.code === 'NO_REPO' && error.message === '没有仓库',
  )
  assert.equal(calls[0].init.headers['x-dsh-bridge-token'], 'tok-101')
  assert.equal(JSON.parse(calls[0].init.body).op, 'git.status')
})

test('callBridge 超时映射成 TIMEOUT', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  await assert.rejects(
    client.callBridge(W1, 'status', {}, { fetchImpl, timeoutMs: 20 }),
    (error) => error.code === 'TIMEOUT',
  )
})
