#!/usr/bin/env node
// CUA vendor 完整性校验 —— 版本一致性 + 载荷 sha256，单一脚本替代 vendor 模式下
// 已断链的门禁（check-cua-baseline / bump-zcode-cua-producer 的前提：upstream.json、
// catalog pin、GitLab CI、契约文档均已不存在）。
//
// 语义见 docs/specs/computer-use-local-broker.md：
//   node scripts/check-cua-vendor-integrity.mjs --check   # 只读：版本漂移或载荷被改即 exit 1（CI / pre-push）
//   node scripts/check-cua-vendor-integrity.mjs           # 写回：全部版本记录对齐插件包 package.json，
//                                                         #       并按当前文件重算 runtime-manifest sha256
// 单一事实源是插件包 package.json 的 version；runtime-manifest 的 sha256 是载荷完整性基线。

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../../../..");
const checkOnly = process.argv.includes("--check");

const wrapperPackageJsonPath = resolve(packageRoot, "package.json");
const wrapperManifestPath = resolve(packageRoot, ".zcode-plugin", "plugin.json");
const runtimePackageJsonPath = resolve(repoRoot, "packages/zcode-cua/package.json");
const helperPackageJsonPath = resolve(
  repoRoot,
  "packages/zcode-cua/helper/win32-x64/package.json",
);
const runtimeManifestPath = resolve(
  repoRoot,
  "packages/zcode-cua/helper/win32-x64/runtime-manifest.json",
);
const desktopPackageJsonPath = resolve(repoRoot, "packages/desktop/package.json");
const officialPluginDefinitionsPath = resolve(
  repoRoot,
  "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function sha256File(path) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  await new Promise((resolveStream, rejectStream) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolveStream);
    stream.on("error", rejectStream);
  });
  return hash.digest("hex");
}

/** 从 official-plugin-definitions.ts 里取 computer-use 条目的 version 字面量。 */
async function readOfficialDefinitionVersion() {
  const source = await readFile(officialPluginDefinitionsPath, "utf-8");
  const entryStart = source.indexOf('name: "computer-use"');
  if (entryStart === -1) {
    throw new Error("official-plugin-definitions.ts 里找不到 computer-use 条目");
  }
  const match = /version:\s*"(\d+\.\d+\.\d+)"/.exec(source.slice(entryStart));
  if (!match) {
    throw new Error("official-plugin-definitions.ts 的 computer-use 条目缺少 version 字面量");
  }
  return { version: match[1], matchIndex: entryStart + match.index };
}

async function main() {
  const wrapper = await readJson(wrapperPackageJsonPath);
  const sourceVersion = wrapper.version;
  const problems = [];

  const records = [
    { label: "插件包 package.json（单一事实源）", path: wrapperPackageJsonPath, version: sourceVersion },
    {
      label: "插件包 .zcode-plugin/plugin.json",
      path: wrapperManifestPath,
      version: (await readJson(wrapperManifestPath)).version,
    },
    {
      label: "vendored @zcode/zcode-cua package.json",
      path: runtimePackageJsonPath,
      version: (await readJson(runtimePackageJsonPath)).version,
    },
    {
      label: "helper/win32-x64 package.json",
      path: helperPackageJsonPath,
      version: (await readJson(helperPackageJsonPath)).version,
    },
    {
      label: "runtime-manifest.json packageVersion",
      path: runtimeManifestPath,
      version: (await readJson(runtimeManifestPath)).packageVersion,
    },
    {
      label: "official-plugin-definitions computer-use version",
      path: officialPluginDefinitionsPath,
      version: (await readOfficialDefinitionVersion()).version,
    },
  ];

  for (const record of records.slice(1)) {
    if (record.version !== sourceVersion) {
      problems.push(
        `${record.label}: ${record.version} != 源版本 ${sourceVersion}（${record.path}）`,
      );
    }
  }

  // 载荷完整性：manifest 记录的 sha256 / electronVersion 必须与实际文件一致。
  const manifest = await readJson(runtimeManifestPath);
  const helperRoot = dirname(runtimeManifestPath);
  const payloadTargets = [
    { key: "entry", file: manifest.entry },
    { key: "addon", file: manifest.addon },
  ];
  for (const target of payloadTargets) {
    if (!target.file) {
      problems.push(`runtime-manifest.json 缺少 ${target.key} 字段`);
      continue;
    }
    const actual = await sha256File(resolve(helperRoot, target.file));
    const expected = manifest.sha256?.[target.key];
    if (actual !== expected) {
      problems.push(
        `载荷 sha256 不一致：${target.file} 实际 ${actual} != manifest ${expected}` +
          (checkOnly
            ? "。若为合法的 vendor 载荷替换，运行无参脚本重算 manifest。"
            : ""),
      );
    }
  }

  const desktop = await readJson(desktopPackageJsonPath);
  const desktopElectron = desktop.devDependencies?.electron ?? desktop.dependencies?.electron;
  if (desktopElectron && manifest.electronVersion && !desktopElectron.includes(manifest.electronVersion)) {
    problems.push(
      `electronVersion 漂移：manifest ${manifest.electronVersion} 不在 desktop 依赖 ${desktopElectron} 内`,
    );
  }

  if (problems.length > 0) {
    console.error(`[cua-integrity] 发现 ${problems.length} 处漂移：`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
  if (checkOnly) {
    console.log(`[cua-integrity] OK：版本 ${sourceVersion} 全部一致，载荷 sha256 与 manifest 一致`);
    return;
  }

  // 写回：把全部记录对齐单一事实源，并按当前文件重算 manifest sha256。
  for (const record of records.slice(1, 4)) {
    const json = await readJson(record.path);
    json.version = sourceVersion;
    await writeFile(record.path, `${JSON.stringify(json, null, 2)}\n`);
  }
  const wrapperManifest = await readJson(wrapperManifestPath);
  wrapperManifest.version = sourceVersion;
  await writeFile(wrapperManifestPath, `${JSON.stringify(wrapperManifest, null, 2)}\n`);

  const runtimeManifest = await readJson(runtimeManifestPath);
  runtimeManifest.packageVersion = sourceVersion;
  runtimeManifest.sha256 = {
    entry: await sha256File(resolve(helperRoot, runtimeManifest.entry)),
    addon: await sha256File(resolve(helperRoot, runtimeManifest.addon)),
  };
  await writeFile(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`);

  const definitionsSource = await readFile(officialPluginDefinitionsPath, "utf-8");
  const { matchIndex } = await readOfficialDefinitionVersion();
  const updated =
    definitionsSource.slice(0, matchIndex) +
    `version: "${sourceVersion}"` +
    definitionsSource.slice(matchIndex + /version:\s*"\d+\.\d+\.\d+"/.exec(definitionsSource.slice(matchIndex))[0].length);
  await writeFile(officialPluginDefinitionsPath, updated);

  console.log(`[cua-integrity] 已写回：全部版本记录对齐 ${sourceVersion}，manifest sha256 已按当前文件重算`);
}

await main();
