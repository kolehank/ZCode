// BYOK：web 远程访问的鉴权核心（server 与 desktop 内嵌入口共用的纯函数层）。
// 三档语义：open（无应用层鉴权）/ cloudflare-access（CF JWT 验签）/ token（常量时间 hash 比较）。
// token 档取值：HTTP 用 Authorization Bearer；浏览器 WS 无法自定义头，`/ws*` 允许 query `?token=`。
import { createHash } from "node:crypto";
import type { WebAccessConfig } from "./webAccessConfig.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface WebAccessRequestLike {
  /** 含 query 的路径（如 "/ws?token=..."）；HTTP 侧用 req.url。 */
  url: string;
  headers: Record<string, string | undefined>;
  remoteAddress?: string;
}

export type WebAccessAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 500; detail: string };

/** `/ws*`（含升级）与 `/api/*` 必须鉴权；静态资源（index.html/asset）放行——token 在连接层校验。 */
export function isTokenProtectedPath(pathname: string): boolean {
  return pathname === "/ws" || pathname.startsWith("/ws/") || pathname.startsWith("/api/");
}

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function extractAccessToken(request: WebAccessRequestLike): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const value = authorization.slice("Bearer ".length).trim();
    if (value) return value;
  }
  if (request.url === "/ws" || request.url.startsWith("/ws?") || request.url.startsWith("/ws/")) {
    const queryToken = new URL(`https://local${request.url}`).searchParams.get("token");
    if (queryToken) return queryToken;
  }
  return null;
}

const JWKS_REFRESH_INTERVAL_MS = 3_600_000;

interface CfJwksCache {
  teamDomain: string;
  jwks: ReturnType<typeof createRemoteJWKSet> | null;
  createdAt: number;
}

const cfJwksCache: CfJwksCache = { teamDomain: "", jwks: null, createdAt: 0 };

function getCfJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now();
  if (
    !cfJwksCache.jwks ||
    cfJwksCache.teamDomain !== teamDomain ||
    now - cfJwksCache.createdAt >= JWKS_REFRESH_INTERVAL_MS
  ) {
    cfJwksCache.jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    cfJwksCache.teamDomain = teamDomain;
    cfJwksCache.createdAt = now;
  }
  return cfJwksCache.jwks;
}

export type CfVerifyResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 500; detail: string };

/** CF Access JWT 验签核心：JWT 原文不进日志，只记结果与原因摘要。 */
export async function verifyCloudflareAccessJwt(
  jwt: string | undefined,
  config: WebAccessConfig,
): Promise<CfVerifyResult> {
  if (!jwt) {
    return { ok: false, status: 401, detail: "missing Cf-Access-Jwt-Assertion header" };
  }
  if (!config.cfTeamDomain || !config.cfAud) {
    return {
      ok: false,
      status: 500,
      detail: "cloudflare-access mode requires cfTeamDomain and cfAud",
    };
  }
  try {
    const { payload } = await jwtVerify(jwt, getCfJwks(config.cfTeamDomain), {
      issuer: `https://${config.cfTeamDomain}`,
      audience: config.cfAud,
      algorithms: ["ES256"],
    });
    if (config.cfAllowedEmails.length > 0) {
      const email = typeof payload["email"] === "string" ? payload["email"].toLowerCase() : "";
      const allowed = config.cfAllowedEmails.some(
        (candidate) => candidate.trim().toLowerCase() === email,
      );
      if (!allowed) {
        return { ok: false, status: 403, detail: "email not in allowlist" };
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      detail: error instanceof Error ? error.message : "invalid access jwt",
    };
  }
}

export function tokenMatchesHash(token: string, tokenHash: string): boolean {
  const actual = createHash("sha256").update(token).digest("hex");
  const expected = tokenHash.toLowerCase();
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

/** token/CF 两档的同步判定入口；CF 档的异步验签请走 verifyCloudflareAccessJwt。 */
export function authorizeRequest(
  request: WebAccessRequestLike,
  config: WebAccessConfig,
): WebAccessAuthResult {
  switch (config.mode) {
    case "token": {
      const token = extractAccessToken(request);
      if (token && config.tokenHash && tokenMatchesHash(token, config.tokenHash)) {
        return { ok: true };
      }
      return { ok: false, status: 401, detail: "invalid or missing token" };
    }
    case "cloudflare-access":
      // CF 档的验签是异步的，由调用方（server）显式走 verifyCloudflareAccessJwt。
      return { ok: false, status: 401, detail: "cloudflare-access requires async verification" };
    default:
      return { ok: true };
  }
}
