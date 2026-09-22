import { useCallback } from "react";
import type { ModelSelection } from "@zcode/shared";

// Start Plan 推荐弹窗依赖厂商权益快照（usageStatsService / startPlanQuotaBuckets），
// 已随厂商云功能下线。保留 hook 形状，提交时原样返回用户选择，不再发起推荐。
export function useStartPlanRecommendation(
  _view?: unknown,
  _surface?: "subagent",
): (selection: ModelSelection) => Promise<ModelSelection | null> {
  void _view;
  void _surface;
  return useCallback(async (selection: ModelSelection) => selection, []);
}
