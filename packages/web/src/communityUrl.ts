import { resolveHelpAppConfig, type Locale } from "@zcode/shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  localConfig?: unknown;
}

// 远程帮助配置通道已随厂商云功能下线；社区链接只读内置 config/default.json。
export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return resolveHelpAppConfig(undefined, options.localConfig ?? localDefaultAppConfig)
    .community_urls?.[locale];
}
