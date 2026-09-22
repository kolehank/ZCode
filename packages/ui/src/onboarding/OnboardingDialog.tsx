import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { logger } from "@/logger.js";
import {
  getOnboardingStepMessageKey,
  OnboardingWizardFooter,
  OnboardingWizardHeader,
  OnboardingWizardSidebar,
  type OnboardingView,
  type OnboardingWizardStep,
} from "@/onboarding/OnboardingDialogParts.js";
import {
  OnboardingFinishStep,
  OnboardingProviderStep,
  OnboardingWelcomeView,
  OnboardingWorkspaceStep,
} from "@/onboarding/OnboardingFlowParts.js";
import { useOnboardingTrigger } from "@/onboarding/useOnboardingTrigger.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

const ONBOARDING_STEP_ORDER: OnboardingWizardStep[] = ["workspace", "provider", "finish"];

/**
 * 首次运行引导弹窗（BYOK 动线）：欢迎 → 选择/打开 workspace → Provider 配置引导 → 完成。
 *
 * 与旧实现的差异：
 * - 旧全屏职业问卷已下线，引导收敛为单一弹窗，不再阻塞主界面渲染；
 * - 触发判定（useOnboardingTrigger）改为纯 settings 读取，完成标记沿用
 *   settings.onboardingOccupation 字段；
 * - Provider 步骤只做跳转引导，API Key 表单统一在设置页模型 Provider 区维护。
 */
export function OnboardingDialog(props: {
  workspacePath?: string;
  workspaceIdentity?: string;
  isDesktop?: boolean;
  /** 与 Root 的打开 workspace 动作共用一条入口（系统目录选择/内建目录浏览器）。 */
  allowOpenWorkspace?: boolean;
  onOpenWorkspace?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const requested = useZCodeStore((state) => state.newUserOnboardingOpen);
  const setRequested = useZCodeStore((state) => state.setNewUserOnboardingOpen);
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const needsOnboarding = useOnboardingTrigger({ settings });
  const [view, setView] = useState<OnboardingView>("welcome");
  const [wizardStep, setWizardStep] = useState<OnboardingWizardStep>("workspace");
  // 首次运行自动打开（判定完成即置位）；手动打开（设置页/快捷键）走 store.requested。
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    if (needsOnboarding === true) {
      setAutoOpen(true);
    }
  }, [needsOnboarding]);

  const dialogOpen = requested || autoOpen;

  const closeDialog = useCallback(() => {
    // 中途关闭（Esc/关闭按钮/去选文件夹/去配置 Key）不落完成标记：
    // 未走完动线的用户下次启动仍会触发引导，与旧问卷“Esc 不算作答”的语义一致。
    setRequested(false);
    setAutoOpen(false);
    setView("welcome");
    setWizardStep("workspace");
  }, [setRequested]);

  /**
   * 完成引导：写入完成标记。问卷下线后 onboardingOccupation 只表达“引导已完成”，
   * 取值沿用旧“跳过”路径写入的默认值 other；写入失败仅告警，不阻塞关闭——
   * 记录失败只会让下次启动重复引导一次，不应把用户拦在引导页上。
   */
  const completeOnboarding = useCallback(() => {
    void update({ onboardingOccupation: "other" })
      .then(() => {
        logger.info("[onboarding] 引导完成标记已写入", {
          workspacePath: props.workspacePath ?? null,
          workspaceIdentity: props.workspaceIdentity ?? null,
        });
      })
      .catch((cause: unknown) => {
        logger.warn("[onboarding] 写入引导完成标记失败", { error: String(cause) });
      });
    closeDialog();
  }, [closeDialog, props.workspaceIdentity, props.workspacePath, update]);

  /**
   * 打开设置页模型 Provider 区：引导是模态弹窗，不收起就看不到设置 tab。
   * 用户已显式进入配置路径，重复引导只会打断，因此这里同时落完成标记；
   * 之后若仍未配置任何 provider，会话页顶部的 model_config_missing 横幅会继续兜底引导。
   */
  const handleOpenProviderSettings = useCallback(() => {
    setPendingSettingsSectionIntent("modelProvider");
    openSettingsTab();
    completeOnboarding();
  }, [completeOnboarding, openSettingsTab]);

  const goToNextWizardStep = useCallback(() => {
    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(wizardStep);
    const nextStep = ONBOARDING_STEP_ORDER[currentIndex + 1];
    if (nextStep) {
      setWizardStep(nextStep);
    }
  }, [wizardStep]);

  const goToPreviousWizardStep = useCallback(() => {
    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(wizardStep);
    if (currentIndex <= 0) {
      setView("welcome");
      return;
    }
    setWizardStep(ONBOARDING_STEP_ORDER[currentIndex - 1] ?? "workspace");
  }, [wizardStep]);

  const stepMessageKey = getOnboardingStepMessageKey(wizardStep);
  const dialogTitle =
    view === "welcome"
      ? intl.formatMessage({ id: "onboarding.dialog.title" })
      : intl.formatMessage({ id: `onboarding.step.${stepMessageKey}` });
  const dialogDescription =
    view === "welcome"
      ? intl.formatMessage({ id: "onboarding.dialog.description" })
      : intl.formatMessage({ id: `onboarding.stepDescription.${stepMessageKey}` });

  const renderWizardBody = () => {
    switch (wizardStep) {
      case "workspace":
        return (
          <OnboardingWorkspaceStep
            workspacePath={props.workspacePath ?? null}
            canOpenWorkspace={Boolean(props.allowOpenWorkspace && props.onOpenWorkspace)}
            onOpenWorkspace={() => props.onOpenWorkspace?.()}
          />
        );
      case "provider":
        return <OnboardingProviderStep onOpenProviderSettings={handleOpenProviderSettings} />;
      case "finish":
        return <OnboardingFinishStep />;
    }
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog();
        }
      }}
    >
      <DialogContent
        className="h-[calc(100vh-6rem)] max-w-4xl max-h-168 overflow-hidden rounded-2xl p-0"
        showCloseButton
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">{dialogDescription}</DialogDescription>

        {view === "welcome" ? (
          <OnboardingWelcomeView
            onStart={() => {
              setView("wizard");
              setWizardStep("workspace");
            }}
            onSkip={completeOnboarding}
          />
        ) : (
          <div className="flex h-full min-h-0 min-w-0">
            <OnboardingWizardSidebar currentStep={wizardStep} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-hidden p-6">
              <OnboardingWizardHeader title={dialogTitle} description={dialogDescription} />
              <div className="min-h-0 flex-1">{renderWizardBody()}</div>
              <OnboardingWizardFooter
                currentStep={wizardStep}
                onBackToWelcome={() => setView("welcome")}
                onBackStep={goToPreviousWizardStep}
                onNextStep={goToNextWizardStep}
                onFinish={completeOnboarding}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
