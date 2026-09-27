// BYOK A2：桌面内嵌远程访问入口的设置页 IPC。
// 数据面唯一所有者是 WebRemoteAccessController（web-access.json 经 @zcode/server 读写）；
// 网卡枚举复用 @zcode/server 的 listWebAccessInterfaces，与 web 形态共用同一过滤/建议规则。
import { ipcMain } from "electron";
import { PlatformChannels } from "@zcode/shared";
import type {
  WebRemoteAccessConfigSnapshot,
  WebRemoteAccessSaveRequest,
  WebRemoteAccessSaveResponse,
} from "@zcode/shared";
import { WEB_ACCESS_MODES, listWebAccessInterfaces } from "@zcode/server";
import type { WebRemoteAccessController } from "./controller.js";

const WEB_ACCESS_MODE_SET: ReadonlySet<string> = new Set(WEB_ACCESS_MODES);

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * 校验并规整 renderer 的保存请求：renderer（与 web 设置页同一套表单）保证字段完整，
 * 这里只做类型收窄与越界值拒绝；缺省字段交由 controller 与磁盘当前值合并，
 * 与 server PUT 路由「宽松入参 + 跨字段校验」的语义保持一致。
 */
function parseSaveRequest(payload: unknown): WebRemoteAccessSaveRequest | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const mode = raw.mode;
  if (typeof mode !== "string" || !WEB_ACCESS_MODE_SET.has(mode)) {
    return null;
  }
  const request: WebRemoteAccessSaveRequest = { mode: mode as WebRemoteAccessSaveRequest["mode"] };
  const cfTeamDomain = asTrimmedString(raw.cfTeamDomain);
  const cfAud = asTrimmedString(raw.cfAud);
  const externalBaseUrl = asTrimmedString(raw.externalBaseUrl);
  const cfAllowedEmails = asStringArray(raw.cfAllowedEmails)?.map((email) => email.trim());
  if (cfTeamDomain !== undefined) request.cfTeamDomain = cfTeamDomain;
  if (cfAud !== undefined) request.cfAud = cfAud;
  if (externalBaseUrl !== undefined) request.externalBaseUrl = externalBaseUrl;
  if (cfAllowedEmails !== undefined) request.cfAllowedEmails = cfAllowedEmails;
  if (typeof raw.desktopEnabled === "boolean") request.desktopEnabled = raw.desktopEnabled;
  if (typeof raw.regenerate === "boolean") request.regenerate = raw.regenerate;
  return request;
}

/** invoke handler 抛错时 Electron 只把 message 传回 renderer；统一包一层 main 日志便于定位（不回显敏感字段）。 */
function wrapHandler<T>(
  channel: string,
  handler: (payload: unknown) => Promise<T>,
  error: (...args: unknown[]) => void,
): (payload: unknown) => Promise<T> {
  return async (payload: unknown) => {
    try {
      return await handler(payload);
    } catch (cause) {
      error(
        `[web-remote-access] ipc ${channel} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
      throw cause;
    }
  };
}

export function registerWebRemoteAccessIpc(options: {
  controller: WebRemoteAccessController;
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** web 前端静态资源目录解析器；与 server 启动用同一个（决定 webStaticConfigured）。 */
  getWebStaticDir: () => string | undefined;
}): void {
  const { controller, logger } = options;

  ipcMain.handle(
    PlatformChannels.WebAccessGetConfig,
    wrapHandler(
      PlatformChannels.WebAccessGetConfig,
      async (): Promise<WebRemoteAccessConfigSnapshot> => ({
        status: controller.getStatus(),
        interfaces: listWebAccessInterfaces(),
        webStaticConfigured: Boolean(options.getWebStaticDir()),
      }),
      logger.error,
    ),
  );

  ipcMain.handle(
    PlatformChannels.WebAccessSaveConfig,
    wrapHandler(
      PlatformChannels.WebAccessSaveConfig,
      async (payload: unknown): Promise<WebRemoteAccessSaveResponse> => {
        const request = parseSaveRequest(payload);
        if (!request) {
          throw new Error("invalid web access config payload");
        }
        // CF 档跨字段约束与 web 形态的 PUT 路由一致：域名/AUD 必填且域名为裸主机名。
        if (request.mode === "cloudflare-access") {
          const status = controller.getStatus();
          const teamDomain = request.cfTeamDomain ?? status.cfTeamDomain;
          const aud = request.cfAud ?? status.cfAud;
          if (!teamDomain || !aud) {
            throw new Error("cloudflare-access requires cfTeamDomain and cfAud");
          }
          if (/\/|^https?:/i.test(teamDomain)) {
            throw new Error("cfTeamDomain must be a bare hostname");
          }
        }
        const externalBaseUrl =
          request.externalBaseUrl ?? controller.getStatus().externalBaseUrl;
        if (externalBaseUrl && !/^https?:\/\//i.test(externalBaseUrl)) {
          throw new Error("externalBaseUrl must start with http:// or https://");
        }
        return controller.applyUpdate(request);
      },
      logger.error,
    ),
  );

  ipcMain.handle(
    PlatformChannels.WebAccessGetInterfaces,
    wrapHandler(
      PlatformChannels.WebAccessGetInterfaces,
      async () => ({
        interfaces: listWebAccessInterfaces(),
      }),
      logger.error,
    ),
  );
}
