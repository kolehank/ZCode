import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfigObject } from "@zcode/provider";
import {
  createProviderModelDraftValues,
  resolveProviderModelDraftCommit,
} from "../src/settings/model-provider-section/ProviderModelMetadata.js";
import type { ProviderSettingsFormModel } from "../src/lib/providerSettingsFormTypes.js";

function createModelConfig(maxOutputTokens: ModelConfigObject["optionSpecs"]): ModelConfigObject {
  return {
    enabled: true,
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: 200000,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    },
    optionSpecs: {
      reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
      ...maxOutputTokens,
    },
  };
}

function createFormModel(input: {
  config: ModelConfigObject;
  personalConfig?: ModelConfigObject;
  useRecommendedConfig?: boolean;
}): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId: "review-model",
    builtin: false,
    inheritedConfig: input.config,
    personalConfig: input.personalConfig ?? {},
    useRecommendedConfig: input.useRecommendedConfig ?? true,
    config: input.config,
    hasPersonalConfig: Object.keys(input.personalConfig ?? {}).length > 0,
    executable: true,
    selectable: true,
  };
}

test("编辑 maxOutputTokens 不把内置身份规则的系统 map 物化进个人 Overlay", () => {
  // 内置规则库按 apiType 注入 map（此处以 openai-chat-completions 的
  // max_completion_tokens 为例）；稀疏 Overlay 缺省 map 表示继续继承内置规则。
  const config = createModelConfig({
    maxOutputTokens: { max: 32000, map: "{'max_completion_tokens': maxOutputTokens}" },
  });
  const model = createFormModel({ config });
  const draft = {
    ...createProviderModelDraftValues(model),
    maxOutputTokensValue: "8192",
  };
  const commit = resolveProviderModelDraftCommit({ currentModel: model, draft });
  assert.equal(commit.status, "commit");
  if (commit.status !== "commit") return;
  const personalMax = commit.model.personalConfig.optionSpecs?.maxOutputTokens;
  assert.deepEqual(personalMax, { max: 8192 });
  // effective 视图仍保留内置映射，供本次会话展示与后续保存。
  assert.equal(
    commit.model.config.optionSpecs?.maxOutputTokens?.map,
    "{'max_completion_tokens': maxOutputTokens}",
  );
});

test("personal 与 effective 均无 map 且未提供 API 形态时按标准字段名 max_tokens 兜底", () => {
  // 旧手写配置/无身份规则覆盖且拿不到 Provider apiType 的场景：complete 校验要求 map 必填。
  const config = createModelConfig({ maxOutputTokens: { max: 32000 } });
  const model = createFormModel({ config });
  const draft = {
    ...createProviderModelDraftValues(model),
    maxOutputTokensValue: "8192",
  };
  const commit = resolveProviderModelDraftCommit({ currentModel: model, draft });
  assert.equal(commit.status, "commit");
  if (commit.status !== "commit") return;
  assert.deepEqual(commit.model.personalConfig.optionSpecs?.maxOutputTokens, {
    max: 8192,
    map: "{'max_tokens': maxOutputTokens}",
  });
});

test("兜底 map 按 API 形态选择请求字段名，与内置规则库保持一致", () => {
  // 修复依据：byok-builtin.json modelApiRules 兜底规则按 apiType 注入不同请求字段，
  // 过去硬编码 max_tokens 会让 openai 形态端点收到错误字段。
  const cases = [
    {
      providerApiType: "anthropic-messages" as const,
      expectedMap: "{'max_tokens': maxOutputTokens}",
    },
    {
      providerApiType: "openai-chat-completions" as const,
      expectedMap: "{'max_completion_tokens': maxOutputTokens}",
    },
    {
      providerApiType: "openai-responses" as const,
      expectedMap: "{'max_output_tokens': maxOutputTokens}",
    },
  ];
  for (const { providerApiType, expectedMap } of cases) {
    const config = createModelConfig({ maxOutputTokens: { max: 32000 } });
    const model = createFormModel({ config });
    const draft = {
      ...createProviderModelDraftValues(model),
      maxOutputTokensValue: "8192",
    };
    const commit = resolveProviderModelDraftCommit({
      currentModel: model,
      draft,
      providerApiType,
    });
    assert.equal(commit.status, "commit");
    if (commit.status !== "commit") return;
    assert.deepEqual(
      commit.model.personalConfig.optionSpecs?.maxOutputTokens,
      { max: 8192, map: expectedMap },
      `apiType=${providerApiType} 应兜底为 ${expectedMap}`,
    );
  }
});

test("personal 已显式保存过的 map 优先保留", () => {
  const config = createModelConfig({
    maxOutputTokens: { max: 32000, map: "{'max_completion_tokens': maxOutputTokens}" },
  });
  const model = createFormModel({
    config,
    personalConfig: {
      optionSpecs: { maxOutputTokens: { max: 4096, map: "{'max_output_tokens': maxOutputTokens}" } },
    },
    useRecommendedConfig: true,
  });
  const draft = {
    ...createProviderModelDraftValues(model),
    maxOutputTokensValue: "8192",
  };
  const commit = resolveProviderModelDraftCommit({ currentModel: model, draft });
  assert.equal(commit.status, "commit");
  if (commit.status !== "commit") return;
  assert.deepEqual(commit.model.personalConfig.optionSpecs?.maxOutputTokens, {
    max: 8192,
    map: "{'max_output_tokens': maxOutputTokens}",
  });
});

test("固定模式物化的个人配置始终只保留 max（map 由内置规则在解析期叠加）", () => {
  const config = createModelConfig({
    maxOutputTokens: { max: 32000, map: "{'max_completion_tokens': maxOutputTokens}" },
  });
  const model = createFormModel({ config, useRecommendedConfig: false });
  const draft = {
    ...createProviderModelDraftValues(model),
    useRecommendedConfigValue: false,
    contextWindowValue: "128000",
    maxOutputTokensValue: "8192",
    reasoningLevelMapValue: "{}",
  };
  const commit = resolveProviderModelDraftCommit({ currentModel: model, draft });
  assert.equal(commit.status, "commit");
  if (commit.status !== "commit") return;
  assert.deepEqual(commit.model.personalConfig.optionSpecs?.maxOutputTokens, { max: 8192 });
});
