import type { DynamicWorkflowClientConfig } from "@zcode/shared";

// ============================================================
// 动态工作流灰度快照在 renderer 的唯一副本
// ============================================================
//
// 灰度快照原本经厂商订阅服务远端拉取；
// 该远端通道已随厂商云功能下线，renderer 侧降级为固定 disabled 快照——
// 入口宁可隐藏也不闪现。Host/CLI 侧门禁保留：仍按 ZCODE_DYNAMIC_WORKFLOW_MODE
// 环境变量解析（见 services/node.ts 的 resolveDynamicWorkflowClientConfig 占位），
// dev/preview 构建可用环境变量开启工作流工具面。

export type DynamicWorkflowAvailabilityStatus = "loading" | "ready";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly status: DynamicWorkflowAvailabilityStatus;
  /** loading 期间恒为 false：未知即不提供。 */
  readonly enabled: boolean;
  /** 未就绪或取数失败时为 null；`source` 只用于观测。 */
  readonly config: DynamicWorkflowClientConfig | null;
}

const DISABLED_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "ready",
  enabled: false,
  config: null,
};

export function readDynamicWorkflowAvailabilitySnapshot(): DynamicWorkflowAvailabilitySnapshot {
  return DISABLED_SNAPSHOT;
}
