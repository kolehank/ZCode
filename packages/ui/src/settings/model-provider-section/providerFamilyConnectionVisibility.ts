/* eslint-disable max-lines -- Settings 与输入框共用连接方式可见性规则，集中放置避免 Start/Coding/Team/API 条件漂移。 */
import type {
  ProviderFamilyDomain,
  ProviderFamilyConnectionSelection,
  ProviderFamilyConnectionSelectionSettings,
  UsageEntitlementSubscriptionDetail,
  UsageQuotaLimit,
} from "@zcode/shared";
import {
  getModelProviderFamilySpec,
  isIndividualCodingPlanModelProviderId,
  isStartPlanModelProviderId,
  MODEL_PROVIDER_FAMILY_SPECS,
  resolveModelProviderFamilySpecByProviderId,
} from "@zcode/shared";
import { resolveUsageEntitlementOutcome } from "@/lib/codingPlanProvider.js";
import {
  type CodingPlanEntitlementState,
  type CodingPlanStatus,
  type ModelProviderNavGroup,
} from "@/settings/model-provider-section/constants.js";

type TeamPlanNavItem = Extract<ModelProviderNavGroup["items"][number], { type: "teamPlan" }>;

function createTeamPlanNavigationKey(
  family: ProviderFamilyDomain,
  input: { productId: string; organizationId: string; projectId: string },
): string {
  return ["team", family, input.productId, input.organizationId, input.projectId]
    .map(encodeURIComponent)
    .join(":");
}

interface ResolvedCodingPlanEntitlementState {
  statusLabelId?: string;
  status: CodingPlanStatus;
  planLevel: string | null;
  currentProductId: string | null;
  subscriptionBillingCycle: string | null;
  subscriptionRenewTime: string | null;
  subscriptionExpireTime: string | null;
  subscriptionDetails?: UsageEntitlementSubscriptionDetail[];
  quotaLimits: UsageQuotaLimit[];
  /**
   * 官方 Server MCP 额度（服务端下发的总额度）。它不在 quota.limits[] 里，只在有套餐快照的分支填充；
   * 其余分支保持缺省（等价于不展示），避免十余处早退分支都要跟着改。
   */
  mcpQuotaLimit?: UsageQuotaLimit | null;
}

