'use strict'

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const INSTANCE_PATTERN = /^instance-(\d+)\.json$/

function defaultBridgeDir(home = os.homedir()) {
  return path.join(home, '.dsh', 'vscode-bridge')
}

function instanceFilePath(dir, pid) {
  return path.join(dir, `instance-${pid}.json`)
}

async function writeInstanceFile(dir, data) {
  await fs.mkdir(dir, { recursive: true })
  const file = instanceFilePath(dir, data.pid)
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(temp, file)
  return file
}

async function removeInstanceFile(dir, pid) {
  try {
    await fs.unlink(instanceFilePath(dir, pid))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function listInstanceFiles(dir) {
  let names
  try {
    names = await fs.readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const entries = []
  for (const name of names) {
    const match = INSTANCE_PATTERN.exec(name)
    if (!match) continue
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8')
      const data = JSON.parse(raw)
      if (typeof data?.port !== 'number' || typeof data?.token !== 'string') continue
      entries.push({ ...data, pid: Number(data.pid ?? match[1]), file: path.join(dir, name) })
    } catch {
      // 损坏的实例文件直接跳过：它只能说明上个窗口没优雅退出
    }
  }
  return entries
}

module.exports = {
  defaultBridgeDir,
  instanceFilePath,
  writeInstanceFile,
  removeInstanceFile,
  listInstanceFiles,
}
