export { createHttpServer } from "./http.js";

// BYOK A2：桌面内嵌远程访问入口复用的 web-access 配置与鉴权核心。
// 这里的函数均为纯 node/zod 实现（无 hono 依赖），供 desktop main 的
// 内嵌 HTTP/WS 入口与设置页 IPC 数据源复用。
export {
  loadWebAccessConfig,
  updateWebAccessConfig,
  sanitizeWebAccessConfig,
  generateWebAccessToken,
  tokenMatchesHash,
  resolveWebBindHost,
  getDefaultWebAccessConfig,
  webAccessUpdateSchema,
  isLoopbackHost,
} from "./webAccessConfig.js";
export type {
  WebAccessConfig,
  WebAccessMode,
  WebAccessUpdateInput,
  WebBindResolution,
} from "./webAccessConfig.js";
export {
  isTokenProtectedPath,
  isLoopbackRemoteAddress,
  extractAccessToken,
  authorizeRequest,
  verifyCloudflareAccessJwt,
} from "./webAccessAuthBridge.js";
