import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

/**
 * BYOK fork：Client Scenes 目录（官方场景模板）依赖产品云 `/api/v1/client/scenes`，
 * 该通道已随厂商云功能摘除下线。服务保留接口与空实现，UI 走既有“暂不可用”空态，
 * 不再向产品端点发起任何请求。
 */
const EMPTY_CLIENT_SCENES_RESPONSE: ClientScenesResponse = Object.freeze({
  code: 0,
  msg: "ok",
  data: [],
});

export function createClientScenesService(): IClientScenesService {
  return {
    list: async () => EMPTY_CLIENT_SCENES_RESPONSE,
  };
}
