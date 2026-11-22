import { callBridge, discoverInstances, resolveBridge, BridgeError } from './client.js'
import { openFolderWindow } from './open-window.js'
import { formatStatus, stripAnsi } from './format.js'

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) })
const num = (description) => ({ type: 'number', ...(description ? { description } : {}) })
const bool = (description) => ({ type: 'boolean', ...(description ? { description } : {}) })
const obj = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
})

function cwdOf(ctx, exec) {
  try {
    const session = exec?.agent?.session
    if (session) return ctx.workingDirectory.get(session)
  } catch {
    // 拿不到会话目录就退回进程目录
  }
  return process.cwd()
}

function describeInstance(instance) {
  return {
    pid: instance.pid,
    port: instance.port,
    title: instance.title ?? '',
    folders: instance.folders ?? [],
    repoRoots: instance.repoRoots ?? [],
    vscodeVersion: instance.vscodeVersion ?? '',
  }
}

function asToolError(error) {
  if (error instanceof BridgeError) {
    return Object.assign(new Error(`${error.code}: ${error.message}`), { code: error.code })
  }
  return error
}

const GIT_ACTIONS = ['status', 'diff', 'log', 'add', 'commit', 'branch_create', 'branch_list', 'checkout', 'fetch', 'pull', 'push', 'stash']
const READ_ACTIONS = new Set(['status', 'diff', 'log'])

function renderGit(args, value) {
  if (args.action === 'status') {
    const flags = `${value.ahead ? ` ↑${value.ahead}` : ''}${value.behind ? ` ↓${value.behind}` : ''}`
    const lines = [`仓库 ${value.root} · 分支 ${value.branch || '(detached)'}${flags}`]
    if (!value.changes?.length) lines.push('工作区干净')
    for (const change of value.changes ?? []) {
      lines.push(`${change.staged ? '[已暂存]' : '[未暂存]'} ${change.statusCode} ${change.path}`)
    }
    return lines.join('\n')
  }
  if (args.action === 'log') {
    if (!value.entries?.length) return '没有提交记录'
    return value.entries
      .map((entry) => `${String(entry.hash).slice(0, 8)} ${String(entry.date).slice(0, 10)} ${String(entry.message).split('\n')[0]} (${entry.author})`)
      .join('\n')
  }
  if (typeof value.text === 'string') {
    return value.text.length > 0 ? value.text : '（没有差异）'
  }
  return JSON.stringify(value, null, 2)
}

export function terminalTimeouts(args = {}, base = 15_000, defaultCommandMs = 60_000) {
  const requested = Number(args?.timeoutMs)
  const commandMs = Number.isFinite(requested) && requested > 0 ? requested : defaultCommandMs
  // 请求层必须比命令本身活得久，否则客户端先超时、终端里还在跑
  return { commandMs, requestMs: Math.max(base, commandMs + 10_000) }
}

