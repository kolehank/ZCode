import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const seaOfficialPluginAssetPrefix = "zcode-official-plugins/";
export const seaOfficialPluginManifestAssetKey = `${seaOfficialPluginAssetPrefix}manifest.json`;
const browserUseRequiredRuntimePaths = [
  "scripts/browser-client.mjs",
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // recording lookup 是录屏 API 的模型入口，SEA 不得接受缺失正文的插件资产。
  "docs/recording.md",
  "docs/workflow.md",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
];

export const officialSeaPlugins = [
  {
    // node_repl 宿主：Browser Use 与 Computer Use 共用的运行时产物，自己不是面向用户的插件
    // （无 skill、无市场 listing）。它必须始终随发布物嵌入，否则任一能力启用时都没有宿主可跑。
    marketplace: "zcode-plugins-official",
    name: "node-repl-host",
    packageName: "@zcode/node-repl-host",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    rootPath: join("packages", "node-repl-host"),
    version: "0.6.0",
  },
  {

    marketplace: "zcode-plugins-official",
    name: "browser-use",
    packageName: "@zcode/browser-use-plugin",
    requiresRuntime: true,
    // Browser Use 的 runtime、client、API 文档和 skills 是同一发布单元；
    // SEA 构建必须在嵌入前拒绝任一缺失项，不能把损坏产物留到用户启动时才发现。
    requiredRuntimePaths: browserUseRequiredRuntimePaths,
    rootPath: join("packages", "browser-use-plugin"),
    // SEA 清单仍指向旧版时，runtime 会与官方 definition 精确匹配失败，
    // 导致发布产物不 seed browser-use，进而无法装配宿主 node_repl MCP。
    version: "0.5.1",
  },

  // 以下与 bootstrap 的 OFFICIAL_PLUGIN_DEFINITIONS 一一对应（名称/版本/必需 seed 资产）。
  // SEA manifest 按 name+version 与 definition 精确匹配，版本漂移 = 发布产物静默缺插件。
  // 内容型插件必须显式 requiresRuntime: false——assertPluginRuntime 缺省按 dist/mcp/server.js
  // 断言，漏标会让 SEA 构建在无 MCP runtime 的纯内容包上失败。
  {
    marketplace: "zcode-plugins-official",
    name: "computer-use",
    // CUA 插件包只携带 skill/docs/client script；broker JS 由 @zcode/zcode-cua 包打进宿主产物，
    // Windows helper 载荷随桌面安装包发布到 resources/tools/cua-helper，不由 SEA 携带。
    packageName: "@zcode/zcode-cua-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "docs/computer-use.md",
      "scripts/computer-use-client.mjs",
      "skills/computer-use/SKILL.md",
    ],
    rootPath: join("packages", "zcode-cua-plugin"),
    version: "0.6.3",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "documents",
    packageName: "@zcode/documents-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/docx/SKILL.md"],
    rootPath: join("packages", "documents-plugin"),
    version: "0.1.7",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "pdf",
    packageName: "@zcode/pdf-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pdf/SKILL.md"],
    rootPath: join("packages", "pdf-plugin"),
    version: "0.1.7",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "presentations",
    packageName: "@zcode/presentations-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pptx/SKILL.md"],
    rootPath: join("packages", "presentations-plugin"),
    version: "0.1.7",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "spreadsheets",
    packageName: "@zcode/spreadsheets-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/xlsx/SKILL.md"],
    rootPath: join("packages", "spreadsheets-plugin"),
    version: "0.1.7",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "image-search",
    packageName: "@zcode/image-search-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [".mcp.json"],
    rootPath: join("packages", "image-search-plugin"),
    version: "0.1.1",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "android-emulator",
    packageName: "@zcode/android-emulator-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    rootPath: join("packages", "android-emulator-plugin"),
    version: "0.1.0",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "ios-simulator",
    packageName: "@zcode/ios-simulator-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    rootPath: join("packages", "ios-simulator-plugin"),
    version: "0.1.0",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "plugin-creator",
    packageName: "@zcode/plugin-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/plugin-creator/SKILL.md"],
    rootPath: join("packages", "plugin-creator-plugin"),
    version: "0.1.1",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "skill-creator",
    packageName: "@zcode/skill-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/skill-creator/SKILL.md"],
    rootPath: join("packages", "skill-creator-plugin"),
    version: "0.1.0",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "restore-legacy-sessions",
    packageName: "@zcode/restore-legacy-sessions-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/restore-legacy-sessions/SKILL.md"],
    rootPath: join("packages", "restore-legacy-sessions-plugin"),
    version: "0.1.0",
  },
  {
    marketplace: "zcode-plugins-official",
    name: "zcode-guide",
    packageName: "@zcode/zcode-guide-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "skills/diagnosing-commands/SKILL.md",
      "skills/diagnosing-hooks/SKILL.md",
      "skills/diagnosing-mcp/SKILL.md",
      "skills/diagnosing-plugins/SKILL.md",
      "skills/diagnosing-skills/SKILL.md",
      "skills/zcode-configuration-guide/SKILL.md",
    ],
    rootPath: join("packages", "zcode-guide-plugin"),
    version: "0.3.0",
  },
];

