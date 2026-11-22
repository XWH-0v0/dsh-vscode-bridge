'use strict'

const fs = require('node:fs/promises')
const git = require('./git.js')
const documents = require('./documents.js')
const context = require('./context.js')
const terminal = require('./terminal.js')

async function fileExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * 桥接 op 表：每个 op 对应一个 VSCode 侧动作。
 * 新增域（term/context）时在这里挂表即可。
 */
function createHandlers({ vscode, diffStore }) {
  const withRepo = async (path, run) => {
    const api = await git.getGitApi({ vscode })
    const repository = git.pickRepository(api, path)
    return run(repository, api)
  }

  return {
    'git.status': async ({ path }) => withRepo(path, (repository, api) => ({
      ...git.gitStatus(repository),
      repoRoots: api.repositories.map((item) => item.rootUri?.fsPath ?? '').filter(Boolean),
    })),

    'git.log': async ({ path, maxEntries }) => withRepo(path, (repository) => git.gitLog(repository, maxEntries)),

    'git.diff': async ({ path, ref }) => withRepo(path, (repository) => git.gitDiff(repository, { path, ref })),

    'git.add': async ({ path, paths }) => withRepo(path, (repository) => git.gitAdd(repository, { paths })),

    'git.commit': async ({ path, message, all }) => withRepo(path, (repository) => git.gitCommit(repository, { message, all })),

    'git.branchCreate': async ({ path, name, checkout }) => withRepo(path, (repository) => git.gitBranchCreate(repository, { name, checkout })),

    'git.branchList': async ({ path }) => withRepo(path, (repository) => git.gitBranchList(repository)),

    'git.checkout': async ({ path, ref }) => withRepo(path, (repository) => git.gitCheckout(repository, { ref })),

    'git.fetch': async ({ path, all }) => withRepo(path, (repository) => git.gitFetch(repository, { all })),

    'git.pull': async ({ path }) => withRepo(path, (repository) => git.gitPull(repository)),

    'git.push': async ({ path, setUpstream }) => withRepo(path, (repository) => git.gitPush(repository, { setUpstream })),

    'git.stash': async () => git.gitStash(),

    'doc.read': async ({ paths, range }) => ({
      documents: await documents.readDocuments({ vscode, fileExists }, { paths, range }),
    }),

    'doc.edit': async ({ edits, save, format }) => ({
      results: await documents.applyEdits({ vscode, defaultSave: true }, { edits, save, format }),
    }),

    'doc.open': async ({ path, line, column }) => documents.openDocument({ vscode }, { path, line, column }),

    'doc.diff': async ({ path, before, after, ref }) => documents.openDiff({ vscode, store: diffStore }, { path, before, after, ref }),

    'context.activeEditor': async () => {
      const editor = context.activeEditor({ vscode })
      // schema 里 editor 是对象；没有编辑器时整体省略，不要塞 null
      return editor ? { editor } : {}
    },

    'context.selection': async () => {
      const value = context.selection({ vscode })
      if (!value.editor) {
        const { editor, ...rest } = value
        return rest
      }
      return value
    },

    'context.openEditors': async () => context.openEditors({ vscode }),

    'context.diagnostics': async ({ path, severity }) => context.diagnostics({ vscode }, { path, severity }),

    'context.workspaceFolders': async () => context.workspaceFolders({ vscode }),

    'term.run': async ({ command, cwd, timeoutMs }) => terminal.runCommand({ vscode }, { command, cwd, timeoutMs }),

    'term.list': async () => terminal.listTerminals({ vscode }),

    'term.show': async ({ name }) => terminal.showTerminal({ vscode }, { name }),

    'term.kill': async ({ name }) => terminal.killTerminal({ vscode }, { name }),
  }
}

module.exports = { createHandlers }
