/* eslint-disable max-lines -- Model Provider 详情页当前集中编排 Plan 卡、API Key 表单和 OAuth 套餐态；后续稳定后再按 family/API/OAuth 拆分。 */
import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  type BuiltinModelProviderId,
  type ProviderFamilyConnectionSelectionSettings,
  isIndividualCodingPlanModelProviderId,
  isStartPlanModelProviderId,
  resolveModelProviderFamilySpecByProviderId,
  type ModelConnectivityResult,
  type OAuthProviderId,
} from "@zcode/shared";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import {
  type CodingPlanStatus,
  type ModelProviderNavItem,
} from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import {
  ModelProviderLoadingCard,
  PresetProviderPlaceholderCard,
} from "./StatusCards.js";
import type { CodingPlanLoginOptions } from "./codingPlanPricingCards.js";
import {
  ProviderFamilyDetailShell,
  ProviderFamilyHeader,
  ProviderFamilyPlanModeSwitch,
} from "./ProviderFamilyModeHeader.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import type { ProviderSettingsView } from "@zcode/services";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import { resolveAccountProviderInspectionAccess } from "@/lib/accountProviderAccess.js";
import { projectProviderSettingsViewToFormProviders } from "@/lib/providerSettingsFormProjection.js";

function isPlanNavItem(
  item: ModelProviderNavItem | null,
): item is Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }> {
  return item?.type === "codingPlan" || item?.type === "teamPlan";
}

function hasTeamPlanContext(item: ModelProviderNavItem | null): item is Extract<
  ModelProviderNavItem,
  { type: "teamPlan" }
> & {
  organizationId: string;
  projectId: string;
} {
  return (
    item?.type === "teamPlan" &&
    (item.organizationId?.trim().length ?? 0) > 0 &&
    (item.projectId?.trim().length ?? 0) > 0
  );
}

function resolveTeamPlanInspectionAccess(
  item: Extract<ModelProviderNavItem, { type: "teamPlan" }>,
) {
  // 不可用套餐仍需查询失效原因；组织/项目身份来自团队导航，不能被执行可用性门禁清空。
  const family = resolveModelProviderFamilySpecByProviderId(item.presetId)?.id;
  const productId = item.currentProductId?.trim();
  const organizationId = item.organizationId?.trim();
  const projectId = item.projectId?.trim();
  if (!family || !productId || !organizationId || !projectId) return undefined;
  return {
    type: "zhipu-account" as const,
    family,
    planKind: "team-coding-plan" as const,
    productId,
    organizationId,
    projectId,
  };
}

function resolvePlanSettingsProvider({
  view,
  providerId,
  fallback,
}: {
  view: ProviderSettingsView | null | undefined;
  providerId: string;
  fallback: ProviderSettingsFormProvider | null;
}): ProviderSettingsFormProvider | null {
  if (view) {
    return (
      projectProviderSettingsViewToFormProviders(view).find(
        (provider) => provider.providerId === providerId,
      ) ?? null
    );
  }
  return fallback?.providerId === providerId ? fallback : null;
}

