import { buildRuntimeZCodeApiUrl, resolveZaiBusinessBaseUrl } from "@zcode/shared";

// BYOK：Client Scenes 已改为本地空实现（clientScenesService），此常量当前无消费方。
// 有意保留作为上游 rebase 锚点：删除后上游对该行的任何修改都会变成 delete/modify 冲突。
export const ZCODE_CLIENT_SCENES_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
