// 官方插件与内置技能包的 staging：把 apps/zcode-cli/packages/*-plugin 拷进
// bundled-agents/<platform>/glm/packages/*-plugin，供 agent 启动时按 bootstrap
// 的 rootCandidates（入口旁的 packages 目录）做 filesystem seed。
//
// dev 链（build-desktop-agent-cli.mjs）与生产打包链（prepare-agent-node-bundle.mjs）
// 必须共用同一份清单与同一份 staging 实现：agent 的 cwd 是用户 workspace，dev 下
// 唯一能命中插件包的候选就是 glm/packages，漏 stage 会让 dev 静默回退到旧缓存。
// 清单与 bootstrap 的 OFFICIAL_PLUGIN_DEFINITIONS 一一对应（名称/版本/必需 seed 资产），
// 漏登会让桌面包静默缺失对应插件——seed 源找不到目录就跳过，无任何诊断。

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const BROWSER_USE_REQUIRED_RUNTIME_PATHS = [
  "scripts/browser-client.mjs",
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已暴露 recording lookup，桌面安装包不能复用缺少正文的 runtime。
  "docs/recording.md",
  "docs/workflow.md",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
];

export const officialPluginPackages = [
  {
    // browser-use 只携带自己的 client script 与 skill/docs；node_repl MCP runtime 归
    // @zcode/node-repl-host（见下一条注释）。
    packageName: "@zcode/browser-use-plugin",
    relativePath: "apps/zcode-cli/packages/browser-use-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: BROWSER_USE_REQUIRED_RUNTIME_PATHS,
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/browser-use-plugin",
  },

  {
    // node_repl 宿主：Browser Use 与 Computer Use 共用的 MCP runtime。
    // 它没有 listing（不进插件市场展示面），但 seed 必须拿到它的 dist runtime，
    // 否则 bua/cua 任一开启时都会连不上 node_repl。
    packageName: "@zcode/node-repl-host",
    relativePath: "apps/zcode-cli/packages/node-repl-host",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/node-repl-host",
  },

  // 以下与 bootstrap 的 OFFICIAL_PLUGIN_DEFINITIONS 一一对应（名称/版本/必需 seed 资产）。
  {
    // CUA 插件包只携带 skill/docs/client script；broker JS 由 @zcode/zcode-cua 包打进
    // 宿主产物，Windows helper 载荷由 electron-builder 单独发布到 resources/tools/cua-helper。
    packageName: "@zcode/zcode-cua-plugin",
    relativePath: "apps/zcode-cli/packages/zcode-cua-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "docs/computer-use.md",
      "scripts/computer-use-client.mjs",
      "skills/computer-use/SKILL.md",
    ],
    stagedPath: "packages/zcode-cua-plugin",
  },
  {
    packageName: "@zcode/documents-plugin",
    relativePath: "apps/zcode-cli/packages/documents-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/docx/SKILL.md"],
    stagedPath: "packages/documents-plugin",
  },
  {
    packageName: "@zcode/pdf-plugin",
    relativePath: "apps/zcode-cli/packages/pdf-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pdf/SKILL.md"],
    stagedPath: "packages/pdf-plugin",
  },
  {
    packageName: "@zcode/presentations-plugin",
    relativePath: "apps/zcode-cli/packages/presentations-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pptx/SKILL.md"],
    stagedPath: "packages/presentations-plugin",
  },
  {
    packageName: "@zcode/spreadsheets-plugin",
    relativePath: "apps/zcode-cli/packages/spreadsheets-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/xlsx/SKILL.md"],
    stagedPath: "packages/spreadsheets-plugin",
  },
  {
    packageName: "@zcode/image-search-plugin",
    relativePath: "apps/zcode-cli/packages/image-search-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [".mcp.json"],
    stagedPath: "packages/image-search-plugin",
  },
  {
    // producer 发布包不含 src/tsconfig，dist 是唯一产物且已随包 vendor；
    // 这里不能置 requiresRuntime（会触发跑不通的 pnpm build），改为按 seed 资产断言 dist 完整。
    packageName: "@zcode/android-emulator-plugin",
    relativePath: "apps/zcode-cli/packages/android-emulator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["dist/mcp/server.js"],
    stagedPath: "packages/android-emulator-plugin",
  },
  {
    // 同 android-emulator：预编译 dist 随包 vendor，按 seed 资产断言。
    packageName: "@zcode/ios-simulator-plugin",
    relativePath: "apps/zcode-cli/packages/ios-simulator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["dist/mcp/server.js"],
    stagedPath: "packages/ios-simulator-plugin",
  },
  {
    packageName: "@zcode/plugin-creator-plugin",
    relativePath: "apps/zcode-cli/packages/plugin-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/plugin-creator/SKILL.md"],
    stagedPath: "packages/plugin-creator-plugin",
  },
  {
    packageName: "@zcode/skill-creator-plugin",
    relativePath: "apps/zcode-cli/packages/skill-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/skill-creator/SKILL.md"],
    stagedPath: "packages/skill-creator-plugin",
  },
  {
    packageName: "@zcode/restore-legacy-sessions-plugin",
    relativePath: "apps/zcode-cli/packages/restore-legacy-sessions-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/restore-legacy-sessions/SKILL.md"],
    stagedPath: "packages/restore-legacy-sessions-plugin",
  },
  {
    packageName: "@zcode/zcode-guide-plugin",
    relativePath: "apps/zcode-cli/packages/zcode-guide-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "skills/diagnosing-commands/SKILL.md",
      "skills/diagnosing-hooks/SKILL.md",
      "skills/diagnosing-mcp/SKILL.md",
      "skills/diagnosing-plugins/SKILL.md",
      "skills/diagnosing-skills/SKILL.md",
      "skills/zcode-configuration-guide/SKILL.md",
    ],
    stagedPath: "packages/zcode-guide-plugin",
  },
];

