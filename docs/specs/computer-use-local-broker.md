# Spec：Computer Use 本地 broker 的对端鉴权与 vendor 完整性

状态：生效中（含一项待产品决策）。审查来源：`docs/reviews/2026-10-01-v3.100.0-code-review.md`（P0-1、P1-4、P2-11）。

## Windows 对端鉴权的现状与决策点（P0，待产品确认）

**事实**（2026-10-01 实测）：

- vendored Windows Helper（`packages/zcode-cua/helper/win32-x64/dist/windows-helper.js:14709`）硬编码
  `WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN = true`：Windows broker 的命名管道
  （`\\.\pipe\zcode-cua-helper-*`）对**任意本地进程**开放，无对端身份校验；本地恶意进程可
  驱动输入（click/type/paste）与屏幕观察（capture_app）。
- 该 gate 打开是上游（producer）的刻意临时决策（"Windows peer verification lands separately"）：
  Windows 原生模块实测缺少全部四个对端校验原语（`getPeerCredentials`、
  `verifyProcessCodeSignatureWithAuditToken`、`verifyProcessCodeSignature`、`parentProcessPid`）。
  gate 关闭后 `assertPeerIdentityAuthCapable` 直接拒绝启动——**翻转 gate 等于 Windows 上
  完全禁用 Computer Use**。
- 命名管道 DACL 无法从 JS 设置（Node 不暴露 SECURITY_ATTRIBUTES），收紧需改原生模块。

**处置**：本 fork 不做破坏性翻转，维持上游现状并公开登记风险（本 spec + FORK.md）。
**待产品决策**：接受「同机任意进程可控输入/屏幕」的威胁面，或在 Windows 对端校验原语落地前
默认关闭 Windows Computer Use（gate 翻转 + dev 显式 opt-in）。任一选择都需要明确记录。

**验收场景**（上游原语落地后）：
1. Windows 原生模块提供四原语 → gate 置 false → helper 正常启动，未签名进程连接被拒。
2. dev 模式：`ZCODE_CUA_DEV_MODE=1` 显式 opt-in 时允许无校验运行且启动横幅可见。

## vendor 完整性门禁（P1-4）

vendor 模式下不再存在 upstream.json / catalog pin / 契约文档；防漂移门禁改为**单一脚本**：

`apps/zcode-cli/packages/zcode-cua-plugin/scripts/check-cua-vendor-integrity.mjs`

- `--check`（只读，CI / pre-push 用）：全部版本记录相等 + 载荷 sha256 与 manifest 一致，漂移即 exit 1。
- 无参（写回）：把全部版本记录对齐到插件包 `package.json`（单一事实源），并按当前文件重算
  manifest sha256（用于 vendor 载荷替换后的一键同步）。

**版本记录清单**（必须全部相等）：

1. `apps/zcode-cli/packages/zcode-cua-plugin/package.json`（单一事实源）
2. `apps/zcode-cli/packages/zcode-cua-plugin/.zcode-plugin/plugin.json`
3. `packages/zcode-cua/package.json`
4. `packages/zcode-cua/helper/win32-x64/package.json`
5. `packages/zcode-cua/helper/win32-x64/runtime-manifest.json`（packageVersion）
6. `official-plugin-definitions.ts` 的 computer-use 条目 `version`（`apps/zcode-cli/packages/bootstrap/src/app/`）

**载荷完整性**：`runtime-manifest.json` 的 `sha256.entry` / `sha256.addon` 必须与
`dist/windows-helper.js`、`build/Release/ax_native.node` 逐字节一致；`electronVersion` 与
`packages/desktop/package.json` 的 `electron` 版本一致。

**挂载点**：CI `gate` job 增加「CUA vendor 完整性」步骤；插件包 scripts 暴露
`check:integrity`（= version:check 同义）。

**废弃**：`check-cua-baseline.mjs`、`bump-zcode-cua-producer.mjs` 的前提（upstream.json、
catalog git pin、GitLab CI、契约文档、tests/skill-sync）在 vendor 模式下全部不存在，
实跑即崩，属死代码，随本 spec 删除并清理 package.json 引用。
