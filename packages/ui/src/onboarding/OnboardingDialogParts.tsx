import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export type OnboardingView = "welcome" | "wizard";

/**
 * BYOK 首次运行动线：选择 workspace → 配置 BYOK Provider（API Key）→ 完成。
 * 厂商登录步骤与产品调研问卷已下线，动线中不存在任何
 * 需要厂商云端确认的步骤；旧迁移向导（会话/Skills/MCP/命令导入）保留在设置页。
 */
export type OnboardingWizardStep = "workspace" | "provider" | "finish";

const WIZARD_STEPS: Array<{
  key: OnboardingWizardStep;
  index: number;
  titleId: string;
}> = [
  { key: "workspace", index: 1, titleId: "onboarding.step.workspace" },
  { key: "provider", index: 2, titleId: "onboarding.step.provider" },
  { key: "finish", index: 3, titleId: "onboarding.step.finish" },
];

export function getOnboardingStepMessageKey(step: OnboardingWizardStep): string {
  switch (step) {
    case "workspace":
      return "workspace";
    case "provider":
      return "provider";
    case "finish":
      return "finish";
  }
}

export function OnboardingWizardSidebar(props: { currentStep: OnboardingWizardStep }) {
  const { intl } = useZCodeIntl();
  const currentIndex = WIZARD_STEPS.findIndex((step) => step.key === props.currentStep);

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-2 p-1 md:flex">
      <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="text-ui-base font-medium uppercase tracking-wide text-foreground-subtle">
          {intl.formatMessage({ id: "onboarding.wizard.label" })}
        </div>
        <div className="space-y-2">
          {WIZARD_STEPS.map((step, index) => {
            const isCurrent = step.key === props.currentStep;
            const isCompleted = index < currentIndex;

            return (
              <div
                key={step.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border-0 px-3 py-3 transition-colors",
                  isCurrent
                    ? "border-border-hover bg-card"
                    : isCompleted
                      ? "border-transparent bg-background-alt"
                      : "border-transparent bg-transparent",
                )}
              >
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-ui-base font-mono font-semibold",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "border-success bg-success text-success-foreground"
                        : "border-border bg-background text-foreground-subtle",
                  )}
                >
                  {isCompleted ? <CheckIcon className="size-4" /> : index + 1}
                </div>
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-ui-base font-medium",
                      isCurrent || isCompleted ? "text-foreground" : "text-foreground-subtle",
                    )}
                  >
                    {intl.formatMessage({ id: step.titleId })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function OnboardingWizardHeader(props: { title: string; description: string }) {
  return (
    <div className="space-y-2">
      <div className="text-lg font-medium text-foreground">{props.title}</div>
      {props.description.trim().length > 0 ? (
        <div className="text-ui-base leading-6 text-foreground-subtle">{props.description}</div>
      ) : null}
    </div>
  );
}

export function OnboardingWizardFooter(props: {
  currentStep: OnboardingWizardStep;
  onBackToWelcome: () => void;
  onBackStep: () => void;
  onNextStep: () => void;
  onFinish: () => void;
}) {
  const { intl } = useZCodeIntl();
  const isFinish = props.currentStep === "finish";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        {props.currentStep === "workspace" ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-10 min-w-0 px-5"
            onClick={props.onBackToWelcome}
          >
            {intl.formatMessage({ id: "common.back" })}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-10 min-w-0 px-5"
            onClick={props.onBackStep}
          >
            {intl.formatMessage({ id: "common.back" })}
          </Button>
        )}
        {isFinish ? (
          <Button type="button" size="lg" className="h-10 min-w-0 px-5" onClick={props.onFinish}>
            {intl.formatMessage({ id: "onboarding.action.finish" })}
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-10 min-w-0 px-5" onClick={props.onNextStep}>
            {intl.formatMessage({ id: "onboarding.action.continue" })}
          </Button>
        )}
      </div>
    </div>
  );
}