export const collectSeaOfficialPluginAssets = async ({
  requireRuntime = false,
  root,
  stagingDirectory,
} = {}) => {
  const files = [];
  const assets = {};
  const plugins = [];

  await rm(stagingDirectory, {
    force: true,
    recursive: true,
  });

  for (const plugin of officialSeaPlugins) {
    const pluginRoot = resolve(root, plugin.rootPath);
    assertPluginRoot(pluginRoot, plugin);
    assertPluginRequiredSeedAssets(pluginRoot, plugin);
    // 只提供 skills 的内容型插件没有 MCP server，用 requiresRuntime:false 跳过校验；
    // 其余运行时插件仍要在此校验，避免发布缺失可执行入口的产物。
    if (requireRuntime && plugin.requiresRuntime !== false) assertPluginRuntime(pluginRoot, plugin);

    const pluginFiles = [];
    for await (const sourcePath of walkFiles(pluginRoot)) {
      const relativePath = relative(pluginRoot, sourcePath);
      if (!shouldIncludePluginFile(relativePath)) continue;

      const bytes = await readFile(sourcePath);
      const sourceStats = await stat(sourcePath);
      const assetPath = toPosixPath(
        join(plugin.marketplace, plugin.name, plugin.version, relativePath),
      );
      assets[`${seaOfficialPluginAssetPrefix}${assetPath}`] = sourcePath;
      const file = {
        mode: modeForSeedFile(relativePath, sourceStats.mode),
        path: toPosixPath(relativePath),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      pluginFiles.push(file);
      files.push({
        ...file,
        plugin: plugin.name,
      });
    }

    pluginFiles.sort((left, right) => left.path.localeCompare(right.path));
    plugins.push({
      files: pluginFiles,
      marketplace: plugin.marketplace,
      name: plugin.name,
      version: plugin.version,
    });
  }

  plugins.sort((left, right) => left.name.localeCompare(right.name));
  const manifestHash = createHash("sha256")
    .update(
      JSON.stringify(
        plugins.map((plugin) => [
          plugin.marketplace,
          plugin.name,
          plugin.version,
          plugin.files.map(({ path, sha256, mode }) => [path, sha256, modeForSeedFile(path, mode)]),
        ]),
      ),
    )
    .digest("hex");
  const manifest = {
    hash: manifestHash,
    plugins,
    version: 1,
  };
  const manifestPath = resolve(stagingDirectory, "official-plugins-manifest.json");
  await mkdir(stagingDirectory, {
    recursive: true,
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  assets[seaOfficialPluginManifestAssetKey] = manifestPath;

  return {
    assets,
    manifest,
  };
};

function assertPluginRoot(pluginRoot, plugin) {
  if (!existsSync(join(pluginRoot, ".zcode-plugin", "plugin.json"))) {
    throw new Error(`Missing ${plugin.name} plugin manifest at ${pluginRoot}`);
  }
}

function assertPluginRequiredSeedAssets(pluginRoot, plugin) {
  for (const relativePath of plugin.requiredSeedPaths ?? []) {
    const assetPath = join(pluginRoot, ...relativePath.split("/"));
    if (!existsSync(assetPath)) {
      throw new Error(`Missing ${plugin.name} required seed asset at ${assetPath}`);
    }
  }
}

function assertPluginRuntime(pluginRoot, plugin) {
  for (const relativePath of plugin.requiredRuntimePaths ?? ["dist/mcp/server.js"]) {
    const runtimePath = join(pluginRoot, ...relativePath.split("/"));
    if (!existsSync(runtimePath)) {
      const assetKind = relativePath === "dist/mcp/server.js" ? "MCP runtime" : "runtime asset";
      throw new Error(
        `Missing ${plugin.name} ${assetKind} at ${runtimePath}. ` +
          `Run \`pnpm --filter ${plugin.packageName} build\` before \`pnpm sea\`.`,
      );
    }
  }
}

async function* walkFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (shouldSkipDirectory(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

const shouldSkipDirectory = (name) =>
  name === "node_modules" ||
  name === ".turbo" ||
  name === "coverage" ||
  name === ".venv" ||
  name === "__pycache__";

const includedTopLevelPaths = new Set([
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // SEA 资源采集曾只允许 skills/commands，导致 document-skills 的 judge 子代理未进入可执行文件。
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

const shouldIncludePluginFile = (relativePath) => {
  const segments = relativePath.split(sep);
  if (segments.includes(".DS_Store") || segments.some((segment) => segment.endsWith(".pyc"))) {
    return false;
  }
  const [topLevel] = relativePath.split(sep);
  return topLevel !== undefined && includedTopLevelPaths.has(topLevel);
};

const toPosixPath = (value) => value.split(sep).join("/");

const modeForSeedFile = (filePath, sourceMode) => {
  if (sourceMode !== undefined && (sourceMode & 0o111) !== 0) return 0o755;

  const normalizedPath = toPosixPath(filePath);
  if (/(?:^|\/)dist\/mcp\/server\.js$/i.test(normalizedPath)) return 0o755;
  if (/^hooks\//u.test(normalizedPath) && !/\.(json|md|txt)$/iu.test(normalizedPath)) {
    return 0o755;
  }

  return 0o644;
};
