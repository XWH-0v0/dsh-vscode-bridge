import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import discovery from '../../extension/lib/discovery.js'

const sample = {
  version: '0.1.0',
  pid: 4321,
  port: 51234,
  token: 'tok-abc123',
  vscodeVersion: '1.116.0',
  folders: ['E:\\proj'],
  repoRoots: ['E:\\proj'],
  title: 'proj',
  startedAt: '2026-11-21T14:05:00.000Z',
}

test('写实例文件后内容完整且路径按 pid 命名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-'))
  const file = await discovery.writeInstanceFile(dir, sample)
  assert.equal(file, join(dir, 'instance-4321.json'))
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), sample)
})

test('删除实例文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-'))
  await discovery.writeInstanceFile(dir, sample)
  await discovery.removeInstanceFile(dir, sample.pid)
  assert.deepEqual(await readdir(dir), [])
})

test('删除不存在的实例文件不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-'))
  await discovery.removeInstanceFile(dir, 999)
})

test('列出实例文件时忽略其它文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-'))
  await discovery.writeInstanceFile(dir, sample)
  await discovery.writeInstanceFile(dir, { ...sample, pid: 1234 })
  await writeFile(join(dir, 'README.txt'), 'x', 'utf8')
  const files = await discovery.listInstanceFiles(dir)
  assert.deepEqual(files.map((f) => f.pid).sort((a, b) => a - b), [1234, 4321])
})

test('目录不存在时列出为空数组', async () => {
  const dir = join(tmpdir(), 'dsh-bridge-does-not-exist-xyz')
  assert.deepEqual(await discovery.listInstanceFiles(dir), [])
})

test('defaultBridgeDir 落在用户目录下的 .dsh/vscode-bridge', () => {
  const dir = discovery.defaultBridgeDir('C:\\Users\\me')
  assert.equal(dir, join('C:\\Users\\me', '.dsh', 'vscode-bridge'))
})
