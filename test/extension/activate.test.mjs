import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import activate from '../../extension/lib/activate.js'

const fakeVscode = {
  version: '1.116.0',
  workspace: {
    name: 'proj',
    workspaceFolders: [{ uri: { fsPath: 'E:\\proj' } }],
  },
}

async function start(overrides = {}) {
  const instanceDir = await mkdtemp(join(tmpdir(), 'dsh-bridge-activate-'))
  const bridge = await activate.startBridge({
    vscode: fakeVscode,
    extensionVersion: '0.1.0',
    instanceDir,
    autoStart: true,
    ...overrides,
  })
  return { bridge, instanceDir }
}

test('起桥后 /ping 返回进程与文件夹信息', async () => {
  const { bridge, instanceDir } = await start()
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/ping`)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.result.pid, process.pid)
    assert.equal(body.result.version, '0.1.0')
    assert.deepEqual(body.result.folders, ['E:\\proj'])
  } finally {
    await bridge.dispose()
  }
})

test('起桥写实例文件，dispose 后删除并关端口', async () => {
  const { bridge, instanceDir } = await start()
  const file = join(instanceDir, `instance-${process.pid}.json`)
  const { readFile } = await import('node:fs/promises')
  const record = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(record.port, bridge.port)
  assert.equal(record.token, bridge.token)
  await bridge.dispose()
  await assert.rejects(readFile(file, 'utf8'))
  await assert.rejects(fetch(`http://127.0.0.1:${bridge.port}/ping`))
})

test('autoStart 为 false 时不起桥也不写实例文件', async () => {
  const instanceDir = await mkdtemp(join(tmpdir(), 'dsh-bridge-off-'))
  const bridge = await activate.startBridge({
    vscode: fakeVscode,
    extensionVersion: '0.1.0',
    instanceDir,
    autoStart: false,
  })
  assert.equal(bridge, undefined)
  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(instanceDir), [])
})
