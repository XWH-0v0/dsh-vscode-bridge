# Git 工作流

本仓库是 DSH ↔ VSCode 桥接（扩展 + DSH 插件）的源码。所有开发按下面四条规则走。

## 1. 每次开发都从 main 起一条 story 分支

- 开始任何一段开发前，先 `git switch main && git pull`，保证基线是最新的。
- 从 `main` 切出新分支，命名 **`story/version_<x>_<y>_<z>`**（版本号用下划线分隔）。
  例如开发 0.1.0，分支就是 `story/version_0_1_0`。
- 分支名里的版本必须和 `bundle/package.json`（以及 `extension/package.json`）的 `version` 一致。
- 新分支**立即推送**到远程并设好上游：
  `git push -u origin story/version_0_1_0`

## 2. 开发只在 story 分支上进行

- `main` 只接受合并，不直接在上面改代码。
- 提交信息用 `type(scope): summary`，例如 `fix(guard): 首次代码改动前强制询问`。

## 3. review 和测试都过了才能合并

- 测试：`node --test "test/**/*.test.mjs"` 必须全绿（当前基线 104 项）。
- 评审：跑一次代码评审（`/review` 或 DSH 的 review 流程），
  Critical / Important 级别的问题**修完并补测试**才算过。
- 两者都通过，才允许合并到 `main`。

## 4. 推送到 main 必须由用户确认

- **合并到 `main`、以及 `git push origin main` 之前，必须得到用户明确同意。**
- 未确认前，所有提交只留在 story 分支上；story 分支的推送不需要额外确认。

## 5. 凭据

- 推送走 VSCode 的源代码管理；首次在 VSCode 里登录一次后由系统凭据管理器保管，
  之后终端里的 `git push` 也不再需要密钥。

## 6. 当前状态

- 版本：`0.2.0`
- 对应分支：`story/version_0_2_0`
