import type { AppSettings } from "@zcode/shared";

/**
 * 引导触发判定（BYOK 动线）：settings 尚未加载完成时返回 null（判定中），
 * 加载完成后按“是否已有引导完成标记”判断是否需要引导。
 *
 * 完成标记沿用既有 setting 字段 onboardingOccupation：全屏职业问卷已随 BYOK 改造下线，
 * 该字段不再表达职业，只表达“引导已完成”——完成或跳过引导时
 * 写入既有“跳过”路径使用的默认值 other。不新增存储键，存量用户的既有标记继续生效，
 * 不会因为问卷下线被再次拉进引导。
 *
 * 旧实现优先走 onboarding-record RPC（记录问卷作答并支持换号回填），问卷下线后
 * 该链路无写入方，判定收敛为纯 settings 读取，去掉 RPC 等待与超时兜底。
 */
export function useOnboardingTrigger(options: { settings: AppSettings | null }): boolean | null {
  const { settings } = options;
  if (settings === null) {
    return null;
  }
  return !settings.onboardingOccupation;
}