export function resolveCodingPlanEntitlementState({
  providerId,
  accountEntitled,
  accountAvailability,
  accountUnavailableReason,
  entitlement,
  modelProvidersLoading,
}: {
  providerId: string;
  /** 当前账号是否明确拥有该 Provider 对应的产品权益。 */
  accountEntitled: boolean;
  accountAvailability?: import("@zcode/provider").AccountProviderState["availability"];
  accountUnavailableReason?: import("@zcode/provider").AccountProviderState["unavailableReason"];
  entitlement?: CodingPlanEntitlementState;
  modelProvidersLoading: boolean;
}): ResolvedCodingPlanEntitlementState {
  // Start 校验失败是未知，仍允许读取/重试，不能回退为未登录。
  const canInspect =
    accountEntitled ||
    accountAvailability === "pending" ||
    (isStartPlanModelProviderId(providerId) && accountAvailability === "unknown");
  if (!canInspect && modelProvidersLoading) {
    return {
      // 新 Host 启动时 Account Overlay 的首份 View 可能晚于旧
      // Provider 快照。该窗口必须保持 checking，不能读旧 Key，也不能提前判定断开。
      status: "checking",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }
  if (!canInspect) {
    // entitled=false 不等于"没连上"。provider-refactor 之后 Account Overlay 只发布
    // entitled 布尔值，"已登录且服务端明确回答没有个人套餐"与"未连接"被合并渲染成
    // "未连接 + 连接按钮"（不由权益快照的 no_plan 判定为"未开通"），且不可用 provider
    // 不会再发起权益查询，UI 无法自行还原原因，只能依赖随 State 下发的原因分流。
    // Start 常驻后同样按原因展示；Team Plan 继续由团队权益快照组装。
    // 原因只在 availability === "unavailable" 时成立，unknown 表示本轮无法判定。
    if (
      accountAvailability === "unavailable" &&
      (isIndividualCodingPlanModelProviderId(providerId) || isStartPlanModelProviderId(providerId))
    ) {
      if (accountUnavailableReason === "not-entitled") {
        return {
          // 服务端明确无个人套餐：这是"未开通"，不是连接故障。
          status: "notPurchased",
          ...(isStartPlanModelProviderId(providerId) && entitlement?.snapshot?.startPlanExpired
            ? { statusLabelId: "settings.modelProvider.startPlan.status.expired" }
            : {}),
          planLevel: null,
          currentProductId: null,
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
        };
      }
      if (accountUnavailableReason === "credential-failed") {
        return {
          // 凭据失效属于权益同步失败，不是未购买；保持可重试/重新登录入口。
          status: "unavailable",
          planLevel: null,
          currentProductId: null,
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
        };
      }
    }
    return {
      // 套餐连接是 Account Overlay 事实，不是 Renderer 能读取的
      // API Key 事实。新 Host 明确传入 false 后，旧 Key 不得再点亮连接态。
      status:
        isStartPlanModelProviderId(providerId) && accountAvailability === "unknown"
          ? "unavailable"
          : "disconnected",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  const snapshot = entitlement?.snapshot ?? null;
  // 厂商权益/额度服务已随云功能下线：entitlement 缺省时连接态只由
  // Account Overlay 的 entitled 事实决定，套餐详情与额度不再展示。
  if (!entitlement) {
    return {
      status: "purchased",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      subscriptionDetails: [],
      quotaLimits: [],
    };
  }
  if (entitlement?.loading && !snapshot?.subscription) {
    return {
      // refresh 会保留上一轮 snapshot；只有没有有效 subscription 时才显示 checking。
      status: "checking",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  if (!snapshot && entitlement?.error) {
    return {
      // 权益请求失败时必须退出 loading 态。
      status: "unavailable",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  const currentSubscription = snapshot?.subscription?.details[0] ?? null;
  const subscriptionDetails = snapshot?.subscription?.details ?? [];
  const currentProductId = currentSubscription?.productId ?? null;
  const planLevel =
    currentSubscription?.productName ?? snapshot?.quota?.level ?? currentProductId ?? null;
  const subscriptionBillingCycle = currentSubscription?.billingCycle ?? null;
  const subscriptionRenewTime = currentSubscription?.renewTime ?? null;
  const subscriptionExpireTime = currentSubscription?.expireTime ?? null;

  if (currentSubscription) {
    return {
      // Z.AI/BigModel 的真实套餐状态来自 subscription/list。
      status: "purchased",
      ...(entitlement?.error
        ? { statusLabelId: "settings.modelProvider.codingPlan.status.unavailable" }
        : {}),
      planLevel,
      currentProductId,
      subscriptionBillingCycle,
      subscriptionRenewTime,
      subscriptionExpireTime,
      subscriptionDetails,
      quotaLimits: snapshot?.quota?.limits ?? [],
      mcpQuotaLimit: null,
    };
  }

  const entitlementOutcome = resolveUsageEntitlementOutcome(snapshot);
  if (entitlementOutcome === "inactive") {
    return {
      status: "notPurchased",
      ...(isStartPlanModelProviderId(providerId) && snapshot?.startPlanExpired
        ? { statusLabelId: "settings.modelProvider.startPlan.status.expired" }
        : {}),
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  if (entitlementOutcome === "unknown") {
    return {
      // 过去把非 no_plan 的未知快照兜底成“未购买”，并让 entitlement
      // 越权裁决 Account 是否断开。账号已连接时，未知证据只能展示暂不可用。
      status: "unavailable",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  return {
    status: "purchased",
    ...(entitlement?.error
      ? { statusLabelId: "settings.modelProvider.codingPlan.status.unavailable" }
      : {}),
    planLevel,
    currentProductId,
    subscriptionBillingCycle,
    subscriptionRenewTime,
    subscriptionExpireTime,
    subscriptionDetails,
    quotaLimits: snapshot?.quota?.limits ?? [],
      mcpQuotaLimit: null,
  };
}

export function buildVisibleFamilyConnectionItems({
  items,
  codingPlanEntitlements = {},
  connectionSelections,
  teamPlanSelections,
  showPurchasedTeamPlanFallback,
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements?: Partial<Record<string, CodingPlanEntitlementState>>;
  showPurchasedTeamPlanFallback: boolean;
  connectionSelections?: ProviderFamilyConnectionSelectionSettings;
  teamPlanSelections?: Partial<
    Record<
      ProviderFamilyDomain,
      Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }>
    >
  >;
}): ModelProviderNavGroup["items"] {
  // 厂商 enterprise pricing 商品目录已随云功能下线，subscribedTeamProducts 通道移除；
  // Team 连接项仅由 entitlement 快照与已保存选择派生。
  return appendSubscribedTeamPlanItems({
    items: filterStartPlanItemsByEntitlement({
      items,
      codingPlanEntitlements,
      connectionSelections,
    }),
    codingPlanEntitlements,
    teamPlanSelections,
    showPurchasedTeamPlanFallback,
  });
}

function filterStartPlanItemsByEntitlement({
  items,
  codingPlanEntitlements,
  connectionSelections,
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>;
  connectionSelections?: ProviderFamilyConnectionSelectionSettings;
}): Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>> {
  // 原变量名 hasBigModelTeamPlan 暗示只服务 bigmodel，但逻辑
  // （entitlement 或 subscribedTeamProducts）本身是 family 无关的。
  // 重命名为中性名称，并在下方 filter 去掉 familySpec.id === "bigmodel" 守卫，
  // 让 zai family 也能因 team plan 过滤 Start Plan 入口。
  const hasAnyTeamPlan = hasEntitlementTeamPlan(codingPlanEntitlements);
  return items.filter((item) => {
    if (!isStartPlanModelProviderId(item.presetId)) {
      return true;
    }
    const familySpec = resolveModelProviderFamilySpecByProviderId(item.presetId);
    if (!familySpec) {
      return false;
    }
    const codingItem = items.find(
      (candidate) => candidate.presetId === familySpec.individualCodingPlanProviderId,
    );
    const hasStartPlanEntitlement = item.status === "purchased";
    const isSelectedStartPlan = connectionSelections?.[familySpec.id]?.kind === "start-plan";
    const shouldPreserveUnresolvedSelection =
      isSelectedStartPlan && (item.status === "checking" || item.status === "unavailable");
    const loggedIn =
      item.accountEntitled === true ||
      codingItem?.accountEntitled === true ||
      isResolvedEntitlementStatus(item.status) ||
      isResolvedEntitlementStatus(codingItem?.status ?? "disconnected") ||
      hasAnyTeamPlan;

    if (!loggedIn) {
      // 未登录时体验套餐只作为详情页引导入口，不作为连接方式。
      return false;
    }

    // Start Plan 是独立连接；个人/团队 Coding 权益不再参与可见性判断。
    // 查询中或临时不可用时保留用户已选项，只有自身明确无权益才隐藏。
    return hasStartPlanEntitlement || shouldPreserveUnresolvedSelection;
  });
}

/**
 * 按 family 查找对应 family 的 Coding Plan nav item。
 * 原 appendSubscribedTeamPlanItems 硬编码找 bigmodelCodingPlan，
 * zai team plan items 无对应展示基线。zai/bigmodel 对称化后，team item 的
 * providerName、provider 等展示字段应继承自所属 family 的 codingPlanItem。
 */
function resolveCodingPlanItemForFamily(
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>,
  family: ProviderFamilyDomain,
): Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }> | undefined {
  const codingPlanProviderId = getModelProviderFamilySpec(family).individualCodingPlanProviderId;
  return items.find((item) => item.presetId === codingPlanProviderId);
}

function appendSubscribedTeamPlanItems({
  items,
  codingPlanEntitlements,
  teamPlanSelections,
  showPurchasedTeamPlanFallback,
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>;
  teamPlanSelections?: Partial<
    Record<
      ProviderFamilyDomain,
      Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }>
    >
  >;
  showPurchasedTeamPlanFallback: boolean;
}): ModelProviderNavGroup["items"] {
  // 原实现先 items.find(bigmodelCodingPlan)，不存在时直接 return items。
  // 当设置页只展示 zai family（providerFamilyDomain === "zai"）时，codingPlanItems 里
  // 没有 bigmodelCodingPlan，这个守卫会让 appendSubscribedTeamPlanItems 整体短路，
  // zai teamPlan item 永远不生成 → pickFamilyModeNavigationItem 找不到 saved team item
  // → selectedNavItem=null → 右侧 Plan Card 永远卡在 "加载中"。
  // 对称化：去掉 bigmodel 硬编码前置守卫，entitlement/fallback/product 三个 builder
  // 各自按 family 解析对应 codingPlanItem，不存在就跳过该 family。

  // entitlement + fallback 两个 builder 原来只对 bigmodelCodingPlanItem 调用，
  // zai 的 entitlement snapshot 和 fallback selectedKey 永远不生成 team item（断裂）。
  // 遍历两个 family，各用对应 codingPlanItem 派生 entitlement team items + fallback。
  const entitlementTeamItems: TeamPlanNavItem[] = MODEL_PROVIDER_FAMILY_SPECS.flatMap(
    ({ id: family }) => {
      const codingPlanItem = resolveCodingPlanItemForFamily(items, family);
      if (!codingPlanItem) {
        return [];
      }
      return buildEntitlementTeamPlanItems(codingPlanItem, codingPlanEntitlements, family);
    },
  );
  const fallbackTeamItems: TeamPlanNavItem[] = MODEL_PROVIDER_FAMILY_SPECS.flatMap(
    ({ id: family }) => {
      const selection = teamPlanSelections?.[family];
      const codingPlanItem = resolveCodingPlanItemForFamily(items, family);
      return selection && codingPlanItem
        ? buildSelectedTeamPlanFallbackItems({
            codingPlanItem,
            selection,
            showPurchasedTeamPlanFallback,
            family,
          })
        : [];
    },
  );
  if (entitlementTeamItems.length === 0 && fallbackTeamItems.length === 0) {
    return items;
  }

  const correctedEntitlementTeamItems = entitlementTeamItems;
  const correctedFallbackTeamItems = fallbackTeamItems;
  const correctedProjectKeys = new Set(
    correctedEntitlementTeamItems.map(resolveTeamPlanProjectKey),
  );
  const teamItems: ModelProviderNavGroup["items"] = [
    ...correctedEntitlementTeamItems,
    ...correctedFallbackTeamItems.filter(
      (item) => !correctedProjectKeys.has(resolveTeamPlanProjectKey(item)),
    ),
  ];

  if (teamItems.length === 0) {
    return items;
  }

  // 原写法硬编码 items.findIndex(bigmodelCodingPlanItem.key) 作为插入点，
  // zai-only 视图下 bigmodelCodingPlanItem 不存在会 throw（.key 访问 undefined）。
  // 改为按首个 team item 所属 family 找对应 codingPlanItem 作为插入锚点；
  // 找不到就追加到末尾（与原 fallback 语义一致）。
  const firstTeamFamily = resolveModelProviderFamilySpecByProviderId(
    (teamItems[0] as TeamPlanNavItem | undefined)?.presetId ?? "",
  )?.id;
  const anchorCodingPlanItem = firstTeamFamily
    ? resolveCodingPlanItemForFamily(items, firstTeamFamily)
    : undefined;
  const codingPlanIndex = anchorCodingPlanItem
    ? items.findIndex((item) => item.key === anchorCodingPlanItem.key)
    : -1;
  if (codingPlanIndex < 0) {
    return [...items, ...teamItems];
  }
  return [
    ...items.slice(0, codingPlanIndex + 1),
    ...teamItems,
    ...items.slice(codingPlanIndex + 1),
  ];
}

function hasEntitlementTeamPlan(
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>,
): boolean {
  return Object.values(codingPlanEntitlements).some(
    (entitlement) =>
      entitlement?.snapshot?.context?.scope === "team" &&
      Boolean(entitlement.snapshot.context.organizationId?.trim()) &&
      Boolean(entitlement.snapshot.context.projectId?.trim()),
  );
}

function buildEntitlementTeamPlanItems(
  codingPlanItem: Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>,
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>,
  family: ProviderFamilyDomain,
): TeamPlanNavItem[] {
  // 原硬编码读 bigmodelCodingPlan bucket + bigmodel team key。
  // zai/bigmodel 对称化后，按 family 读对应 codingPlan bucket、生成对应前缀 team key。
  const familySpec = getModelProviderFamilySpec(family);
  const codingPlanProviderId = familySpec.teamCodingPlanProviderId;
  const entitlement = codingPlanEntitlements[codingPlanProviderId];
  if (!entitlement) {
    return [];
  }
  const snapshot = entitlement.snapshot ?? null;
  if (snapshot?.context?.scope !== "team") {
    return [];
  }
  const organizationId = snapshot.context.organizationId?.trim() ?? "";
  const projectId = snapshot.context.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return [];
  }
  const currentSubscription = snapshot.subscription?.details[0] ?? null;
  const productId =
    snapshot.context.productId?.trim() ||
    currentSubscription?.productId?.trim() ||
    codingPlanItem.currentProductId?.trim() ||
    "current";
  const teamPlanName =
    snapshot.context.displayName?.trim() ||
    currentSubscription?.productName?.trim() ||
    codingPlanItem.planLevel?.trim() ||
    "Team";
  return [
    {
      ...codingPlanItem,
      key: createTeamPlanNavigationKey(family, {
        productId,
        organizationId,
        projectId,
      }),
      presetId: codingPlanProviderId,
      type: "teamPlan" as const,
      label: `${codingPlanItem.providerName} - ${teamPlanName}`,
      teamPlanName,
      organizationId,
      projectId,
      status: "purchased" as const,
      // Team Plan 连接项先以 entitlement snapshot 为主数据源。
      // enterprise pricing/customerInfo 只负责后续校正名称和商品字段，不能让连接方式退回 Coding Plan。
      planLevel: teamPlanName,
      currentProductId: productId,
      purchaseUrl: familySpec.teamCodingPlanManageUrl,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      statusActive: true,
    },
  ];
}

function buildSelectedTeamPlanFallbackItems({
  codingPlanItem,
  selection,
  showPurchasedTeamPlanFallback,
  family,
}: {
  codingPlanItem: Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>;
  selection: Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }>;
  showPurchasedTeamPlanFallback: boolean;
  family: ProviderFamilyDomain;
}): TeamPlanNavItem[] {
  if (!showPurchasedTeamPlanFallback) {
    return [];
  }
  const teamPlanName = codingPlanItem.planLevel?.trim() || "Team";
  const familySpec = getModelProviderFamilySpec(family);
  const teamProviderId = familySpec.teamCodingPlanProviderId;
  return [
    {
      ...codingPlanItem,
      key: createTeamPlanNavigationKey(family, {
        productId: selection.productId,
        organizationId: selection.organizationId,
        projectId: selection.projectId,
      }),
      presetId: teamProviderId,
      type: "teamPlan" as const,
      label: `${codingPlanItem.providerName} - ${teamPlanName}`,
      teamPlanName,
      organizationId: selection.organizationId,
      projectId: selection.projectId,
      status: "purchased" as const,
      // enterprise pricing 可能尚未返回 subscribed 团队项目，
      // 但 shared settings 已保存 Team Plan selectedKey。设置页需要先展示同一连接方式，
      // 避免和输入框/registry 的 Team Plan 选择短暂断裂。
      planLevel: teamPlanName,
      currentProductId: selection.productId,
      purchaseUrl: familySpec.teamCodingPlanManageUrl,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      statusActive: true,
    },
  ];
}

function resolveTeamPlanProjectKey(item: TeamPlanNavItem): string {
  const organizationId = item.organizationId?.trim() || "";
  const projectId = item.projectId?.trim() || "";
  if (organizationId && projectId) {
    return `${organizationId}:${projectId}`;
  }
  return item.key;
}

function isResolvedEntitlementStatus(status: CodingPlanStatus): boolean {
  return status !== "checking" && status !== "disconnected";
}
