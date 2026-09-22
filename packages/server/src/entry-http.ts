import { createLocalServices, getAppConfigDir } from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";
import { loadWebAccessConfig, resolveWebBindHost } from "./webAccessConfig.js";

async function main(): Promise<void> {
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  // BYOK P3：bind 优先级 ZCODE_WEB_BIND_HOST > ZCODE_SERVER_HOST > HOST，默认 127.0.0.1。
  const configuredHost =
    process.env["ZCODE_WEB_BIND_HOST"]?.trim() ||
    process.env["ZCODE_SERVER_HOST"]?.trim() ||
    process.env["HOST"]?.trim() ||
    "";
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  // web-access.json 损坏时 loadWebAccessConfig 会备份并抛错：拒绝以安全配置的回退值
  // 静默启动（可能裸奔或锁死），让部署者显式修复。
  const webAccessConfig = await loadWebAccessConfig();
  const bind = resolveWebBindHost(webAccessConfig, configuredHost, Boolean(authToken));
  if (bind.forcedLoopback) {
    // 不输出任何 token/JWT 相关内容；只说明覆盖原因。
    console.warn(
      `[zcode-server:http] web access mode is "${webAccessConfig.mode}" but a non-loopback bind ` +
        `"${configuredHost}" was configured; overriding bind host to 127.0.0.1. ` +
        `Set ZCODE_WEB_BIND_HOST explicitly together with a protected web access mode.`,
    );
  }
  const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    host: bind.host,
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
    webAccess: webAccessConfig,
  });
}

void main().catch((error: unknown) => {
  console.error("[zcode-server:http] startup failed", error);
  process.exitCode = 1;
});
