# VSCode 桥接

让 DeepSeek Harness（DSH）在你的 VSCode 里干活，而不是在它自己的进程里。装一次，之后：

- **改代码**：改动以 VSCode 原生编辑生效，能在编辑器里看到、能 `Ctrl+Z` 撤销；改完还能直接把
  "原始 vs 现在"的对比打开给你看。
- **看上下文**：读得到当前选区、打开的文件、以及语言服务器报出的红波浪线。
- **跑终端**：在你自己的集成终端里执行命令（构建、dev server、跑测试），命令输出会回到 DSH。
- **做 git**：状态、diff、日志、暂存、提交、建分支、checkout、fetch、pull、push 全部走
  VSCode 的源代码管理。**git 凭据只需在 VSCode 里登录一次**，之后连终端里的 git 也能用。
  （`stash` 不在 VSCode 的 Git API 里，会提示改用终端。）

## 怎么用

1. 装 VSCode 扩展（`DSH VSCode Bridge`），重载窗口后状态栏会出现 `DSH:<端口>`。
2. 装本插件（bundle），重启或新开会话后 `vscode_*` 工具可用。
3. 对我说"这次在 VSCode 里做"，我就会用 `vscode_edit` / `vscode_git` 等工具。

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

## 限制

- 只支持本机窗口；Remote-SSH / WSL / Dev Container 里的窗口不在支持范围。
- 终端输出依赖 VSCode 的 shell integration（默认开启）；不支持的 shell 会明确报错而不是假装成功。
- 多窗口且目标不唯一时会报 `AMBIGUOUS_WINDOW`，需要用 `window` 参数指定。
- 写代码是**软约束**：DSH 会优先走 VSCode，但不会硬拦原生写文件工具；写文档/配置本来就不走这里。
- 不会自动提交或推送；git 写操作只在你明确要求时执行。
