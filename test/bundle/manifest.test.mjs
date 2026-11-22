import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

async function readJson(relative) {
  return JSON.parse(await readFile(join(root, relative), 'utf8'))
}

test('bundle 的 files 覆盖运行所需文件', async () => {
  const manifest = await readJson('bundle/package.json')
  for (const required of ['index.js', 'lib', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'docs']) {
    assert.ok(manifest.files.includes(required), `files 缺 ${required}`)
  }
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.type, 'module')
})

test('locale 有真实标题与描述，且 detail 指向存在的文件', async () => {
  for (const locale of ['zh', 'en']) {
    const data = await readJson(`bundle/locale/${locale}.json`)
    assert.ok(data.meta?.title && data.meta.title.length > 2, `${locale} 缺 title`)
    assert.ok(data.meta?.description && data.meta.description.length > 20, `${locale} 缺 description`)
    assert.equal(data.meta.detail, 'docs/DETAIL.md')
  }
  await readFile(join(root, 'bundle/docs/DETAIL.md'), 'utf8')
})

test('扩展 manifest 无运行时依赖且入口存在', async () => {
  const manifest = await readJson('extension/package.json')
  assert.equal(manifest.engines?.vscode, '^1.93.0')
  assert.equal(manifest.main, './extension.js')
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.type, undefined, '扩展必须是 CommonJS')
  await readFile(join(root, 'extension/extension.js'), 'utf8')
})

test('cordis.patch.yml 只有一行且 id 与包名唯一', async () => {
  const text = await readFile(join(root, 'bundle/cordis.patch.yml'), 'utf8')
  assert.match(text, /id:\s*vscode-bridge/)
  assert.match(text, /name:\s*'@local\/dsh-vscode-bridge'/)
  assert.equal((text.match(/- insert:/g) ?? []).length, 1)
})
