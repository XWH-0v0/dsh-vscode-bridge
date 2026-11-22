'use strict'

const http = require('node:http')
const { handleRequest, fail, CODES } = require('./protocol.js')

const MAX_BODY_BYTES = 8 * 1024 * 1024

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(Object.assign(new Error('请求体超过 8 MiB'), { code: CODES.BAD_REQUEST }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * 只绑 127.0.0.1 的桥接服务。
 * @returns {Promise<{ port:number, close:() => Promise<void> }>}
 */
function createServer({ token, handlers, host = '127.0.0.1', port = 0 }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      let result
      try {
        const body = request.method === 'POST' ? await readBody(request) : undefined
        result = await handleRequest({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body,
          handlers,
          token,
        })
      } catch (error) {
        result = { status: 200, json: fail(error?.code ?? CODES.BAD_REQUEST, error?.message ?? '请求失败').json }
      }
      const payload = JSON.stringify(result.json)
      response.writeHead(result.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
      })
      response.end(payload)
    })

    server.on('error', reject)
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

module.exports = { createServer }
