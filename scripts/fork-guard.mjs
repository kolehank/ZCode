#!/usr/bin/env node
// BYOK fork 出网/遥测门禁（FORK.md「验收门禁」一节的可执行版）。
//
// 静态扫描两 类禁止项：
//  1) 厂商云域名出现在源码中（引号收口的 origin 精确匹配，允许 .invalid 占位与白名单文件）；
//  2) 遥测栈的 import/使用（@opentelemetry、@zcode/telemetry、@arms/rum、armsRum 运行时符号、
//     已删除的遥测端点常量）。
// 白名单文件代表 BYOK 语义下的合法保留（用户自有 API Key 的模型端点、匿名入站的官方插件
// 资产、旧配置迁移兼容、协议 schema、no-op 接缝），逐条理由见 FORK.md。
//
// 运行：node scripts/fork-guard.mjs（CI 与 pre-push 均应调用；退出码非 0 即违规）。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["packages", "apps", "scripts", "config", "harness"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".html", ".css"]);
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".zcode",
  "coverage",
  "build",
  "out",
  "mock-cdn",
  "third-party",
]);

// 精确到「引号开头的 origin + 引号或路径斜杠」，避免误伤 .invalid 占位（如 chat.z.ai.invalid）
// 与子串；origin 后跟路径（/api/...）时以斜杠收口。
const FORBIDDEN_PATTERNS = [
  /["']https:\/\/zcode\.z\.ai[/"']/,
  /["']https:\/\/api\.z\.ai[/"']/,
  /["']https:\/\/chat\.z\.ai[/"']/,
  /["']https:\/\/open\.bigmodel\.cn[/"']/,
  /["']https:\/\/bigmodel\.cn[/"']/,
  /["']https:\/\/cdn-zcode\.z\.ai[/"']/,
  /feishu\.cn/,
  /zhipu-ai\.feishu\.cn/,
  /@opentelemetry\//,
  /@zcode\/telemetry/,
  /@arms\/rum/,
  /\barmsRum\./,
  /\bcreateTelemetryCore\b/,
  /\bZCODE_ARMS_RUM_ENDPOINT\b/,
  /\bZCODE_TELEMETRY_REPORT_ENDPOINT\b/,
  /\bZCODE_TELEMETRY_ENABLED\b/,
];

// 白名单：路径（相对仓库根，统一 / 分隔）→ 允许继续出现的模式（正则源字符串）。
// 新增白名单必须先在 FORK.md「允许保留清单」登记理由。
const ALLOWLIST = new Map(
  [
    // 用户自配 Z.ai/BigModel API Key（coding-plan-api-key 访问类型）的模型推理端点——
    // 流量指向模型 API 而非产品云，属 BYOK 合法模型通道。
    [
      "apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts",
      ["https://open.bigmodel.cn", "https://api.z.ai", "https://zcode.z.ai"],
    ],
    // 官方插件市场清单与资产：匿名入站下载（HTTP GET，无鉴权、无用户数据），D10 保留。
    [
      "packages/shared/src/plugin-marketplaces.ts",
      ["https://cdn-zcode.z.ai"],
    ],
    [
      "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
      ["https://cdn-zcode.z.ai"],
    ],
    [
      "packages/ui/src/v4/featureSuggestedPrompts.ts",
      ["https://cdn-zcode.z.ai"],
    ],
    // 旧版 ~/.zcode 配置文件迁移兼容：仅作 provider baseUrl 常量，不出网。
    [
      "packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts",
      ["https://open.bigmodel.cn"],
    ],
    // provider family 元数据（模板/图标分类用域名归属判断），无网络行为。
    ["packages/shared/src/model-provider-family.ts", ["bigmodel.cn"]],
    // 遥测协议 schema 保留（纯类型层，利于上游 rebase）。
    [
      "packages/shared/src/telemetry.ts",
      ["TelemetryEventPayload", "ArmsCustomEventPayload", "armsRum"],
    ],
    ["packages/shared/src/platform.ts", ["reportTelemetryEvent", "reportArmsCustomEvent"]],
    // no-op 接缝本身。
    ["apps/zcode-cli/packages/bootstrap/src/telemetry-noop.ts", ["telemetry"]],
    // OTEL_*/ZCODE_TELEMETRY_* 键名保留在 sanitize 黑名单里，作为防泄漏边界（阻止这类
    // env 泄漏给 Bash/MCP 子进程），并非遥测实现。
    ["packages/shared/src/runtimeEnv.ts", ["OTEL_", "ZCODE_TELEMETRY_"]],
    // CLI 遥测禁用开关的 env 键名（兼容旧文档语义，读取处为空实现）。
    ["packages/shared/src/env.ts", ["ZCODE_TELEMETRY"]],
    // 本地设备 ID 历史文件名/注释。
    ["packages/desktop/src/main/desktopDeviceMid.ts", ["telemetry"]],
    // 打包/构建脚本中说明移除事实的注释措辞。
    ["packages/desktop/scripts/bundle.mjs", ["BYOK"]],
    ["packages/desktop/electron-builder.config.js", ["BYOK"]],
  ].map(([file, patterns]) => [file, patterns.map((source) => new RegExp(source))]),
);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!SCAN_EXTS.has(extname(entry.name))) continue;
    yield full;
  }
}

function toRepoRelative(fullPath) {
  return fullPath.slice(repoRoot.length + 1).split(sep).join("/");
}

const violations = [];
let scannedFiles = 0;
/** 白名单仍被使用的文件（文件级，供名单自检）。 */
const stillMatching = new Set();

for (const root of SCAN_ROOTS) {
  const rootDir = join(repoRoot, root);
  for (const file of walk(rootDir)) {
    const relative = toRepoRelative(file);
    if (relative === "scripts/fork-guard.mjs") continue;
    if (/^(FORK\.md|BYOK-FORK-PLAN\.md|NOTICE\.md|THIRD-PARTY-NOTICES\.md)$/.test(relative)) {
      continue;
    }
    let content;
    try {
      if (statSync(file).size > 4 * 1024 * 1024) continue;
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scannedFiles += 1;
    const allowedPatterns = ALLOWLIST.get(relative);
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.test(content)) continue;
      if (allowedPatterns?.some((allowed) => allowed.test(content))) {
        // 白名单命中：不算违规，但记为"仍在使用"，供名单自检。
        stillMatching.add(relative);
        continue;
      }
      violations.push({ file: relative, pattern: pattern.source });
    }
  }
}

// 白名单自检：条目指向的文件若已不存在，说明删除后忘了回收白名单（硬失败，防名单腐化）；
// 文件仍存在但当前未命中任何禁止模式的条目只提示（防御性保留是合法状态）。
for (const file of ALLOWLIST.keys()) {
  if (!existsSync(join(repoRoot, file))) {
    violations.push({
      file,
      pattern: "<allowlist-file-missing>",
    });
    continue;
  }
  if (!stillMatching.has(file)) {
    console.warn(`fork-guard: 提示：白名单条目当前未命中任何禁止模式（防御性保留）：${file}`);
  }
}

if (violations.length > 0) {
  console.error("fork-guard: 违规 %d 处：", violations.length);
  for (const violation of violations) {
    console.error(`  - ${violation.file}\n    pattern: ${violation.pattern}`);
  }
  console.error(
    "\n处理方式：1) 若为真实残留，删除或收口对应代码；2) 若属 BYOK 合法保留，先在 FORK.md 登记理由，再把该文件与命中的模式加入本脚本 ALLOWLIST。",
  );
  process.exit(1);
}

console.log(`fork-guard: OK（扫描 ${scannedFiles} 个文件，0 违规）`);
