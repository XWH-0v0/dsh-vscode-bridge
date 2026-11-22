# dsh-vscode-bridge

把 VSCode 变成 DeepSeek Harness 的**工作台**：需要看 diff、跑真实终端、读诊断、走源代码管理做 git 时用它；
平时的读写与批量编辑仍走原生工具，快且直接。git 凭据只需在 VSCode 里登录一次，之后 fetch/push/pull 都不再要密钥。

工作台是**按需**的：需要时自己打开，不主动问用户；VSCode 没开就 `vscode_open(action:"folder")` 自己开。

设计见 [DESIGN.md](../../docs/dsh-vscode-bridge-docs/DESIGN.md)，实施计划见 [PLAN.md](../../docs/dsh-vscode-bridge-docs/PLAN.md)。

## 结构

```text
extension/        VSCode 扩展（零依赖 CommonJS，装进 ~/.vscode/extensions）
bundle/           DSH Host 插件（注册 8 个 vscode_* 工具）
scripts/install.ps1   安装扩展 + 提示重载
test/             单元测试（node:test，注入伪 vscode 模块）
```

桥是单向的：DSH 作为客户端，按实例文件找到 VSCode 窗口，再用 JSON-RPC over HTTP 调用扩展。

开发流程（分支命名、review 与测试门槛、推送 `main` 必须用户确认）见 [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md)。

## 安装

1. 装扩展：
   ```powershell
   pwsh -File scripts/install.ps1
   ```
   然后在 VSCode 里 `Ctrl+Shift+P` → **Developer: Reload Window**。状态栏出现 `DSH:<端口>` 即就绪。
   安装目录固定为 `local.dsh-vscode-bridge`（不带版本号），升级时原地覆盖、路径不变。
   若开启了 `dshVscodeBridge.hotReload`（默认关），`scripts/install.ps1` 写的
   `~/.dsh/vscode-bridge/reload.trigger` 会让窗口自动重启扩展宿主；否则用
   `vscode_dev(action:"reload")`（会轮询实例 pid 确认真的是否重启）或手动重载一次。

2. 装 DSH 插件（bundle）。先装依赖（bundle 是链接目录，pnpm 不会自动装它的依赖）：
   ```powershell
   $node = "C:\Users\MECHREVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
   $pnpm = "C:\Users\MECHREVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
   cd bundle; & $node $pnpm install
   ```
   然后在 DSH 里用 `plugin_manager` 的 `install_bundle` 指向 `bundle/` 的绝对路径，或 **Plugins → 添加本地目录**。

## 工具

| 工具 | 用途 |
|---|---|
| `vscode_status` | 连到哪个窗口、文件夹与仓库；连不上时给候选列表 |
| `vscode_open` | 打开文件（可到行列）、打开 before/after 对比、新开窗口 |
| `vscode_context` | 选区、活动文件、打开编辑器、诊断、工作区文件夹 |
| `vscode_read` | 读实时内容（含未保存改动）+ 文档版本号 |
| `vscode_edit` | 批量编辑，带 `baseVersion` 冲突保护，默认保存 |
| `vscode_terminal` | 在集成终端跑命令并取回输出/退出码 |
| `vscode_git` | status/diff/log/add/commit/分支/checkout/fetch/pull/push |
| `vscode_dev` | `reload` 重启扩展宿主加载新代码；`reload_window` 重载整个窗口 |

## 排障

| 现象 | 原因与做法 |
|---|---|
| `BRIDGE_UNAVAILABLE` | VSCode 没开、或窗口没打开该项目的文件夹。开窗口后重试；或用 `vscode_open(action:"folder")` |
| `AMBIGUOUS_WINDOW` | 多个窗口都匹配，用 `window` 参数（pid 或文件夹）指定 |
| `OUTSIDE_WINDOW` | 目标文件不在选中窗口的文件夹里，换窗口或先打开项目 |
| `CONFLICT` | 文档在你读完之后被改过，重新 `vscode_read` 再改 |
| `TERMINAL_NO_SHELL_INTEGRATION` | 终端没开 shell integration，改用 pwsh 工具，或在设置里开启 |
| `IDENTITY_MISSING` | 仓库没有 `user.name`/`user.email`，先 `git config` |
| push 卡住 | 首次推送要在 VSCode 窗口完成 GitHub 登录，登录一次后长期有效 |

## 已知限制

- 只支持本机窗口；Remote-SSH / WSL / Dev Container 不在范围内。
- `stash` 不在 VSCode 的 Git API 里，会返回 `UNSUPPORTED` 并让你用终端。
- 多根工作区按"包含目标路径的最深仓库"选，不按文件所属编辑器猜。
- 热更新默认关闭；开启后任何能写 `~/.dsh/vscode-bridge/reload.trigger` 的进程都能让扩展重新加载代码。

## 测试

```powershell
$node = "C:\Users\MECHREVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test "test/**/*.test.mjs"
```

