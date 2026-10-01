import assert from "node:assert/strict";
import test from "node:test";
import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@zcode/contracts";
import {
  OFFICIAL_PLUGIN_DEFINITIONS,
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS as BOOTSTRAP_DEFAULT_ENABLED_IDS,
} from "../src/app/official-plugin-definitions.js";
import { DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS as SHARED_DEFAULT_ENABLED_IDS } from "@zcode/shared";

test("Settings 默认启用集合与 CLI 官方插件声明的 defaultEnabled 机械对照", () => {
  // 本测试落实 packages/shared/src/plugin-marketplaces.ts 与
  // official-plugin-definitions.ts 里两处「机械对照单测」的注释承诺：
  // 任何一侧增删 defaultEnabled 而不同步另一侧时在此直接失败。
  const derivedFromDefinitions = new Set(
    OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
      (definition) => `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
    ),
  );
  // shared 名单（Settings 三类资源发现使用）必须与 definition 派生结果逐一对应。
  assert.deepEqual(
    [...SHARED_DEFAULT_ENABLED_IDS].sort(),
    [...derivedFromDefinitions].sort(),
    "shared 的 DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 与 OFFICIAL_PLUGIN_DEFINITIONS 的 defaultEnabled 集合不一致",
  );
  // bootstrap 自身派生并透传给 adapter 的集合也不能与 definition 漂移。
  assert.deepEqual(
    [...BOOTSTRAP_DEFAULT_ENABLED_IDS].sort(),
    [...derivedFromDefinitions].sort(),
    "bootstrap 的 DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 与 OFFICIAL_PLUGIN_DEFINITIONS 的 defaultEnabled 集合不一致",
  );
});

test("官方插件定义的 id 与 name 均唯一", () => {
  const ids = OFFICIAL_PLUGIN_DEFINITIONS.map(
    (definition) => `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
  );
  assert.equal(new Set(ids).size, ids.length, "官方插件 id（name@marketplace）存在重复");
  const names = OFFICIAL_PLUGIN_DEFINITIONS.map((definition) => definition.name);
  assert.equal(new Set(names).size, names.length, "官方插件 name 存在重复");
});
