/* BYOK P3：三档 web 远程访问鉴权。open 无应用层鉴权、cloudflare-access 验 CF JWT、token 验静态 Bearer。 */
import type { Context, MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createServiceLogger } from "@zcode/services/node";
import { tokenMatchesHash, type WebAccessConfig } from "./webAccessConfig.js";

const logger = createServiceLogger("webAccess");

/**
 * 与既有 lite-token 中间件同一边界：`/ws*`（含升级请求）与 `/api/*` 必须鉴权，
 * 静态资源（index.html/asset）放行——token 在连接层校验。
 */
export function isTokenProtectedPath(pathname: string): boolean {
  return pathname === "/ws" || pathname.startsWith("/ws/") || pathname.startsWith("/api/");
}

/** open 档写接口仅允许 loopback 来源；兼容 IPv4-mapped IPv6 形式。 */
export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  const normalized = remoteAddress.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

export function getRequestRemoteAddress(c: Context): string | undefined {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress;
}
/** token 档取值：HTTP API 用 Authorization Bearer；浏览器 WS 无法自定义头，`/ws*` 允许 query `?token=`。 */
function extractAccessToken(c: Context): string | null {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const value = header.slice("Bearer ".length).trim();
    if (value) {
      return value;
    }
  }
  const url = new URL(c.req.url);
  if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
    const queryToken = url.searchParams.get("token");
    if (queryToken) {
      return queryToken;
    }
  }
  return null;
}

const JWKS_REFRESH_INTERVAL_MS = 3_600_000;

interface CfJwksCache {
  teamDomain: string;
  jwks: ReturnType<typeof createRemoteJWKSet> | null;
  createdAt: number;
}

// 模块级缓存：进程只有一个 CF 团队域配置，1h 强制刷新一次。
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

type CfVerifyResult = { ok: true } | { ok: false; status: 401 | 403 | 500; detail: string };

async function verifyCloudflareAccess(c: Context, config: WebAccessConfig): Promise<CfVerifyResult> {
  // 安全红线：JWT 原文不进日志，只记结果与原因摘要。
  const jwt = c.req.header("Cf-Access-Jwt-Assertion")?.trim();
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

/**
 * 启动时快照生效：运行中改动配置文件不改变当前鉴权行为，重启 server 后生效（v1 语义，热轮换后置）。
 * token 档未配置 tokenHash 时全部拒绝，避免「以为有鉴权其实裸奔」。
 */
export function createWebAccessMiddleware(config: WebAccessConfig): MiddlewareHandler {
  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (!isTokenProtectedPath(pathname)) {
      await next();
      return;
    }
    switch (config.mode) {
      case "open": {
        await next();
        return;
      }
      case "token": {
        const token = extractAccessToken(c);
        if (token && tokenMatchesHash(token, config.tokenHash)) {
          await next();
          return;
        }
        return c.json({ error: "Unauthorized" }, 401);
      }
      case "cloudflare-access": {
        const result = await verifyCloudflareAccess(c, config);
        if (result.ok) {
          await next();
          return;
        }
        logger.warn(undefined, "cloudflare access rejected request", {
          status: result.status,
          detail: result.detail,
          pathname,
        });
        return c.json({ error: "Unauthorized" }, result.status);
      }
    }
  };
}
