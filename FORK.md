# ZCode BYOK Fork

本仓库是 ZCode 的 **BYOK（Bring Your Own Key）中性 fork**：移除厂商登录认证与全部遥测，模型流量只指向用户自配端点，可长期 rebase 上游主线。改造方案与决策记录见 `BYOK-FORK-PLAN.md`（D1–D15 决策清单）。

## 改造状态（2026-09 完成）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 遥测全删：ARMS RUM 模块群、数仓埋点（telemetryCore）、CLI OTLP（@zcode/telemetry 整包）、DAU 心跳、崩溃转储（crashReporter）、设备遥测 env 捕获；UI 调用面保留 no-op 接缝（`IPlatformService.reportTelemetryEvent/reportArmsCustomEvent` → preload/web 平台实现为空操作）；协议 schema 保留 | ✅ |
| P1a | 云功能删除：会话分享、官方 MCP、off-peak 闲时任务、厂商额度（usage-stats/coding-plan-subscription）、feedback、`/api/v1/client/configs` 远程配置拉取、force-update gate | ✅ |
| P1b | OAuth 登录体系删除：services/oauth、web auth、CLI login 命令、deep-link OAuth 回调、token 刷新；内置 Provider 切换为 `config/provider/byok-builtin.json`（仅 OpenAI-compatible / Anthropic-compatible 两个 api-key 模板） | ✅ |
| P2 | 凭证升级：AES-256-GCM 文件格式不变，主密钥改为 OS keychain 随机密钥（Win=DPAPI / macOS=Keychain / Linux=secret-tool；`ZCODE_CREDENTIAL_SECRET` 可显式覆盖）；删除本机信息推导 fallback；旧密文自动重加密迁移；明文 buffer 用后清零 | ✅ |
| P3 | Web 三档鉴权（设置页「远程访问」）：open（强制 bind 127.0.0.1）/ Cloudflare Access JWT（jose 验签）/ 静态 token（随机生成、配置文件只存 SHA-256、UI 一次性展示 + QR + 复制链接 `#token=`）；`ZCODE_WEB_BIND_HOST` 支持；网卡枚举（过滤虚拟网卡、识别 tailscale 网段） | ✅ |
| P4 | Onboarding 重排：欢迎 → workspace → Provider 配置引导 → 完成；删除登录与问卷；无可用模型时 composer 引导到设置页 | ✅ |
| P5 | 本地用量账本：`~/.zcode/v2/usage-ledger.sqlite`，按 provider/model/day 聚合五类 token，设置页「本地用量」区块；仅本地，永不上传 | ✅ |
| P6–P8 | 自动更新关闭（fork 发版走自己的 GitHub Releases）；产品 API 默认端点 fail-closed（`zcode.invalid` 占位）；远程资源 CDN 默认空（自托管）；文档链接中性化 | ✅ |

## 使用配置

### BYOK Provider（核心）
设置 → 模型 Provider → 选择 OpenAI 兼容 / Anthropic 兼容模板 → 填 base URL 与 API Key。Key 经 OS keychain 主密钥加密存 `~/.zcode/credentials.json`。企业批量可用 env `ZCODE_CREDENTIAL_SECRET` 固定主密钥（KMS 下发）。

### Web 远程访问（tailscale / cloudflared）
设置 → 远程访问：
- **open**：无鉴权，server 强制绑定 `127.0.0.1`；配 `tailscale serve 3030`（推荐，自动 HTTPS）或 cloudflared 隧道即可，手机扫码/复制链接直连。
- **cloudflare-access**：填 team domain + AUD（+可选邮箱白名单），CF 边缘登录后 `Cf-Access-Jwt-Assertion` 由 server 验签。
- **token**：点「生成」得到随机 token（配置文件只存哈希），QR/链接一次性展示；重置按钮轮换。
- 直连 tailnet IP 时设 `ZCODE_WEB_BIND_HOST=100.x.y.z`；改动重启 server 生效。

### 远程 SSH workspace 资源自托管
```bash
pnpm build   # 构建产物
# 把产物按 <base>/zcode/electron/releases/<version>/ 结构放到任意静态文件服务器
ZCODE_CDN_BASE_URL=https://your-host ZCODE_DEPS_BASE_URL=https://your-host/deps pnpm dev:desktop
```
未配置时远程资源下载快速失败（不再指向厂商 CDN）。

### 从官方版迁移
官方版退出登录 → 安装 fork → 历史会话（`~/.zcode/v2/sessions/`）全部可读；首次续聊重选 BYOK provider；`~/.zcode/v2/telemetry-state.json` 为死数据可手删；旧 API Key 凭证首次读取时自动重加密。

