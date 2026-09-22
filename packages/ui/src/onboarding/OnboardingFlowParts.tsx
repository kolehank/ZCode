import { CheckIcon, FolderOpenIcon, KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export { OnboardingWelcomeView } from "@/onboarding/OnboardingWelcomeView.js";

/** 步骤一：选择/打开 workspace。展示当前 workspace，并可打开其他项目文件夹。 */
export function OnboardingWorkspaceStep(props: {
  workspacePath: string | null | undefined;
  canOpenWorkspace: boolean;
  onOpenWorkspace: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex h-full min-h-0 flex-col justify-center">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-border bg-card px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-alt">
            <FolderOpenIcon className="size-5 text-foreground-subtle" />
          </div>
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "onboarding.workspace.current" })}
            </div>
            <div className="mt-0.5 min-w-0 truncate text-ui-base text-foreground-subtle">
              {props.workspacePath
                ? props.workspacePath
                : intl.formatMessage({ id: "onboarding.workspace.pending" })}
            </div>
          </div>
        </div>
        {props.canOpenWorkspace ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={props.onOpenWorkspace}
          >
            {intl.formatMessage({ id: "onboarding.workspace.openOther" })}
          </Button>
        ) : null}
        <p className="text-ui-sm leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "onboarding.workspace.helper" })}
        </p>
      </div>
    </div>
  );
}

/**
 * 步骤二：BYOK Provider 配置引导。只做跳转引导，不复制表单——
 * API Key 表单统一收敛在设置页模型 Provider 区（ModelProviderSection）。
 */
export function OnboardingProviderStep(props: { onOpenProviderSettings: () => void }) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex h-full min-h-0 flex-col justify-center">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-border bg-card px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-alt">
            <KeyRoundIcon className="size-5 text-foreground-subtle" />
          </div>
          <div className="min-w-0 text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "onboarding.provider.title" })}
          </div>
        </div>
        <p className="text-ui-sm leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "onboarding.provider.body" })}
        </p>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={props.onOpenProviderSettings}
        >
          {intl.formatMessage({ id: "onboarding.provider.openSettings" })}
        </Button>
      </div>
    </div>
  );
}

/** 步骤三：完成。完成按钮落“引导已完成”标记并关闭引导。 */
export function OnboardingFinishStep() {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckIcon className="size-7" />
      </div>
      <div className="text-2xl font-medium text-foreground">
        {intl.formatMessage({ id: "onboarding.finish.done" })}
      </div>
      <div className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "onboarding.finish.ready" })}
      </div>
    </div>
  );
}