export function ModelProviderSectionDetail({
  selectedNavItem,
  navigationItems = selectedNavItem ? [selectedNavItem] : [],
  connectionSettingsFailed = false,
  connectionSelections,
  startPlanSubscriptionCount = 0,
  presetLoading,
  codingPlanPurchaseTokenAuthenticatedByProviderId,
  codingPlanAuthError,
  presetSubscriptionProviderId,
  codingPlanStatusSyncProviderId,
  codingPlanDisconnectProviderId,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  onCodingPlanLogin,
  onRetryCodingPlan,
  onCodingPlanDisconnect,
  onOpenApiKeyUrl,
  onOpenBigModelRegistration,
  onCodingPlanPurchaseComplete,
  onSelectNavItem,
  providerSettingsView: providerSettingsViewOverride,
}: {
  selectedNavItem: ModelProviderNavItem | null;
  navigationItems?: ModelProviderNavItem[];
  connectionSettingsFailed?: boolean;
  connectionSelections?: ProviderFamilyConnectionSelectionSettings;
  startPlanSubscriptionCount?: number;
  presetLoading: boolean;
  codingPlanPurchaseTokenAuthenticatedByProviderId: Partial<
    Record<BuiltinModelProviderId, boolean>
  >;
  codingPlanAuthError?: string | null;
  presetSubscriptionProviderId: BuiltinModelProviderId | null;
  codingPlanStatusSyncProviderId: BuiltinModelProviderId | null;
  codingPlanDisconnectProviderId: BuiltinModelProviderId | null;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onRetryCodingPlan?: () => void | Promise<void>;
  onCodingPlanLogin: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
    status: CodingPlanStatus,
    options?: CodingPlanLoginOptions,
  ) => number | void;
  onCodingPlanDisconnect: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
  ) => void;
  onOpenApiKeyUrl: (url: string) => void;
  onOpenBigModelRegistration: () => void;
  onCodingPlanPurchaseComplete: () => void | Promise<void>;
  onSelectNavItem?: (item: ModelProviderNavItem) => void;
  providerSettingsView?: ProviderSettingsView | null;
}) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  const rootProviderSettingsRead = useProviderSettingsView();
  const rootProviderSettingsView =
    rootProviderSettingsRead.state.status === "ready" ? rootProviderSettingsRead.state.view : null;
  const providerSettingsView = providerSettingsViewOverride ?? rootProviderSettingsView;
  // 账号分支曾漏传删除回调，出现只删 UI 不写盘。所有详情共用同一套模型操作装配。
  const modelEditingProps = {
    onAddPersonalModel,
    onSavePersonalModelDraft,
    onSetPersonalModelEnabled,
    onDeletePersonalModel,
    settingsRevision: providerSettingsView?.revision,
  };
  const planModeSwitch = (
    <ProviderFamilyPlanModeSwitch
      selectedNavItem={selectedNavItem}
      navigationItems={navigationItems}
      connectionSettingsFailed={connectionSettingsFailed}
      connectionSelections={connectionSelections}
      startPlanSubscriptionCount={startPlanSubscriptionCount}
      onSelectNavItem={onSelectNavItem}
    />
  );

  if (!selectedNavItem) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  if (selectedNavItem.type === "preset") {
    if (!selectedNavItem.provider) {
      // 首屏慢网时预置供应商配置尚未返回，之前这里会直接展示“尚未同步，请先完成 OAuth 登录”，
      // 用户会把“还在下载”误判成“当前账号未登录”。首刷期间改为明确显示 loading，等请求结束后再决定是否展示未同步占位。
      if (presetLoading) {
        return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
      }

      return <PresetProviderPlaceholderCard displayName={selectedNavItem.displayName} />;
    }

    const presetProvider = selectedNavItem.provider;

    const familySpec = resolveModelProviderFamilySpecByProviderId(selectedNavItem.presetId);
    const presetFamilyHeader = (
      <ProviderFamilyHeader
        selectedNavItem={selectedNavItem}
        trailingAction={familySpec ? planModeSwitch : undefined}
      />
    );
    return (
      <ProviderFamilyDetailShell header={presetFamilyHeader}>
        <InlineEditableProviderCard
          provider={presetProvider}
          onSave={onSave}
          {...modelEditingProps}
          onReorderModelIds={
            onReorderProviderModels
              ? (modelIds) => onReorderProviderModels(presetProvider.providerId, modelIds)
              : undefined
          }
          onTestModel={onTestModel}
          readOnlyEndpoints
          // 预置供应商名称承载固定 API Key 入口语义，
          // 允许重命名会让侧边栏和模型选择器展示含义不一致，因此只允许自定义供应商改名。
          nameEditable={false}
          headerVisible={!familySpec}
          headerActionsVisible={familySpec ? false : undefined}
        />
      </ProviderFamilyDetailShell>
    );
  }

  if (isPlanNavItem(selectedNavItem)) {
    // 厂商套餐/额度/购买面板已随厂商云功能下线：详情页降级为
    // 「连接状态 + OAuth 登录/断开」的最小状态卡，模型配置表单继续可用。
    const planNavItem = selectedNavItem;
    const dedicatedProvider = resolvePlanSettingsProvider({
      view: providerSettingsView,
      providerId: planNavItem.presetId,
      fallback: planNavItem.provider,
    });
    const codingPlanStatusSyncPending = codingPlanStatusSyncProviderId === planNavItem.presetId;
    const codingPlanDisconnectPending = codingPlanDisconnectProviderId === planNavItem.presetId;
    const planLoginPending = presetSubscriptionProviderId === planNavItem.presetId;
    const isStartPlanProvider = isStartPlanModelProviderId(planNavItem.presetId);
    const showDisconnect =
      (planNavItem.oauthProviderId === BIGMODEL_PROVIDER_ID ||
        planNavItem.oauthProviderId === ZAI_PROVIDER_ID) &&
      (dedicatedProvider?.providerId === planNavItem.presetId ||
        planNavItem.provider?.providerId === planNavItem.presetId) &&
      planNavItem.status !== "disconnected";
    const planStatusHeader = (
      <ProviderFamilyHeader selectedNavItem={planNavItem} trailingAction={planModeSwitch} />
    );
    const planStatusCard = (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
          <div className="min-w-0 space-y-1">
            <h3 className="min-w-0 truncate text-ui-lg font-semibold leading-5 text-foreground">
              {planNavItem.inactivePlanTitle?.trim() || planNavItem.providerName}
            </h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-base text-foreground-subtle">
              {codingPlanStatusSyncPending || planLoginPending ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : null}
              <span>
                {planNavItem.statusMessage?.trim() ||
                  intl.formatMessage({
                    id:
                    planNavItem.statusLabelId ??
                      `settings.modelProvider.codingPlan.status.${planNavItem.status}`,
                  })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 max-sm:w-full max-sm:[&>button]:w-full">
            {codingPlanStatusSyncPending || planNavItem.status === "unavailable" ? (
              <Button
                type="button"
                size="lg"
                onClick={() => void onRetryCodingPlan?.()}
                disabled={codingPlanStatusSyncPending}
              >
                {intl.formatMessage({ id: "common.retry" })}
              </Button>
            ) : planNavItem.status === "disconnected" || planNavItem.status === "notPurchased" ? (
              <Button
                type="button"
                size="lg"
                onClick={() =>
                  onCodingPlanLogin(
                    planNavItem.presetId,
                    planNavItem.oauthProviderId,
                    planNavItem.providerName,
                    planNavItem.status,
                  )
                }
                disabled={planLoginPending}
              >
                {planLoginPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                {intl.formatMessage({
                  id: isStartPlanProvider
                    ? "settings.modelProvider.startPlan.login"
                    : "settings.modelProvider.codingPlan.connect",
                })}
              </Button>
            ) : null}
            {showDisconnect ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() =>
                  onCodingPlanDisconnect(
                    planNavItem.presetId,
                    planNavItem.oauthProviderId,
                    planNavItem.providerName,
                  )
                }
                disabled={codingPlanDisconnectPending}
              >
                {codingPlanDisconnectPending ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : null}
                {intl.formatMessage({ id: "settings.modelProvider.codingPlan.disconnect" })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
    const shouldShowPlanProviderDetail =
      dedicatedProvider !== null &&
      planNavItem.status !== "disconnected" &&
      planNavItem.status !== "notPurchased";
    if (shouldShowPlanProviderDetail && dedicatedProvider) {
      return (
        <ProviderFamilyDetailShell header={planStatusHeader}>
          <InlineEditableProviderCard
            provider={dedicatedProvider}
            onSave={onSave}
            {...modelEditingProps}
            onReorderModelIds={
              onReorderProviderModels
                ? (modelIds) => onReorderProviderModels(dedicatedProvider.providerId, modelIds)
                : undefined
            }
            onTestModel={onTestModel}
            nameEditable={false}
            statusSection={planStatusCard}
            headerActionsVisible={false}
          />
        </ProviderFamilyDetailShell>
      );
    }
    return (
      <ProviderFamilyDetailShell header={planStatusHeader}>
        <div className="space-y-3">
          {planStatusCard}
          {planNavItem.provider && planNavItem.provider.providerId === planNavItem.presetId ? null : (
            <ModelProviderLoadingCard loadingLabel={loadingLabel} />
          )}
        </div>
      </ProviderFamilyDetailShell>
    );
  }

  if (selectedNavItem.type === "codingPlanLoading") {
    // Z.AI plan 判定占位只属于左侧导航，不应进入详情表单渲染路径。
    return null;
  }

  if (!selectedNavItem.provider) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  const customProvider = selectedNavItem.provider;
  const customApiKeyUrl = customProvider.templateId
    ? getProviderFormApiKeyManagementUrl(customProvider)
    : undefined;
  return (
    // 仅展示预设模板声明的入口，不根据地址猜测自定义 Provider 的 Key 控制台。
    <InlineEditableProviderCard
      provider={customProvider}
      onSave={onSave}
      {...modelEditingProps}
      onDelete={() => onDelete(customProvider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(customProvider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      presetApiKeyUrl={customApiKeyUrl}
      readOnlyEndpoints={false}
      nameEditable
      onOpenPresetApiKey={
        customApiKeyUrl
          ? () => {
              onOpenApiKeyUrl(customApiKeyUrl);
            }
          : undefined
      }
    />
  );
}

function CodingPlanAccessBanner({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-ui-base font-medium text-foreground">{title}</div>
      <p className="mt-1 text-ui-sm leading-6 text-foreground-subtle">{description}</p>
    </div>
  );
}

function resolveCodingPlanAccessBanner(
  status: CodingPlanStatus,
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  reloginOnFailure = false,
): { title: string; description: string } | null {
  if (
    status !== "disconnected" &&
    status !== "notPurchased" &&
    !(status === "unavailable" && reloginOnFailure)
  ) {
    return null;
  }
  return {
    title: intl.formatMessage({
      id: `settings.modelProvider.codingPlan.status.${status}`,
    }),
    description: intl.formatMessage({
      id:
        status === "unavailable" && reloginOnFailure
          ? "settings.modelProvider.codingPlan.description.credentialFailed"
          : `settings.modelProvider.codingPlan.description.${status}`,
    }),
  };
}