// 随 CLI 内置的技能包（不是插件）：bootstrap 的 resolveBundledSkillRoots 沿官方插件同款候选目录
// 在 zcode.cjs 旁找 packages/bundled-skills 并原地读取。漏 stage 它，桌面包的 /workflow 会展开成
// 「先加载 dynamic-workflows 技能」而技能文件不存在，因此必须随 Agent 一起打包。
export const bundledSkillPack = {
  relativePath: "apps/zcode-cli/packages/bundled-skills",
  requiredPaths: [
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/patterns.md",
    "skills/dynamic-workflows/examples.md",
  ],
  stagedPath: "packages/bundled-skills",
  topLevelPaths: ["skills"],
};

const includedOfficialPluginTopLevelPaths = new Set([
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // Electron 生产资源复制有独立白名单，遗漏 agents 会让首启 filesystem seed 永久缺少子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
]);

const excludedOfficialPluginAssetNames = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function shouldCopyOfficialPluginAsset(sourcePath) {
  const name = basename(sourcePath);
  return !excludedOfficialPluginAssetNames.has(name) && !name.endsWith(".pyc");
}

/** 与 stage-agent-bundle.mjs 的 glm 目录保持同一解析源，dev/生产两条链不可能漂移。 */
export function resolveOfficialPluginsGlmDir({ repoRoot, platformKey }) {
  return resolve(repoRoot, "packages", "desktop", "bundled-agents", platformKey, "glm");
}

export function stageOfficialPlugins({ repoRoot, glmDir }) {
  for (const plugin of officialPluginPackages) {
    const sourceRoot = resolve(repoRoot, plugin.relativePath);
    const manifestPath = resolve(sourceRoot, ".zcode-plugin", "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`[stage-official-plugins] missing official plugin manifest: ${manifestPath}`);
    }

    const targetRoot = resolve(glmDir, plugin.stagedPath);
    mkdirSync(targetRoot, { recursive: true });
    for (const entryName of includedOfficialPluginTopLevelPaths) {
      const sourcePath = resolve(sourceRoot, entryName);
      if (!existsSync(sourcePath)) continue;
      cpSync(sourcePath, resolve(targetRoot, entryName), {
        recursive: true,
        filter: shouldCopyOfficialPluginAsset,
      });
    }
    for (const relativePath of plugin.requiredSeedPaths ?? []) {
      const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
      if (!existsSync(stagedAssetPath)) {
        throw new Error(
          `[stage-official-plugins] missing staged official plugin seed asset: ${stagedAssetPath}`,
        );
      }
    }
    console.log(`[stage-official-plugins] staged official plugin ${plugin.stagedPath}`);
  }
}

export async function stageBundledSkillPack({ repoRoot, glmDir }) {
  const sourceRoot = resolve(repoRoot, bundledSkillPack.relativePath);
  const targetRoot = resolve(glmDir, bundledSkillPack.stagedPath);
  await mkdir(targetRoot, { recursive: true });
  for (const entryName of bundledSkillPack.topLevelPaths) {
    const sourcePath = resolve(sourceRoot, entryName);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, resolve(targetRoot, entryName), {
      recursive: true,
      filter: shouldCopyOfficialPluginAsset,
    });
  }
  for (const relativePath of bundledSkillPack.requiredPaths) {
    const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
    await access(stagedAssetPath);
  }
  console.log(`[stage-official-plugins] staged bundled skill pack ${bundledSkillPack.stagedPath}`);
}