export function createTools({ ctx, settings, logger }) {
  const timeoutMs = settings.requestTimeoutMs

  async function bridgeFor(exec, { targetPath, window } = {}) {
    return resolveBridge({
      dir: settings.bridgeDir,
      cwd: cwdOf(ctx, exec),
      targetPath,
      window,
      timeoutMs,
    })
  }

  const statusTool = {
    name: 'vscode_status',
    description: '查看 VSCode 桥接状态：连到哪个窗口、打开了哪些文件夹、有哪些 git 仓库。桥接报错或不确定该改哪个窗口时先调它。连不上时返回 connected:false 与候选列表，不抛错。',
    parameters: obj({
      window: str('可选：用 pid 或文件夹路径指定窗口，多窗口时用'),
    }),
    output: {
      schema: obj({
        connected: bool('是否连上桥接'),
        bridge: obj({
          pid: num('VSCode 窗口进程号'),
          port: num('桥接端口'),
          title: str('窗口标题'),
          version: str('扩展版本'),
          vscodeVersion: str('VSCode 版本'),
          folders: { type: 'array', items: { type: 'string' } },
          repoRoots: { type: 'array', items: { type: 'string' } },
          startedAt: str('桥接启动时间'),
        }),
        code: str('失败时的错误码'),
        message: str('失败原因'),
        candidates: {
          type: 'array',
          items: obj({
            pid: num('窗口进程号'),
            port: num('桥接端口'),
            title: str('窗口标题'),
            folders: { type: 'array', items: { type: 'string' } },
            repoRoots: { type: 'array', items: { type: 'string' } },
          }),
        },
        runtime: obj({
          cwd: str('当前会话工作目录'),
          preferVscodeForCode: str('代码开发策略：ask/always/never'),
        }),
      }, ['connected']),
      render: (_args, value) => [{ type: 'text', text: formatStatus(value) }],
    },
    timeoutMs: timeoutMs + 3000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const instance = await bridgeFor(exec, { window: args.window })
        const status = await callBridge(instance, 'status', {}, { timeoutMs })
        return {
          connected: true,
          bridge: { ...describeInstance(instance), ...status },
          runtime: { cwd: cwdOf(ctx, exec), preferVscodeForCode: settings.preferVscodeForCode },
        }
      } catch (error) {
        const instances = await discoverInstances({ dir: settings.bridgeDir, timeoutMs: 500 }).catch(() => [])
        return {
          connected: false,
          code: error?.code ?? 'INTERNAL',
          message: error?.message ?? String(error),
          candidates: instances.map(describeInstance),
          runtime: { cwd: cwdOf(ctx, exec), preferVscodeForCode: settings.preferVscodeForCode },
        }
      }
    },
  }

  const gitTool = {
    name: 'vscode_git',
    description: '走 VSCode 的源代码管理做 git：状态/差异/历史，以及暂存、提交、建分支、checkout、fetch、pull、push、stash。凭据由 VSCode 登录一次后长期有效；写操作只在用户明确要求时执行。',
    parameters: obj({
      action: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'add', 'commit', 'branch_create', 'branch_list', 'checkout', 'fetch', 'pull', 'push', 'stash'],
        description: '要执行的 git 动作',
      },
      path: str('可选：仓库内的任意路径，用来在多仓库时指定目标仓库；不给则用当前窗口的第一个仓库'),
      ref: str('diff 的对比基准，默认 HEAD'),
      maxEntries: { type: 'integer', description: 'log 的条数上限，默认 20' },
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
      message: str('commit 的提交说明'),
      all: bool('commit 时是否连同未暂存的改动一起提交（等价 git commit -a），默认只提交已暂存'),
      paths: { type: 'array', items: { type: 'string' }, description: 'add 要暂存的文件路径' },
      name: str('branch_create 的分支名'),
      checkout: bool('branch_create 后是否切换过去，默认 true'),
      setUpstream: bool('push 时是否强制设置上游分支；分支本来没有上游时会自动设置'),
    }, ['action']),
    output: {
      schema: obj({
        root: str('仓库根目录'),
        branch: str('当前分支'),
        commit: str('当前提交'),
        ahead: num('领先上游的提交数'),
        behind: num('落后上游的提交数'),
        changes: {
          type: 'array',
          items: obj({
            path: str('文件路径'),
            statusCode: str('单字母状态码'),
            rawStatusCode: num('原始状态码'),
            staged: bool('是否已暂存'),
          }),
        },
        repoRoots: { type: 'array', items: { type: 'string' } },
        entries: {
          type: 'array',
          items: obj({ hash: str('提交'), message: str('说明'), author: str('作者'), date: str('时间') }),
        },
        text: str('diff 文本'),
        truncated: bool('是否被截断'),
        action: str('实际执行的动作'),
        message: str('commit 的说明'),
        all: bool('commit：是否包含未暂存改动；fetch：是否取全部远程（--all）'),
        remote: str('push 的远程名'),
        setUpstream: bool('push 是否设置了上游'),
        name: str('分支名'),
        checkout: bool('建分支后是否切换'),
        current: str('当前分支'),
        ref: str('checkout 的目标'),
        branches: {
          type: 'array',
          items: obj({ name: str(), current: bool(), upstream: str(), ahead: num(), behind: num() }),
        },
        paths: { type: 'array', items: { type: 'string' } },
      }),
      render: (args, value) => [{ type: 'text', text: renderGit(args, value) }],
    },
    timeoutMs: 130_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const action = String(args.action ?? '')
      if (!GIT_ACTIONS.includes(action)) {
        throw new Error(`UNSUPPORTED: 没有这个 git 动作：${action}`)
      }
      const op = action === 'branch_create' ? 'git.branchCreate' : action === 'branch_list' ? 'git.branchList' : `git.${action}`
      const payload = {}
      if (args.path !== undefined) payload.path = args.path
      if (args.ref !== undefined) payload.ref = args.ref
      if (args.maxEntries !== undefined) payload.maxEntries = args.maxEntries
      if (args.message !== undefined) payload.message = args.message
      if (args.all !== undefined) payload.all = args.all
      if (args.paths !== undefined) payload.paths = args.paths
      if (args.name !== undefined) payload.name = args.name
      if (args.checkout !== undefined) payload.checkout = args.checkout
      if (args.setUpstream !== undefined) payload.setUpstream = args.setUpstream
      try {
        const instance = await bridgeFor(exec, { targetPath: args.path, window: args.window })
        return await callBridge(instance, op, payload, { timeoutMs: Math.max(timeoutMs, 120_000) })
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  const positionSchema = obj({
    line: { type: 'number', description: '行号，0 基（与 LSP 一致）' },
    character: { type: 'number', description: '列号，0 基' },
  }, ['line', 'character'])

  const readTool = {
    name: 'vscode_read',
    description: '读 VSCode 里文件的实时内容（包含用户还没保存的手改）与文档版本号。改代码前先读，把 version 作为 baseVersion 传给 vscode_edit。',
    parameters: obj({
      paths: { type: 'array', items: { type: 'string' }, description: '要读的绝对路径列表' },
      range: obj({ start: positionSchema, end: positionSchema }, ['start', 'end']),
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
    }, ['paths']),
    output: {
      schema: obj({
        documents: {
          type: 'array',
          items: obj({
            path: str('文件路径'),
            text: str('内容'),
            truncated: bool('是否被截断'),
            version: num('文档版本号，用于 baseVersion'),
            isDirty: bool('是否有未保存改动'),
            existsOnDisk: bool('磁盘上是否还存在这个文件'),
          }),
        },
      }),
      render: (_args, value) => [{
        type: 'text',
        text: (value.documents ?? []).map((doc) => [
          `<file path="${doc.path}" version="${doc.version}" dirty="${doc.isDirty}" on_disk="${doc.existsOnDisk}">`,
          doc.text,
          '</file>',
        ].join('\n')).join('\n\n'),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const instance = await bridgeFor(exec, { targetPath: args.paths?.[0], window: args.window })
        return await callBridge(instance, 'doc.read', { paths: args.paths, range: args.range }, { timeoutMs })
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  const editTool = {
    name: 'vscode_edit',
    description: '在 VSCode 里改文件：一次可改多个文件，每个文件可给整文件内容或按区间替换。默认保存。带 baseVersion 时若文档已被改动会返回 conflict 而不是覆盖。',
    parameters: obj({
      edits: {
        type: 'array',
        items: obj({
          path: str('文件绝对路径'),
          fullText: str('整文件替换成这个内容（与 start/end 互斥）'),
          start: positionSchema,
          end: positionSchema,
          text: str('区间替换成的文本'),
          baseVersion: { type: 'number', description: '从 vscode_read 拿到的版本号；不一致就报冲突' },
        }, ['path']),
        description: '编辑列表',
      },
      save: bool('是否保存，默认 true'),
      format: bool('应用后是否格式化当前编辑器'),
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
    }, ['edits']),
    output: {
      schema: obj({
        results: {
          type: 'array',
          items: obj({
            path: str('文件路径'),
            applied: bool('是否已应用'),
            created: bool('是否新建了文件'),
            conflict: bool('是否因版本冲突被拒'),
            version: num('应用后的版本号'),
            saved: bool('是否已保存'),
          }),
        },
      }),
      render: (_args, value) => [{
        type: 'text',
        text: (value.results ?? []).map((item) => item.conflict
          ? `冲突：${item.path} 已被改动（当前版本 ${item.version}）；先重新 vscode_read 再改`
          : `${item.applied ? '已改' : '未改'}：${item.path}${item.saved ? '（已保存）' : ''}`).join('\n'),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      try {
        const firstPath = args.edits?.[0]?.path
        const instance = await bridgeFor(exec, { targetPath: firstPath, window: args.window })
        return await callBridge(instance, 'doc.edit', { edits: args.edits, save: args.save, format: args.format }, { timeoutMs })
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  const openTool = {
    name: 'vscode_open',
    description: '在 VSCode 里打开文件（可定位到行列）、打开 before/after 对比、或新开一个文件夹窗口。改完代码用 diff 让用户 review。',
    parameters: obj({
      action: { type: 'string', enum: ['file', 'diff', 'folder'], description: '打开什么' },
      path: str('文件路径（file/diff）或文件夹路径（folder）'),
      line: { type: 'number', description: 'file 动作的行号，1 基' },
      column: { type: 'number', description: 'file 动作的列号，1 基' },
      before: str('diff 动作的左侧内容；不给 ref 时必填'),
      after: str('diff 动作的右侧内容，默认用当前内容'),
      ref: str('diff 动作与这个 git 引用对比，例如 HEAD'),
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
    }, ['action', 'path']),
    output: {
      schema: obj({
        title: str('打开的对比标题'),
        line: { type: 'number', description: '定位到的行' },
        uri: str('打开的文件'),
        path: str('打开的文件路径'),
        opened: bool('是否新开了窗口'),
        reused: bool('是否复用了已有窗口'),
        pid: { type: 'number', description: '窗口进程号' },
        port: { type: 'number', description: '桥接端口' },
        waitedMs: { type: 'number', description: '等待桥接就绪的毫秒数' },
        folders: { type: 'array', items: { type: 'string' } },
      }),
      render: (args, value) => [{
        type: 'text',
        text: args.action === 'diff'
          ? `已打开对比：${value.title}`
          : args.action === 'folder'
            ? `${value.reused ? '复用' : '新开'}窗口：${args.path}（pid ${value.pid}，端口 ${value.port}）`
            : `已打开：${value.uri ?? args.path}${value.line ? `:${value.line}` : ''}`,
      }],
    },
    timeoutMs: Math.max(timeoutMs, 45_000), // 开窗口要等桥接就绪（默认 20s），不能卡在请求超时上
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        if (args.action === 'folder') {
          const opened = await openFolderWindow({ path: args.path, settings, window: args.window })
          return { uri: args.path, title: opened.reused ? '复用已有窗口' : '已打开新窗口', ...opened }
        }
        const instance = await bridgeFor(exec, { targetPath: args.path, window: args.window })
        const op = args.action === 'diff' ? 'doc.diff' : 'doc.open'
        return await callBridge(instance, op, {
          path: args.path,
          line: args.line,
          column: args.column,
          before: args.before,
          after: args.after,
          ref: args.ref,
        }, { timeoutMs })
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  const editorSchema = obj({
    path: str('文件路径'),
    languageId: str('语言'),
    lineCount: num('行数'),
    isDirty: bool('是否有未保存改动'),
    length: num('字符数'),
    preview: str('内容预览'),
  })

  const contextSchema = obj({
    editor: editorSchema,
    empty: bool('选区是否为空'),
    text: str('选中的文本'),
    start: positionSchema,
    end: positionSchema,
    editors: { type: 'array', items: obj({ path: str(), languageId: str(), isActive: bool(), isDirty: bool() }) },
    folders: { type: 'array', items: obj({ path: str(), name: str() }) },
    total: num('诊断总数'),
    truncated: bool('是否截断'),
    items: {
      type: 'array',
      items: obj({ path: str(), severity: str(), message: str(), line: num() }),
    },
  })

  const contextTool = {
    name: 'vscode_context',
    description: '读 VSCode 里的上下文：当前选区、活动文件、已打开编辑器、语言服务器诊断（红波浪线）、工作区文件夹。review 或定位问题时用。',
    parameters: obj({
      action: {
        type: 'string',
        enum: ['active_editor', 'selection', 'open_editors', 'diagnostics', 'workspace_folders'],
        description: '要取哪种上下文',
      },
      path: str('diagnostics 只看这个文件'),
      severity: { type: 'string', enum: ['error', 'warning', 'information', 'hint'], description: '诊断的严重级过滤' },
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
    }, ['action']),
    output: {
      schema: contextSchema,
      render: (args, value) => [{
        type: 'text',
        text: args.action === 'selection'
          ? (value.empty ? '当前没有选中内容' : `${value.editor?.path}:${(value.start?.line ?? 0) + 1}\n${value.text}`)
          : args.action === 'diagnostics'
            ? `诊断 ${value.total} 条${value.truncated ? '（已截断）' : ''}\n${(value.items ?? []).map((item) => `${item.path}:${item.line} [${item.severity}] ${item.message}`).join('\n')}`
            : JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const map = {
        active_editor: 'context.activeEditor',
        selection: 'context.selection',
        open_editors: 'context.openEditors',
        diagnostics: 'context.diagnostics',
        workspace_folders: 'context.workspaceFolders',
      }
      const op = map[args.action]
      if (!op) throw new Error(`UNSUPPORTED: 没有这个上下文动作：${args.action}`)
      try {
        const instance = await bridgeFor(exec, { window: args.window })
        return await callBridge(instance, op, { path: args.path, severity: args.severity }, { timeoutMs })
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  const terminalTool = {
    name: 'vscode_terminal',
    description: '在 VSCode 的集成终端里跑命令并取回输出与退出码（用于构建、dev server、跑测试这类用户要看过程的命令）。常规命令优先用 pwsh。',
    parameters: obj({
      action: { type: 'string', enum: ['run', 'list', 'show', 'kill'], description: '要做什么' },
      command: str('run 要执行的命令'),
      cwd: str('run 的工作目录'),
      timeoutMs: { type: 'number', description: 'run 的超时毫秒数，默认 60000' },
      name: str('终端名（show/kill 用来定位）'),
      window: str('可选：指定 VSCode 窗口（pid 或文件夹）'),
    }, ['action']),
    output: {
      schema: obj({
        exitCode: num('退出码'),
        output: str('命令输出'),
        truncated: bool('输出是否被截断'),
        usedShellIntegration: bool('是否走了 shell integration'),
        terminal: str('终端名'),
        terminals: { type: 'array', items: obj({ name: str(), processId: num(), usedShellIntegration: bool() }) },
        name: str('终端名'),
        killed: str('被关掉的终端'),
        readError: str('读取输出时的错误'),
      }),
      render: (args, value) => [{
        type: 'text',
        text: args.action === 'run'
          ? `退出码 ${value.exitCode}${value.truncated ? '（输出已截断）' : ''}\n${value.output}`
          : JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const op = `term.${args.action}`
      const { commandMs, requestMs } = terminalTimeouts(args, timeoutMs)
      try {
        const instance = await bridgeFor(exec, { window: args.window })
        const value = await callBridge(instance, op, {
          command: args.command,
          cwd: args.cwd,
          timeoutMs: commandMs,
          name: args.name,
        }, { timeoutMs: requestMs })
        if (value && typeof value.output === 'string') value.output = stripAnsi(value.output)
        return value
      } catch (error) {
        throw asToolError(error)
      }
    },
  }

  return [statusTool, gitTool, readTool, editTool, openTool, contextTool, terminalTool]
}

export { asToolError }
