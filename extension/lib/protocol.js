'use strict'

const crypto = require('node:crypto')

/** 协议错误码；DSH 侧按这些码翻译成"下一步该做什么"。 */
const CODES = Object.freeze({
  BAD_TOKEN: 'BAD_TOKEN',
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  UNSUPPORTED: 'UNSUPPORTED',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
  CONFLICT: 'CONFLICT',
  NO_REPO: 'NO_REPO',
  IDENTITY_MISSING: 'IDENTITY_MISSING',
  GIT_ERROR: 'GIT_ERROR',
  TIMEOUT: 'TIMEOUT',
  TERMINAL_NO_SHELL_INTEGRATION: 'TERMINAL_NO_SHELL_INTEGRATION',
  INTERNAL: 'INTERNAL',
})

function ok(result) {
  return { status: 200, json: { ok: true, result } }
}

function fail(code, message, detail) {
  const error = { code, message: String(message ?? '') }
  if (detail !== undefined) error.detail = detail
  return { status: 200, json: { ok: false, error } }
}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function tokenMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function pathnameOf(url) {
  try {
    return new URL(url, 'http://127.0.0.1').pathname
  } catch {
    return url
  }
}

/**
 * 纯函数式请求处理：不碰网络，便于单测。
 * @returns {Promise<{status:number, json:object}>}
 */
async function handleRequest({ method, url, headers = {}, body, handlers, token }) {
  if (header(headers, 'origin') !== undefined) {
    return { status: 403, json: fail(CODES.FORBIDDEN, '拒绝来自浏览器的请求').json }
  }

  const pathname = pathnameOf(url)
  const verb = String(method || 'GET').toUpperCase()

  if (verb === 'GET' && pathname === '/ping') {
    try {
      return ok(await handlers.ping())
    } catch (error) {
      return fail(CODES.INTERNAL, error?.message ?? 'ping 失败')
    }
  }

  if (verb !== 'POST' || pathname !== '/rpc') {
    return { status: 404, json: fail(CODES.NOT_FOUND, `没有这个路径：${pathname}`).json }
  }

  if (!tokenMatches(token, header(headers, 'x-dsh-bridge-token'))) {
    return { status: 401, json: fail(CODES.BAD_TOKEN, 'token 不匹配；桥接可能已重启，重读实例文件').json }
  }

  let payload
  try {
    payload = JSON.parse(typeof body === 'string' ? body : String(body ?? ''))
  } catch {
    return { status: 200, json: fail(CODES.BAD_REQUEST, 'body 不是合法 JSON').json }
  }

  const op = payload?.op
  if (typeof op !== 'string' || op.length === 0) {
    return { status: 200, json: fail(CODES.BAD_REQUEST, '缺少 op 字段').json }
  }

  const handler = handlers[op]
  if (typeof handler !== 'function') {
    return { status: 200, json: fail(CODES.UNSUPPORTED, `未实现的操作：${op}`).json }
  }

  try {
    return ok(await handler(payload.args ?? {}))
  } catch (error) {
    const code = typeof error?.code === 'string' && error.code ? error.code : CODES.INTERNAL
    return { status: 200, json: fail(code, error?.message ?? '执行失败', error?.detail).json }
  }
}

module.exports = { CODES, ok, fail, handleRequest, tokenMatches }
