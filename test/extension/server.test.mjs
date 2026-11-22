import test from 'node:test'
import assert from 'node:assert/strict'
import protocol from '../../extension/lib/protocol.js'

const TOKEN = 'tok-abc123'
const handlers = {
  ping: async () => ({ version: '0.1.0', pid: 4321, folders: ['E:\\work'], title: 'work' }),
  status: async () => ({ version: '0.1.0', pid: 4321, vscodeVersion: '1.116.0' }),
  boom: async () => {
    const error = new Error('仓库还没就绪')
    error.code = 'NO_REPO'
    throw error
  },
}

const call = (overrides = {}) => protocol.handleRequest({
  method: 'POST',
  url: '/rpc',
  headers: { 'x-dsh-bridge-token': TOKEN },
  body: '{"op":"status"}',
  handlers,
  token: TOKEN,
  ...overrides,
})

test('GET /ping 不需要 token', async () => {
  const response = await call({ method: 'GET', url: '/ping', headers: {}, body: undefined })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.result.pid, 4321)
  assert.deepEqual(response.json.result.folders, ['E:\\work'])
})

test('POST /rpc 缺 token 返回 401 BAD_TOKEN', async () => {
  const response = await call({ headers: {} })
  assert.equal(response.status, 401)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.error.code, 'BAD_TOKEN')
})

test('POST /rpc token 正确时执行 op', async () => {
  const response = await call()
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.result.vscodeVersion, '1.116.0')
})

test('未知 op 返回 UNSUPPORTED', async () => {
  const response = await call({ body: '{"op":"nope"}' })
  assert.equal(response.json.ok, false)
  assert.equal(response.json.error.code, 'UNSUPPORTED')
})

test('带 Origin 的请求一律 403', async () => {
  const response = await call({ headers: { 'x-dsh-bridge-token': TOKEN, origin: 'https://evil.example' } })
  assert.equal(response.status, 403)
  assert.equal(response.json.error.code, 'FORBIDDEN')
})

test('body 不是合法 JSON 返回 BAD_REQUEST', async () => {
  const response = await call({ body: '{oops' })
  assert.equal(response.json.ok, false)
  assert.equal(response.json.error.code, 'BAD_REQUEST')
})

test('op 抛出的错误保留自身 code 与 message', async () => {
  const response = await call({ body: '{"op":"boom"}' })
  assert.equal(response.json.ok, false)
  assert.equal(response.json.error.code, 'NO_REPO')
  assert.equal(response.json.error.message, '仓库还没就绪')
})

test('未知路径返回 404', async () => {
  const response = await call({ method: 'GET', url: '/etc/passwd', headers: {} })
  assert.equal(response.status, 404)
})