## CI 打包（GitHub Actions）

`.github/workflows/build.yml` 提供三平台打包（复用仓库既有编排 `pnpm bundle:desktop -- <mac|win|linux> <arch>`）：

| 平台 | runner | 产物 |
|---|---|---|
| Windows | windows-latest | nsis `.exe`（x64） |
| macOS | macos-latest | `.dmg`（arm64，未签名） |
| Linux | ubuntu-22.04 | AppImage / deb / rpm / pacman（x64） |
| CLI（可选） | 同三平台 | SEA 单文件二进制 `zcode-<target>` |

- 触发：Actions 页手动（可勾选跳过 CLI）或推送 `v*` 标签（自动创建 Release 并上传全部产物）。
- 流程：gate（fork:guard + lint + typecheck）→ 三平台并行打包（install → build:bootstrap → bundle）→ artifact 上传 / Release 上传。
- CI 中 `ZCODE_SKIP_REMOTE_ASSETS=1`：桌面安装包不内置远程 SSH 资产（自托管，见下节）。
- macOS 默认未签名；需要 Developer ID 签名时设 `ZCODE_ENABLE_MAC_SIGN=1` + 证书 secrets（`electron-builder.config.js` 已预留钩子），公证另行配置。
- 首次合入后建议手动触发一次 workflow 验证各平台打包链（本地无法完全模拟 runner 环境）。

## 验收门禁

`pnpm verify:pre-push` = lint + architecture:check + **fork:guard**。

- `pnpm fork:guard`（`scripts/fork-guard.mjs`）：扫描厂商云域名与遥测栈 import/常量，0 违规才通过；白名单条目与理由如下表，改动白名单须先登记。
- 出网冒烟（手动，发版前执行）：启动应用跑完 onboarding + 一轮 BYOK 会话，用代理/抓包断言除用户配置端点外零连接（含 WS）；断网启动无隐藏重试外呼。
- 回归点：官方版会话数据原地可读；远程 SSH 连通；CLI TUI 与 Desktop 凭证互通；web 三档切换；手机 `mobileRemote` 扫码接入。

## 允许保留清单（fork:guard 白名单理由）

| 文件 | 理由 |
|---|---|
| `apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts` | 用户自带 Z.ai/BigModel API Key 的模型推理端点（BYOK 合法模型通道，非产品云） |
| `packages/shared/src/plugin-marketplaces.ts`、`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`、`packages/ui/src/v4/featureSuggestedPrompts.ts` | 官方插件市场/资产：匿名入站 HTTP GET（无鉴权、无用户数据上传），D10 保留 |
| `packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts` | 旧版配置文件迁移兼容常量，不出网 |
| `packages/shared/src/model-provider-family.ts` | provider family 元数据（域名归属分类），无网络行为 |
| `packages/shared/src/telemetry.ts`、`platform.ts` | 协议 schema/平台契约层保留（no-op 接缝依赖），利于上游 rebase |
| `apps/zcode-cli/packages/bootstrap/src/telemetry-noop.ts` | no-op 接缝本身 |
| `packages/shared/src/runtimeEnv.ts` | `OTEL_*`/`ZCODE_TELEMETRY_*` 键保留在 env 清洗黑名单（防泄漏给 Bash/MCP 子进程），非遥测实现 |
| `packages/shared/src/env.ts`、`packages/desktop/src/main/desktopDeviceMid.ts` | 历史键名/文件名兼容与注释 |
| `packages/desktop/scripts/bundle.mjs`、`electron-builder.config.js` | 打包校验名单中说明移除事实的注释 |

## Rebase 指南

- 跟上游 **release tag**；冲突高发区：`SessionPane.tsx`（遥测调用面已保留为 no-op，上游新增埋点会编译通过且无操作）、`packages/services/src/node.ts`（服务装配）、`packages/desktop/src/main/index.ts`。
- rebase 后必跑：`pnpm verify:pre-push` + CLI `npx turbo run typecheck`（apps/zcode-cli 下）。
- 上游新增遥测/云功能模块时：按 P0/P1 模式物理删除出网收口、保留 no-op 接缝。

## 已知休眠代码（有意保留）

- CLI `packages/core`/`contracts` 的 offPeak 类型层（发送方已删，工具面不可注册）。
- `packages/shared` 协议 schema：telemetry、ConversationShare*、offpeak、oauth 消息类型。
- `update-status` 窗口与设置项存在但 autoUpdater `enabled: false` 永不触发。
