import type { CSSProperties } from "react";
import { Alert, App, Button, Input, Select, Switch } from "antd";
import {
  Activity,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CustomMcpTransport } from "../../../api/modules/connectors";
import {
  accentForServerName,
  friendlyServerLabel,
  type ServerCardState,
} from "./customMcpUtils";
import styles from "./index.module.less";

interface CustomMcpServerCardProps {
  card: ServerCardState;
  probing: boolean;
  authorizing?: boolean;
  oauthAvailable?: boolean;
  probeTools?: { name: string; description: string }[];
  transportOptions: { value: string; label: string }[];
  onUpdate: (key: string, patch: Partial<ServerCardState>) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRemove: () => void | Promise<void>;
  onProbe: () => void;
  onAuthorize?: () => void;
  onDefaultOpenChange?: (defaultOpen: boolean) => void;
  onSharedChange?: (shared: boolean) => void;
}

export function CustomMcpServerCard({
  card,
  probing,
  authorizing = false,
  oauthAvailable = false,
  probeTools,
  transportOptions,
  onUpdate,
  onToggleEnabled,
  onRemove,
  onProbe,
  onAuthorize,
  onDefaultOpenChange,
  onSharedChange,
}: CustomMcpServerCardProps) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const isHttp = card.transport === "streamable_http";
  const label = friendlyServerLabel(card);
  const accent = accentForServerName(card.name.trim() || label);
  const summary = isHttp
    ? card.url.trim() || "https://…"
    : [
        card.command.trim(),
        ...card.argsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      ]
        .filter(Boolean)
        .join(" ") || "npx / uvx / python";

  const handleRemove = () => {
    modal.confirm({
      title: t("connectors.customMcp.deleteConfirm", {
        name: label,
        defaultValue: `Confirm deletion MCP Server “${label}”?`,
      }),
      content: t(
        "connectors.customMcp.deleteConfirmHint",
        "Saved servers will be deleted immediately; unsaved configurations will only be removed from the current edit.",
      ),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () => Promise.resolve(onRemove()),
    });
  };

  const authPending = isHttp && oauthAvailable && !card.oauthConfigured;
  const effectiveEnabled = !authPending && card.enabled;
  const showOAuthConnectLink =
    isHttp && card.collapsed && authPending && onAuthorize;
  const connectLabel = t("connectors.clickToConnect", "Click to connect");

  const handleConnectClick = () => {
    if (oauthAvailable && onAuthorize) {
      onAuthorize();
    }
  };

  return (
    <div
      className={`${styles.customMcpServerCard}${
        card.collapsed ? "" : ` ${styles.customMcpServerCardOpen}`
      }${
        card.enabled && !authPending
          ? ""
          : ` ${styles.customMcpServerCardDisabled}`
      }`}
      style={
        {
          "--mcp-accent": accent,
        } as CSSProperties
      }
    >
      <div className={styles.customMcpServerTop}>
        <div className={styles.customMcpServerIdentity}>
          <span className={styles.customMcpServerIcon}>
            <Cable size={22} aria-hidden />
          </span>
          <div className={styles.customMcpServerMeta}>
            <span className={styles.customMcpServerName} title={label}>
              {label}
            </span>
            <span
              className={`${styles.customMcpTransportBadge} ${
                isHttp
                  ? styles.customMcpTransportHttp
                  : styles.customMcpTransportStdio
              }`}
            >
              {isHttp
                ? t("connectors.customMcp.transportHttp", "HTTP")
                : t("connectors.customMcp.transportStdio", "Stdio")}
            </span>
            <div className={styles.customMcpServerSummary} title={summary}>
              {card.displayName.trim() && card.name.trim()
                ? `${card.name.trim()} · ${summary}`
                : summary}
            </div>
          </div>
        </div>
        <div className={styles.customMcpServerControls}>
          <div className={styles.customMcpEnableControl}>
            <span className={styles.customMcpEnableLabel}>
              {t("connectors.customMcp.enable", "Enable connector")}
            </span>
            <Switch
              checked={authPending ? false : card.enabled}
              disabled={authPending}
              onChange={onToggleEnabled}
              size="small"
            />
          </div>
          <Button
            type="text"
            size="small"
            icon={
              card.collapsed ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronUp size={16} />
              )
            }
            onClick={() => onUpdate(card.key, { collapsed: !card.collapsed })}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<Trash2 size={16} />}
            onClick={handleRemove}
          />
        </div>
      </div>

      {showOAuthConnectLink ? (
        <div className={styles.customMcpCardFooter}>
          <button
            type="button"
            className={styles.customMcpConnectLink}
            onClick={handleConnectClick}
            disabled={authorizing}
          >
            {authorizing
              ? t("connectors.customMcp.authorizing", "Authorizing…")
              : connectLabel}
          </button>
        </div>
      ) : null}

      {!card.collapsed ? (
        <div className={styles.customMcpCardBody}>
          <div className={styles.customMcpField}>
            <label>{t("connectors.customMcp.displayName", "Display name")}</label>
            <Input
              value={card.displayName}
              onChange={(e) =>
                onUpdate(card.key, { displayName: e.target.value })
              }
              placeholder={t(
                "connectors.customMcp.displayNamePlaceholder",
                "For example: My knowledge base",
              )}
              maxLength={64}
            />
            <div className={styles.customMcpFieldHint}>
              {t(
                "connectors.customMcp.displayNameHint",
                "The name shown in the dialog connector selection, can be used in Chinese.",
              )}
            </div>
          </div>
          <div className={styles.customMcpField}>
            <label>
              {t("connectors.customMcp.serverId", "Server ID")}{" "}
              <span className={styles.requiredMark}>*</span>
            </label>
            <Input
              value={card.name}
              onChange={(e) => onUpdate(card.key, { name: e.target.value })}
              placeholder={isHttp ? "http-server" : "stdio-server"}
            />
            <div className={styles.customMcpFieldHint}>
              {t(
                "connectors.customMcp.serverIdHint",
                "Technical identification, only supports letters, numbers, underscores and hyphens.",
              )}
            </div>
          </div>
          <div className={styles.customMcpField}>
            <label>Transport</label>
            <Select
              value={card.transport}
              options={transportOptions}
              onChange={(value: CustomMcpTransport) =>
                onUpdate(card.key, { transport: value })
              }
              style={{ width: "100%" }}
            />
          </div>

          {isHttp ? (
            <>
              <div className={styles.customMcpField}>
                <label>
                  URL <span className={styles.requiredMark}>*</span>
                </label>
                <Input
                  value={card.url}
                  onChange={(e) => onUpdate(card.key, { url: e.target.value })}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
              <div className={styles.customMcpField}>
                <label>
                  {t(
                    "connectors.customMcp.headers",
                    "Headers(per line Key: Value, optional Bearer)",
                  )}
                </label>
                <Input.TextArea
                  value={card.headersText}
                  onChange={(e) =>
                    onUpdate(card.key, { headersText: e.target.value })
                  }
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder={"Authorization: Bearer sk-..."}
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.customMcpField}>
                <label>
                  Command <span className={styles.requiredMark}>*</span>
                </label>
                <Input
                  value={card.command}
                  onChange={(e) =>
                    onUpdate(card.key, { command: e.target.value })
                  }
                  placeholder="npx / uvx / python"
                />
              </div>
              <div className={styles.customMcpField}>
                <label>
                  {t("connectors.customMcp.args", "Args (one argument per line)")}
                </label>
                <Input.TextArea
                  value={card.argsText}
                  onChange={(e) =>
                    onUpdate(card.key, { argsText: e.target.value })
                  }
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder={"-y\nsome-mcp-package"}
                />
              </div>
              <div className={styles.customMcpField}>
                <label>
                  {t("connectors.customMcp.env", "Env (one KEY=VALUE per line)")}
                </label>
                <Input.TextArea
                  value={card.envText}
                  onChange={(e) =>
                    onUpdate(card.key, { envText: e.target.value })
                  }
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder={"API_KEY=..."}
                />
              </div>
            </>
          )}

          <div className={styles.customMcpField}>
            <label>{t("connectors.shared", "Share with others")}</label>
            <div className={styles.customMcpDefaultOpenRow}>
              <Switch
                checked={card.shared}
                onChange={(checked) => {
                  if (onSharedChange) {
                    onSharedChange(checked);
                    return;
                  }
                  onUpdate(card.key, { shared: checked });
                }}
              />
              <span className={styles.customMcpFieldHint}>
                {t(
                  "connectors.sharedHint",
                  "After sharing, other users can choose to use it, but they cannot view or modify the configuration.",
                )}
              </span>
            </div>
          </div>

          <div className={styles.customMcpField}>
            <label>{t("connectors.defaultEnabled", "Enable by default")}</label>
            <div className={styles.customMcpDefaultOpenRow}>
              <Switch
                checked={card.defaultOpen}
                disabled={!effectiveEnabled}
                onChange={(checked) => {
                  if (onDefaultOpenChange) {
                    onDefaultOpenChange(checked);
                    return;
                  }
                  onUpdate(card.key, { defaultOpen: checked });
                }}
              />
              {!effectiveEnabled ? (
                <span className={styles.customMcpFieldHint}>
                  {t(
                    "connectors.customMcp.defaultOpenRequiresEnable",
                    "The connector needs to be enabled first.",
                  )}
                </span>
              ) : !card.defaultOpen ? (
                <span className={styles.customMcpFieldHint}>
                  {t(
                    "connectors.customMcp.defaultOpenHint",
                    "After turning it on, your Dashboard,IM With Cron(When the connector is not manually selected) this will be included by default MCP.",
                  )}
                </span>
              ) : null}
            </div>
            {effectiveEnabled && card.defaultOpen ? (
              <Alert
                type="warning"
                showIcon
                message={t(
                  "connectors.defaultOpenWarning",
                  "After turning it on, it will be in your Dashboard,IM With Cron(When no connector is specially selected) Carrying this tool (extra cost token).Dashboard Can close the epicycle;Cron If a connector is selected explicitly, the selection takes precedence.",
                )}
              />
            ) : null}
          </div>

          {isHttp && card.oauthConfigured ? (
            <Alert
              type="success"
              showIcon
              message={t(
                "connectors.customMcp.oauthConfigured",
                "Completed OAuth Authorize",
              )}
            />
          ) : null}

          {isHttp && oauthAvailable && !card.oauthConfigured ? (
            <Alert
              type="warning"
              showIcon
              message={t(
                "connectors.customMcp.probeNeedsOAuth",
                "This MCP Need OAuth Only authorized to access",
              )}
              description={t(
                "connectors.customMcp.oauthAuthorizeHint",
                "Click “One-click authorization” to complete the login; after completion, we will automatically verify the connection again.",
              )}
              action={
                onAuthorize ? (
                  <Button
                    size="small"
                    type="primary"
                    loading={authorizing}
                    onClick={onAuthorize}
                  >
                    {t("connectors.oneClickOAuth", "Authorize")}
                  </Button>
                ) : undefined
              }
            />
          ) : null}

          {isHttp ? (
            <div className={styles.customMcpCardActions}>
              <Button
                icon={<Activity size={14} />}
                loading={probing}
                onClick={onProbe}
              >
                {t("connectors.probe", "Probe")}
              </Button>
            </div>
          ) : null}

          {isHttp && probeTools !== undefined ? (
            <div className={styles.probeResult}>
              <div className={styles.probeResultHeader}>
                <CheckCircle2
                  size={18}
                  className={styles.probeResultIcon}
                  aria-hidden
                />
                <div className={styles.probeResultMeta}>
                  <div className={styles.probeResultTitle}>
                    {t("connectors.probeToolsTitle", "Probe succeeded")}
                  </div>
                  <div className={styles.probeResultSubtitle}>
                    {probeTools.length > 0
                      ? t("connectors.probeToolsHint", {
                          count: probeTools.length,
                          defaultValue: `The connection is normal and the following tool list is obtained (total ${probeTools.length} )`,
                        })
                      : t(
                          "connectors.probeToolsEmpty",
                          "The connection is OK, but no available tools found",
                        )}
                  </div>
                </div>
              </div>
              {probeTools.length > 0 ? (
                <ul className={styles.probeToolList}>
                  {probeTools.map((tool, index) => (
                    <li key={tool.name} className={styles.probeToolItem}>
                      <span className={styles.probeToolIndex}>{index + 1}</span>
                      <div className={styles.probeToolBody}>
                        <div className={styles.probeToolName}>{tool.name}</div>
                        {tool.description ? (
                          <div className={styles.probeToolDesc}>
                            {tool.description}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
