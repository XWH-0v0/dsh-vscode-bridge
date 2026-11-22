# VSCode 工作台

让 DeepSeek Harness（DSH）把 VSCode 当作**按需工作台**：需要看 diff、跑真实终端、读诊断、
走源代码管理做 git 时才用它；日常读写与批量编辑仍用原生工具。

- **按需使用，不打断**：需要时自己打开工作台（没有窗口就 `vscode_open(action:"folder")`），
  不会每次改代码都问"要不要用 VSCode"。
- **改代码**：默认用原生工具；需要你 review 时再用 `vscode_edit` 落到编辑器里并打开对比。
- **看上下文**：读得到当前选区、打开的文件、以及语言服务器报出的红波浪线。
- **跑终端**：在你自己的集成终端里执行命令（构建、dev server、跑测试），命令输出会回到 DSH。
- **做 git**：状态、diff、日志、暂存、提交、建分支、checkout、fetch、pull、push 全部走
  VSCode 的源代码管理。**git 凭据只需在 VSCode 里登录一次**，之后连终端里的 git 也能用。
  （`stash` 不在 VSCode 的 Git API 里，会提示改用终端。）
- **改扩展后自更新**：`scripts/install.ps1` 原地覆盖安装目录并写 `~/.dsh/vscode-bridge/reload.trigger`；
  开启 `dshVscodeBridge.hotReload` 的窗口会据此自动重启扩展宿主，也可以 `vscode_dev(action:"reload")`
  手动触发（工具会轮询实例 pid 确认真的是否重启）。

## 工具

| 工具 | 用途 |
|---|---|
| `vscode_status` | 连到哪个窗口、有哪些文件夹和仓库；连不上时给候选列表 |
| `vscode_open` | 打开文件（可到行）、打开 diff、或新开一个窗口 |
| `vscode_context` | 选区、活动文件、已打开编辑器、诊断 |
| `vscode_read` | 读编辑器里的实时内容（含未保存改动）与版本号 |
| `vscode_edit` | 批量应用编辑，带版本冲突保护，默认保存 |
| `vscode_terminal` | 在集成终端里跑命令并取回输出 |
| `vscode_git` | 源代码管理全套操作 |
| `vscode_dev` | 重启扩展宿主 / 重载窗口，并确认是否真的重启 |

## 限制

- 只支持本机窗口；Remote-SSH / WSL / Dev Container 里的窗口不在支持范围。
- 终端输出依赖 VSCode 的 shell integration（默认开启）；不支持的 shell 会明确报错而不是假装成功。
- 多窗口且目标不唯一时会报 `AMBIGUOUS_WINDOW`，需要用 `window` 参数指定。
- 写代码**默认不经过 VSCode**：原生工具更快；需要你在编辑器里看/撤销时才走工作台。
- 热更新默认关闭（能写触发文件的人就能让扩展重新加载代码）；开发期在设置里显式开启。
- 不会自动提交或推送；git 写操作只在你明确要求时执行。
