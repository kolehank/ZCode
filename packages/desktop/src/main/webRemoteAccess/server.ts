// BYOK A2：桌面内嵌远程访问入口（HTTP 静态 + WS 桥到窗口 Host）。
// 三档鉴权语义与 FORK.md P3 一致：open（强制 loopback）/ cloudflare-access / token。
// 生命周期由设置页开关（web-access.json 的 desktopRemoteEnabled）驱动，默认关闭。
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { ElectronUtilityProcess } from "electron";
import type { WebAccessConfig } from "@zcode/server";
import {
  authorizeRequest,
  isLoopbackRemoteAddress,
  isTokenProtectedPath,
  verifyCloudflareAccessJwt,
} from "@zcode/server";

export interface WebRemoteAccessServerOptions {
  /** 生效配置（启动时快照；改动重启生效）。 */
  config: WebAccessConfig;
  /** 解析后的绑定地址（open 档调用方须已强制 127.0.0.1）。 */
  bindHost: string;
  port: number;
  /** Web 前端静态资源目录（安装包 resources/web-dist 或 dev 的 packages/web/dist）。 */
  webStaticDir: string | undefined;
  /** 取当前应被远控的窗口 Host 子进程（主窗口优先）。 */
  getHostChild: () => ElectronUtilityProcess | undefined;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface WebRemoteAccessServerHandle {
  port: number;
  stop(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStaticFile(
  res: ServerResponse,
  webStaticDir: string,
  pathname: string,
): void {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(webStaticDir, relative));
  if (!resolved.startsWith(normalize(webStaticDir))) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    // SPA fallback：非资产路径回 index.html。
    const index = join(webStaticDir, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "content-type": MIME_TYPES[".html"] });
      createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(resolved)] ?? "application/octet-stream",
  });
  createReadStream(resolved).pipe(res);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => resolveBody(body));
    req.on("error", () => resolveBody(""));
  });
}

/** WS ↔ Host MessagePort 字节透传桥：host 端 AttachServicePort 会为该 port 建 ChannelServer。 */
function bridgeWebSocketToHost(
  ws: WebSocket,
  child: ElectronUtilityProcess,
  logger: WebRemoteAccessServerOptions["logger"],
): void {
  const requestId = randomUUID();
  const attachmentId = randomUUID();
  const { port1, port2 } = new MessageChannelMain();
  // 复用 Host 既有的多客户端 attachment 机制：为 web 客户端开独立 ChannelServer，
  // clientMode=web-remote-replayable（会话落盘可恢复；桌面运行中会话的实时接力由
  // v4 transport 的既有事实流承载）。
  child.postMessage(
    {
      type: "attach-service-port",
      requestId,
      attachmentId,
      clientMode: "web-remote-replayable",
      scope: { kind: "local" },
    },
    [port2],
  );

  ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    port1.postMessage(new Uint8Array(buf), [new Uint8Array(buf).buffer]);
  });
  ws.on("close", () => port1.close());
  ws.on("error", () => port1.close());
  port1.on("message", (event) => {
    const data = event.data;
    // Host 端 MessagePortProtocol 的 flow-control 对象对浏览器无意义，桥不透传。
    if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
      if (ws.readyState === ws.OPEN) ws.send(data);
      return;
    }
  });
  port1.on("close", () => ws.close());
  port1.start();
  logger.info(`[web-remote-access] remote client attached attachmentId=${attachmentId}`);
}

export function startWebRemoteAccessServer(
  options: WebRemoteAccessServerOptions,
): Promise<WebRemoteAccessServerHandle> {
  const { config, logger } = options;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    const pathname = new URL(url, "https://local").pathname;
    const requestLike = {
      method: req.method,
      url,
      headers: req.headers as Record<string, string | undefined>,
      remoteAddress: req.socket.remoteAddress,
    };

    // open 档语义：无应用层鉴权。token/CF 档：/api/* 与 /ws*（upgrade 时校验）必须通过。
    if (config.mode !== "open" && isTokenProtectedPath(pathname)) {
      const auth = authorizeRequest(requestLike, config);
      if (!auth.ok) {
        json(res, auth.status, { error: auth.detail });
        return;
      }
      // 配置写接口仍只允许 loopback（本机设置页），远程只读。
      if (
        pathname.startsWith("/api/web-access") &&
        req.method !== "GET" &&
        !isLoopbackRemoteAddress(requestLike.remoteAddress)
      ) {
        json(res, 403, { error: "web access config writes require loopback" });
        return;
      }
    }

    // CF 档异步验签。
    if (config.mode === "cloudflare-access" && isTokenProtectedPath(pathname)) {
      void verifyCloudflareAccessJwt(
        req.headers["cf-access-jwt-assertion"],
        config,
      ).then((result) => {
        if (!result.ok) {
          json(res, result.status, { error: result.detail });
          return;
        }
        // CF 档放行后的实际处理（静态/API）交回主 handler：重入一次已鉴权请求。
        // 简化实现：此处直接放行静态与 WS 升级由 upgrade 事件处理。
        if (options.webStaticDir) {
          serveStaticFile(res, options.webStaticDir, pathname);
        } else {
          json(res, 404, { error: "web static root is not configured" });
        }
      });
      return;
    }

    if (options.webStaticDir) {
      serveStaticFile(res, options.webStaticDir, pathname);
      return;
    }
    res.writeHead(404).end("web static root is not configured");
  });

  const wss = new WebSocketServer({ noServer: true });

  // WS 升级：先过三档鉴权（CF 档验 JWT），再桥到窗口 Host 的 AttachServicePort。
  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "/";
    const pathname = new URL(url, "https://local").pathname;
    if (pathname !== "/ws" && !pathname.startsWith("/ws/")) {
      socket.destroy();
      return;
    }
    const requestLike = {
      method: "GET",
      url,
      headers: req.headers as Record<string, string | undefined>,
      remoteAddress: req.socket.remoteAddress,
    };
    const config0 = config;
    const proceed = () => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const child = options.getHostChild();
        if (!child) {
          socket.close();
          return;
        }
        bridgeWebSocketToHost(ws, child, logger);
      });
    };
    if (config0.mode === "cloudflare-access") {
      void verifyCloudflareAccessJwt(
        req.headers["cf-access-jwt-assertion"],
        config0,
      ).then((result) => {
        if (!result.ok) {
          socket.write(`HTTP/1.1 ${result.status} Unauthorized\r\nconnection: close\r\n\r\n`);
          socket.destroy();
          return;
        }
        proceed();
      });
      return;
    }
    const auth = authorizeRequest(requestLike, config0);
    if (!auth.ok) {
      socket.write(`HTTP/1.1 ${auth.status} Unauthorized\r\nconnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    proceed();
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port, options.bindHost, () => {
      server.removeListener("error", rejectPromise);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : options.port;
      logger.info(
        `[web-remote-access] listening mode=${config.mode} bind=${options.bindHost} port=${actualPort}`,
      );
      resolvePromise({
        port: actualPort,
        stop: () =>
          new Promise<void>((resolveStop) => {
            wss.close();
            server.close(() => resolveStop());
          }),
      });
    });
  });
}
