import { ZCODE_VERSION, type ZCodeEnv } from "@zcode/shared";

declare const __ZCODE_CDN_BASE_URL__: string | undefined;
// BYOK fork：远程运行资源不再默认指向厂商 CDN（自托管，见 FORK.md P6）。
// 未配置 ZCODE_CDN_BASE_URL / __ZCODE_CDN_BASE_URL__ 时返回空列表，远程资源下载快速失败，
// 用户通过 env 指向自己的静态资源服务（GitHub Releases / 内网 nginx 均可）。
const DEFAULT_CDN_BASE_URL = "";

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.ZCODE_CDN_BASE_URL?.trim() ||
    (typeof __ZCODE_CDN_BASE_URL__ === "undefined" ? "" : __ZCODE_CDN_BASE_URL__) ||
    DEFAULT_CDN_BASE_URL;
  if (!baseUrl) {
    // 未配置自托管 CDN：返回空列表，调用方按"资源源不可用"处理，不发起任何请求。
    return [];
  }
  return [
    `${normalizeBaseUrl(baseUrl)}/zcode/electron/releases/${options.version ?? ZCODE_VERSION}`,
  ];
}
