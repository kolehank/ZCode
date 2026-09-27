// BYOK A2：桌面内嵌远程访问入口的生命周期与配置管理（main 进程）。
// 启用状态存 web-access.json 的 desktopEnabled；server 随桌面 app 生命周期启停。
import { join } from "node:os";
import { homedir } from "node:os";
import type { ElectronUtilityProcess } from "electron";
import type { WebAccessConfig } from "@zcode/server";
import {
  getDefaultWebAccessConfig,
  loadWebAccessConfig,
  sanitizeWebAccessConfig,
  updateWebAccessConfig,
  generateWebAccessToken,
} from "@zcode/server";
import {
  startWebRemoteAccessServer,
  type WebRemoteAccessServerHandle,
} from "./server.js";

export interface WebRemoteAccessStatus {
  enabled: boolean;
  running: boolean;
  mode: WebAccessConfig["mode"];
  port?: number;
  bindHost?: string;
  tokenPrefix: string;
  hasToken: boolean;
  cfTeamDomain: string;
  cfAud: string;
  cfAllowedEmails: string[];
  externalBaseUrl: string;
}

export interface WebRemoteAccessSaveResult {
  status: WebRemoteAccessStatus;
  /** 明文 token 仅在生成时刻返回一次。 */
  token?: string;
  /** 拼好的访问链接（externalBaseUrl + /#token=…），仅在生成时刻返回。 */
  accessUrl?: string;
}

function getWebAccessConfigDir(): string {
  // 与 getAppConfigDir 同径（~/.zcode/v2），避免 desktop 依赖 services 的重复实现。
  const base = process.env.ZCODE_DATA_BASE_DIR?.trim() || join(homedir(), ".zcode");
  return join(base, "v2");
}

export class WebRemoteAccessController {
  readonly #logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  #getHostChild: () => ElectronUtilityProcess | undefined;
  #getWebStaticDir: () => string | undefined;
  #handle: WebRemoteAccessServerHandle | null = null;
  #config: WebAccessConfig = getDefaultWebAccessConfig();

  constructor(options: {
    logger: WebRemoteAccessServerOptionsLogger;
    getHostChild: () => ElectronUtilityProcess | undefined;
    getWebStaticDir: () => string | undefined;
  }) {
    this.#logger = options.logger;
    this.#getHostChild = options.getHostChild;
    this.#getWebStaticDir = options.getWebStaticDir;
  }

  get running(): boolean {
    return this.#handle !== null;
  }

  getStatus(): WebRemoteAccessStatus {
    return {
      enabled: this.#config.desktopEnabled,
      running: this.running,
      mode: this.#config.mode,
      port: this.#handle?.port,
      tokenPrefix: this.#config.tokenPrefix,
      hasToken: Boolean(this.#config.tokenHash),
      cfTeamDomain: this.#config.cfTeamDomain,
      cfAud: this.#config.cfAud,
      cfAllowedEmails: this.#config.cfAllowedEmails,
      externalBaseUrl: this.#config.externalBaseUrl,
    };
  }

  async reloadFromDisk(): Promise<WebRemoteAccessStatus> {
    this.#config = await loadWebAccessConfig();
    await this.#syncServerLifecycle();
    return this.getStatus();
  }

  /** 保存配置；mode/token 变更后需重启桌面应用生效（v1 语义）。 */
  async applyUpdate(update: {
    mode?: WebAccessConfig["mode"];
    cfTeamDomain?: string;
    cfAud?: string;
    cfAllowedEmails?: string[];
    externalBaseUrl?: string;
    desktopEnabled?: boolean;
    regenerate?: boolean;
  }): Promise<WebRemoteAccessSaveResult> {
    let oneTimeToken: string | undefined;
    let accessUrl: string | undefined;
    this.#config = await updateWebAccessConfig((current) => {
      const next: WebAccessConfig = {
        ...current,
        mode: update.mode ?? current.mode,
        cfTeamDomain: update.cfTeamDomain ?? current.cfTeamDomain,
        cfAud: update.cfAud ?? current.cfAud,
        cfAllowedEmails: update.cfAllowedEmails ?? current.cfAllowedEmails,
        externalBaseUrl: update.externalBaseUrl ?? current.externalBaseUrl,
        desktopEnabled: update.desktopEnabled ?? current.desktopEnabled,
      };
      if (next.mode === "token") {
        const shouldGenerate = update.regenerate === true || !next.tokenHash;
        if (shouldGenerate) {
          const generated = generateWebAccessToken();
          next.tokenHash = generated.tokenHash;
          next.tokenPrefix = generated.tokenPrefix;
          oneTimeToken = generated.token;
          if (next.externalBaseUrl) {
            accessUrl = `${next.externalBaseUrl}/#token=${generated.token}`;
          }
        }
      }
      return next;
    });
    await this.#syncServerLifecycle();
    return { status: this.getStatus(), token: oneTimeToken, accessUrl };
  }

  async #syncServerLifecycle(): Promise<void> {
    if (!this.#config.desktopEnabled) {
      await this.#handle?.stop();
      this.#handle = null;
      this.#logger.info("[web-remote-access] disabled; listener stopped");
      return;
    }
    if (this.#handle) {
      return;
    }
    const bindHost = this.#resolveBindHost(this.#config);
    this.#handle = await startWebRemoteAccessServer({
      config: this.#config,
      bindHost: bindHost.host,
      port: Number(process.env.ZCODE_WEB_REMOTE_PORT) || 30330,
      webStaticDir: this.#getWebStaticDir(),
      getHostChild: this.#getHostChild,
      logger: this.#logger,
    });
    this.#logger.info(
      `[web-remote-access] started mode=${this.#config.mode} bind=${bindHost.host} port=${this.#handle.port}`,
    );
  }

}

type WebRemoteAccessServerOptionsLogger = Parameters<
  typeof startWebRemoteAccessServer
>[0]["logger"];
