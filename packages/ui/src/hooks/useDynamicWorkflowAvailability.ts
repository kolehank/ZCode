import { useMemo } from "react";
import {
  readDynamicWorkflowAvailabilitySnapshot,
  type DynamicWorkflowAvailabilitySnapshot,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

/**
 * 读动态工作流灰度快照。
 * 远端灰度通道已下线，renderer 固定 disabled；
 * Host/CLI 门禁仍按环境变量解析（见 store 内说明）。
 */
export function useDynamicWorkflowAvailability(): DynamicWorkflowAvailabilitySnapshot {
  return useMemo(() => readDynamicWorkflowAvailabilitySnapshot(), []);
}
