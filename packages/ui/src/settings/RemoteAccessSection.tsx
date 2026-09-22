/* BYOK P3：设置页「远程访问」区块。三档鉴权切换、外部基址双模式、token 一次性展示 + QR。 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { fetchWithWebAccessToken } from "@/lib/webAccessToken.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { RemoteAccessTokenReveal } from "@/settings/RemoteAccessTokenReveal.js";

type WebAccessMode = "open" | "cloudflare-access" | "token";

interface WebAccessConfigView {
  mode: WebAccessMode;
  tokenPrefix: string;
  hasToken: boolean;
  cfTeamDomain: string;
  cfAud: string;
  cfAllowedEmails: string[];
  externalBaseUrl: string;
  port: number;
}

interface WebAccessInterfaceItem {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
  isTailscale: boolean;
  suggested: boolean;
}

interface WebAccessSaveResponse extends WebAccessConfigView {
  token?: string;
  accessUrl?: string | null;
}

function buildInterfaceUrl(item: WebAccessInterfaceItem, port: number): string {
  const host = item.family === "IPv6" ? `[${item.address}]` : item.address;
  return `http://${host}:${port}`;
}

function formatInterfaceLabel(
  item: WebAccessInterfaceItem,
  port: number,
  formatMessage: (id: string) => string,
): string {
  const suffix = item.isTailscale
    ? ` · Tailscale`
    : item.suggested
      ? ` · ${formatMessage("settings.remoteAccess.interface.suggested")}`
      : "";
  return `${item.name} — ${item.address}${suffix}`;
}

export function RemoteAccessSection({ isDesktop }: { isDesktop: boolean }) {
  const { intl } = useZCodeIntl();
  const formatMessage = useCallback(
    (id: string) => intl.formatMessage({ id }),
    [intl],
  );

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<WebAccessMode>("open");
  const [cfTeamDomain, setCfTeamDomain] = useState("");
  const [cfAud, setCfAud] = useState("");
  const [cfAllowedEmails, setCfAllowedEmails] = useState("");
  const [tokenPrefix, setTokenPrefix] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [externalBaseUrl, setExternalBaseUrl] = useState("");
  const [interfaces, setInterfaces] = useState<WebAccessInterfaceItem[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [port, setPort] = useState(0);
  const [saving, setSaving] = useState(false);
  const [oneTimeToken, setOneTimeToken] = useState<{ token: string; accessUrl?: string } | null>(
    null,
  );

  useEffect(() => {
    if (isDesktop) {
      return;
    }
    let cancelled = false;
    // 只在打开设置页时各调用一次（本组件挂载即打开状态）。
    void (async () => {
      try {
        const [configResponse, interfacesResponse] = await Promise.all([
          fetchWithWebAccessToken("/api/web-access/config", { cache: "no-store" }),
          fetchWithWebAccessToken("/api/web-access/interfaces", { cache: "no-store" }),
        ]);
        if (!configResponse.ok || !interfacesResponse.ok) {
          throw new Error(`HTTP ${configResponse.status}/${interfacesResponse.status}`);
        }
        const config = (await configResponse.json()) as WebAccessConfigView;
        const interfacesPayload = (await interfacesResponse.json()) as {
          interfaces: WebAccessInterfaceItem[];
          port: number;
        };
        if (cancelled) {
          return;
        }
        setMode(config.mode);
        setCfTeamDomain(config.cfTeamDomain);
        setCfAud(config.cfAud);
        setCfAllowedEmails(config.cfAllowedEmails.join(", "));
        setTokenPrefix(config.tokenPrefix);
        setHasToken(config.hasToken);
        setExternalBaseUrl(config.externalBaseUrl);
        setPort(interfacesPayload.port || config.port);
        setInterfaces(interfacesPayload.interfaces ?? []);
        // 默认选中建议网卡（tailscale / 私网优先，server 侧已标注 suggested）。
        const suggested =
          interfacesPayload.interfaces?.find((item) => item.suggested) ??
          interfacesPayload.interfaces?.[0] ??
          null;
        setSelectedAddress(suggested?.address ?? "");
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const save = useCallback(
    async (options: { regenerate: boolean }) => {
      if (mode === "cloudflare-access" && (!cfTeamDomain.trim() || !cfAud.trim())) {
        toast(formatMessage("settings.remoteAccess.cf.requiredError"));
        return;
      }
      setSaving(true);
      try {
        const response = await fetchWithWebAccessToken("/api/web-access/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            cfTeamDomain: cfTeamDomain.trim(),
            cfAud: cfAud.trim(),
            cfAllowedEmails: cfAllowedEmails
              .split(/[,;\n]/)
              .map((email) => email.trim())
              .filter(Boolean),
            externalBaseUrl: externalBaseUrl.trim(),
            regenerate: options.regenerate,
          }),
        });
        const payload = (await response.json()) as WebAccessSaveResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        setTokenPrefix(payload.tokenPrefix);
        setHasToken(payload.hasToken);
        if (payload.token) {
          // 明文只在生成响应里出现一次；组件卸载后 UI 不再持有。
          setOneTimeToken({
            token: payload.token,
            ...(payload.accessUrl ? { accessUrl: payload.accessUrl } : {}),
          });
        }
        toast(formatMessage("settings.remoteAccess.savedToast"));
      } catch (error) {
        logger.error("[remoteAccess] 保存远程访问配置失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        toast(formatMessage("settings.remoteAccess.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [cfAud, cfTeamDomain, cfAllowedEmails, externalBaseUrl, formatMessage, mode],
  );

  if (isDesktop) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-ui-base text-foreground-subtle">
        {formatMessage("settings.remoteAccess.webServerOnly")}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-ui-base text-foreground-subtle">
        {formatMessage("settings.remoteAccess.loadFailed")}（{loadError}）
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-ui-base text-foreground-subtle">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {formatMessage("settings.remoteAccess.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SettingsGroupCard>
          <SettingsRow
            label={formatMessage("settings.remoteAccess.mode.label")}
            description={formatMessage("settings.remoteAccess.mode.description")}
            control={
              <Select value={mode} onValueChange={(next) => setMode(next as WebAccessMode)}>
                <SelectTrigger size="lg" className="w-64 min-w-0 justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">
                    {formatMessage("settings.remoteAccess.mode.open")}
                  </SelectItem>
                  <SelectItem value="cloudflare-access">
                    {formatMessage("settings.remoteAccess.mode.cloudflareAccess")}
                  </SelectItem>
                  <SelectItem value="token">
                    {formatMessage("settings.remoteAccess.mode.token")}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {mode === "cloudflare-access" ? (
            <>
              <SettingsRow
                label={formatMessage("settings.remoteAccess.cf.teamDomain")}
                control={
                  <Input
                    className="w-64"
                    value={cfTeamDomain}
                    placeholder="example.cloudflareaccess.com"
                    onChange={(event) => setCfTeamDomain(event.target.value)}
                  />
                }
              />
              <SettingsRow
                label={formatMessage("settings.remoteAccess.cf.aud")}
                control={
                  <Input
                    className="w-64"
                    value={cfAud}
                    onChange={(event) => setCfAud(event.target.value)}
                  />
                }
              />
              <SettingsRow
                label={formatMessage("settings.remoteAccess.cf.emails")}
                description={formatMessage("settings.remoteAccess.cf.emailsDescription")}
                controlLayout="wide"
                control={
                  <Input
                    value={cfAllowedEmails}
                    placeholder="a@example.com, b@example.com"
                    onChange={(event) => setCfAllowedEmails(event.target.value)}
                  />
                }
              />
            </>
          ) : null}
          {mode === "token" ? (
            <SettingsRow
              label={formatMessage("settings.remoteAccess.token.title")}
              description={
                hasToken
                  ? `${formatMessage("settings.remoteAccess.token.prefix")}: ${tokenPrefix || "—"}`
                  : formatMessage("settings.remoteAccess.token.none")
              }
              control={
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="min-w-24"
                  disabled={saving}
                  onClick={() => void save({ regenerate: true })}
                >
                  {formatMessage(
                    hasToken
                      ? "settings.remoteAccess.token.regenerate"
                      : "settings.remoteAccess.token.generate",
                  )}
                </Button>
              }
            />
          ) : null}
        </SettingsGroupCard>
      </section>

      <section className="space-y-3">
        <div className="text-ui-base font-medium text-foreground-subtle">
          {formatMessage("settings.remoteAccess.baseUrl.section")}
        </div>
        <SettingsGroupCard>
          <SettingsRow
            label={formatMessage("settings.remoteAccess.interface.label")}
            description={
              port > 0
                ? `${formatMessage("settings.remoteAccess.port")}: ${port}`
                : undefined
            }
            control={
              <Select
                value={selectedAddress}
                onValueChange={(address) => {
                  const item = interfaces.find((candidate) => candidate.address === address);
                  setSelectedAddress(address);
                  if (item && port > 0) {
                    // 建议值回显到下方输入框，保持「可见可编辑」，不静默生效。
                    setExternalBaseUrl(buildInterfaceUrl(item, port));
                  }
                }}
              >
                <SelectTrigger size="lg" className="w-64 min-w-0 justify-between">
                  <SelectValue placeholder={formatMessage("settings.remoteAccess.interface.pick")} />
                </SelectTrigger>
                <SelectContent>
                  {interfaces.length === 0 ? (
                    <SelectItem value="none" disabled>
                      {formatMessage("settings.remoteAccess.interface.empty")}
                    </SelectItem>
                  ) : (
                    interfaces.map((item) => (
                      <SelectItem key={`${item.name}:${item.address}`} value={item.address}>
                        {formatInterfaceLabel(item, port, formatMessage)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label={formatMessage("settings.remoteAccess.baseUrl.label")}
            description={formatMessage("settings.remoteAccess.baseUrl.description")}
            controlLayout="wide"
            control={
              <Input
                value={externalBaseUrl}
                placeholder="https://zcode.example.com"
                onChange={(event) => setExternalBaseUrl(event.target.value)}
              />
            }
          />
          <SettingsRow
            label={formatMessage("settings.remoteAccess.save.title")}
            description={formatMessage("settings.remoteAccess.restartHint")}
            control={
              <Button
                type="button"
                size="lg"
                className="min-w-24"
                disabled={saving}
                onClick={() => void save({ regenerate: false })}
              >
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {formatMessage("settings.remoteAccess.save.action")}
              </Button>
            }
          />
        </SettingsGroupCard>
      </section>

      {oneTimeToken ? (
        <section className="space-y-3">
          <div className="text-ui-base font-medium text-foreground-subtle">
            {formatMessage("settings.remoteAccess.oneTime.section")}
          </div>
          <RemoteAccessTokenReveal
            token={oneTimeToken.token}
            {...(oneTimeToken.accessUrl ? { accessUrl: oneTimeToken.accessUrl } : {})}
          />
        </section>
      ) : null}
    </div>
  );
}
