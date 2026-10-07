import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer, Form, Input, Select, Spin, Switch, Alert } from "antd";
import { message } from "@/utils/antdMessage";

import {
  Activity,
  Blocks,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import PageShell from "../../../layouts/PageShell";
import TabBar, { type TabBarItem } from "../../../components/TabLabel/TabBar";
import StreamSetupGuide from "../../../components/StreamSetupGuide/StreamSetupGuide";
import { OctopEmptyMascot } from "../../../components/EmptyState/OctopEmptyMascot";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { userCan } from "../../../utils/permissions";
import { apiErrorMessage } from "../../../utils/apiError";
import { copyText } from "../../../utils/copyText";
import {
  clearFormDraft,
  loadFormDraft,
  saveFormDraft,
} from "../../../utils/formDraft";
import {
  connectorsApi,
  type ConnectorAuthInfo,
  type ConnectorCatalogEntry,
  type ConnectorCliInstallResult,
  type ConnectorCredentialsPreview,
  type ConnectorInstance,
  type ConnectorInstanceDetail,
} from "../../../api/modules/connectors";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectorInstanceCard } from "./ConnectorInstanceCard";
import { CustomMcpTab } from "./CustomMcpTab";
import {
  INLINE_CREDENTIAL_GUIDE_KINDS,
  HIDE_INLINE_FIELD_GUIDE_KINDS,
  MAIL_PROVIDERS,
  mailProviderById,
} from "./connectorDefs";
import { notifyConnectorsChanged } from "./customMcpUtils";
import {
  extractHttpUrl,
  isDifyMcpServerUrl,
  isGuidedConnector,
} from "./guidedConnectorUtils";
import { oauthCallbackSupported } from "./oauthCallback";
import { useConnectorInstances } from "./useConnectors";
import styles from "./index.module.less";

function buildCredentials(
  entry: ConnectorCatalogEntry,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  if (entry.auth_kind === "personal_token") {
    const token = String(values.token ?? "").trim();
    if (token) credentials.token = token;
  } else if (entry.auth_kind === "oauth2") {
    const access_token = String(values.access_token ?? "").trim();
    if (access_token && access_token !== "__configured__") {
      credentials.access_token = access_token;
    }
    if (values.refresh_token) credentials.refresh_token = values.refresh_token;
    if (values.expires_at) credentials.expires_at = values.expires_at;
    if (values.oauth_client_id)
      credentials.oauth_client_id = values.oauth_client_id;
    if (values.oauth_client_secret)
      credentials.oauth_client_secret = values.oauth_client_secret;
    if (values.openid) credentials.openid = values.openid;
  } else if (entry.auth_kind === "auth_code") {
    const code = String(values.auth_code ?? "").trim();
    if (code) credentials.code = code;
  } else if (entry.auth_kind === "api_key") {
    const api_key = String(values.api_key ?? "").trim();
    if (api_key) credentials.api_key = api_key;
  } else if (entry.auth_kind === "imap_app_password") {
    credentials.email = values.email;
    const password = String(values.password ?? "").trim();
    if (password) credentials.password = password;
    if (values.mail_provider) {
      credentials.mail_provider = values.mail_provider;
    }
    if (values.mail_provider === "custom") {
      if (values.imap_host) credentials.imap_host = values.imap_host;
      if (values.smtp_host) credentials.smtp_host = values.smtp_host;
    }
  } else if (entry.auth_kind === "api_credentials") {
    credentials.app_id = values.app_id;
    credentials.sdk_id = values.sdk_id;
    const secret_key = String(values.secret_key ?? "").trim();
    if (secret_key) credentials.secret_key = secret_key;
  } else if (entry.auth_kind === "custom_fields") {
    for (const field of entry.credential_fields ?? []) {
      const text = String(values[field.key] ?? "").trim();
      if (!text) continue;
      credentials[field.key] =
        field.field_type === "tags"
          ? text
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : text;
    }
  }
  return credentials;
}

function previewToFormValues(
  entry: ConnectorCatalogEntry,
  detail: ConnectorInstanceDetail | null,
): Record<string, unknown> {
  if (!detail) {
    return {
      display_name: entry.name,
      description: entry.description,
      mail_provider: "gmail",
      default_open: false,
      shared: false,
    };
  }
  const preview = detail.credentials_preview ?? {};
  const values: Record<string, unknown> = {
    display_name: detail.display_name || entry.name,
    description: detail.description || entry.description,
    default_open:
      detail.default_open === true || detail.config?.default_open === true,
    shared: detail.shared === true,
  };
  if (preview.email) values.email = preview.email;
  if (preview.mail_provider) values.mail_provider = preview.mail_provider;
  if (preview.imap_host) values.imap_host = preview.imap_host;
  if (preview.smtp_host) values.smtp_host = preview.smtp_host;
  if (preview.bkn) values.bkn = preview.bkn;
  if (preview.knowledge_base_id)
    values.knowledge_base_id = preview.knowledge_base_id;
  if (preview.app_id) values.app_id = preview.app_id;
  if (preview.bot_id) values.bot_id = preview.bot_id;
  if (preview.cli_config_key) values.cli_config_key = preview.cli_config_key;
  if (preview.default_as === "user") values.default_as = "user";
  if (preview.client_id) values.client_id = preview.client_id;
  if (preview.sdk_id) values.sdk_id = preview.sdk_id;
  if (entry.auth_kind === "oauth2" && preview.oauth_configured) {
    values.access_token = "__configured__";
  }
  if (entry.auth_kind === "custom_fields") {
    for (const field of entry.credential_fields ?? []) {
      if (field.secret) continue;
      const value = preview[field.key];
      if (Array.isArray(value)) {
        values[field.key] = value.join(", ");
      } else if (value !== undefined && value !== null) {
        values[field.key] = value;
      }
    }
  }
  return values;
}

function hasFreshCredentialInput(
  entry: ConnectorCatalogEntry,
  values: Record<string, unknown>,
): boolean {
  if (entry.auth_kind === "personal_token") {
    return Boolean(String(values.token ?? "").trim());
  }
  if (entry.auth_kind === "oauth2") {
    const token = String(values.access_token ?? "").trim();
    return Boolean(token && token !== "__configured__");
  }
  if (entry.auth_kind === "auth_code") {
    return Boolean(String(values.auth_code ?? "").trim());
  }
  if (entry.auth_kind === "api_key") {
    return Boolean(String(values.api_key ?? "").trim());
  }
  if (entry.auth_kind === "imap_app_password") {
    return Boolean(String(values.password ?? "").trim());
  }
  if (entry.auth_kind === "api_credentials") {
    return Boolean(String(values.secret_key ?? "").trim());
  }
  if (entry.auth_kind === "custom_fields") {
    return (entry.credential_fields ?? []).some(
      (field) =>
        field.secret && Boolean(String(values[field.key] ?? "").trim()),
    );
  }
  return false;
}

function customCredentialConfigChanged(
  entry: ConnectorCatalogEntry,
  values: Record<string, unknown>,
  preview: ConnectorCredentialsPreview,
): boolean {
  if (entry.auth_kind !== "custom_fields") return false;
  return (entry.credential_fields ?? []).some((field) => {
    if (field.secret) return false;
    const current = String(values[field.key] ?? "").trim();
    const storedValue = preview[field.key];
    const stored = Array.isArray(storedValue)
      ? storedValue.join(", ")
      : String(storedValue ?? "").trim();
    return current !== stored;
  });
}

function openAuthorizeLabel(
  _kind: string,
  t: (key: string, fallback: string) => string,
): string {
  return t("connectors.openTokenPage", "Open auth page");
}

function authCodeGuideLabel(
  _kind: string,
  t: (key: string, fallback: string) => string,
): string {
  return t("connectors.authCodeDoc", "See how to get an authorization code");
}

function secretFieldRules(required: boolean) {
  const trimRule = {
    validator: (_: unknown, value: unknown) => {
      const text = String(value ?? "").trim();
      if (required && !text) {
        return Promise.reject(new Error(""));
      }
      return Promise.resolve();
    },
  };
  return required ? [{ required: true, message: "" }, trimRule] : [trimRule];
}

function configuredExtra(
  preview: ConnectorCredentialsPreview | undefined,
  key: string,
  t: (key: string, fallback: string) => string,
) {
  if (!preview?.[key]) return undefined;
  return t("connectors.secretConfigured", "Configured — leave blank to keep current value");
}

function isHostCliConnector(kind: string): boolean {
  return HOST_CLI_CONNECTOR_KINDS.has(kind);
}

const HOST_CLI_CONNECTOR_KINDS = new Set<string>([]);

function ConnectorConfigDrawer({
  open,
  entry,
  instance,
  onClose,
  onSaved,
}: {
  open: boolean;
  entry: ConnectorCatalogEntry | null;
  instance: ConnectorInstance | null;
  onClose: () => void;
  onSaved: (created?: ConnectorInstance) => void;
}) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const canInstallCli = userCan(user, "connectors");
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [openingAuthorize, setOpeningAuthorize] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [authInfo, setAuthInfo] = useState<ConnectorAuthInfo | null>(null);
  const [instanceDetail, setInstanceDetail] =
    useState<ConnectorInstanceDetail | null>(null);
  const [probeResult, setProbeResult] = useState<
    { name: string; description: string }[] | null
  >(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cliInfo, setCliInfo] = useState<ConnectorCliInstallResult | null>(
    null,
  );
  const [installingCli, setInstallingCli] = useState(false);
  const hasStoredCredentials = Boolean(
    instanceDetail?.has_credentials ?? instance?.has_credentials,
  );
  const mailProvider = Form.useWatch("mail_provider", form) ?? "gmail";
  const defaultOpen = Form.useWatch("default_open", form) === true;
  const selectedMailProvider = mailProviderById(String(mailProvider));
  const draftScope = entry
    ? instance
      ? `connector:${instance.instance_id}`
      : `connector:new:${entry.kind}`
    : "";
  const restoringDraftRef = useRef(false);

  const applyConnectorDraft = useCallback(() => {
    if (!draftScope) return;
    const draft = loadFormDraft(draftScope);
    if (!draft) return;
    restoringDraftRef.current = true;
    form.setFieldsValue(draft);
    restoringDraftRef.current = false;
  }, [draftScope, form]);

  useEffect(() => {
    if (!open || !entry) return;
    setShowManual(false);
    setAuthInfo(null);
    setInstanceDetail(null);
    setProbeResult(null);
    setCliInfo(null);
    form.resetFields();
    form.setFieldsValue({
      display_name: entry.name,
      description: entry.description,
      default_open: false,
      shared: false,
    });

    void connectorsApi
      .authInfo(entry.kind)
      .then(setAuthInfo)
      .catch(() => {
        setAuthInfo({
          authorize_url: entry.quick_auth_url ?? null,
          login_url: entry.login_url ?? null,
          guide_url: entry.guide_url ?? entry.doc_url ?? null,
          manual_url:
            entry.manual_url ?? entry.guide_url ?? entry.doc_url ?? null,
          auth_hint: entry.auth_hint ?? null,
        });
      });

    if (isHostCliConnector(entry.kind)) {
      void connectorsApi
        .cliStatus(entry.kind)
        .then(setCliInfo)
        .catch(() => {
          setCliInfo(null);
        });
    }

    if (instance) {
      setLoadingDetail(true);
      void connectorsApi
        .getInstance(instance.instance_id)
        .then((detail) => {
          setInstanceDetail(detail);
          form.setFieldsValue(previewToFormValues(entry, detail));
          if (detail.credentials_preview?.oauth_configured) {
            setShowManual(false);
          }
          applyConnectorDraft();
        })
        .catch(() => {
          form.setFieldsValue({
            display_name: instance.display_name || entry.name,
            description: instance.description || entry.description,
            default_open: instance.default_open === true,
          });
          applyConnectorDraft();
        })
        .finally(() => setLoadingDetail(false));
    } else {
      applyConnectorDraft();
    }
  }, [open, entry, instance, form, applyConnectorDraft]);

  const openUrl = (url: string | null | undefined) => {
    if (!url) return;
    window.open(url, "octop-connector-auth", "width=720,height=800");
  };

  const handleOpenAuthorize = async () => {
    if (!entry) return;
    setOpeningAuthorize(true);
    try {
      const { authorize_url } = await connectorsApi.authorizeUrl(entry.kind);
      if (!authorize_url) {
        message.error(t("connectors.authUrlMissing", "Authorization page URL unavailable"));
        return;
      }
      openUrl(authorize_url);
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.authUrlFailed", "Failed to open the authorization page"), t),
      );
    } finally {
      setOpeningAuthorize(false);
    }
  };

  const handleOpenLogin = () => {
    openUrl(authInfo?.login_url);
  };

  const handleCopyInstallCommand = async (command: string) => {
    const ok = await copyText(command);
    if (ok) {
      message.success(t("connectors.cliInstallCopied", "Install command copied"));
    } else {
      message.error(
        t("connectors.clipboardDenied", "Cannot read clipboard — paste manually"),
      );
    }
  };

  const handleRefreshCliStatus = async () => {
    if (!entry || !isHostCliConnector(entry.kind)) return;
    try {
      const status = await connectorsApi.cliStatus(entry.kind);
      setCliInfo(status);
      if (status.installed) {
        message.success(
          t("connectors.cliAlreadyInstalled", {
            binary: status.binary,
            defaultValue: `${status.binary} Installed`,
          }),
        );
      }
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(
          e,
          t("connectors.cliInstallFailed", "Host CLI install failed"),
          t,
        ),
      );
    }
  };

  const handleInstallCli = async () => {
    if (!entry || !isHostCliConnector(entry.kind) || installingCli) return;
    if (cliInfo?.installed) {
      await handleRefreshCliStatus();
      return;
    }
    setInstallingCli(true);
    try {
      const result = await connectorsApi.installCli(entry.kind);
      setCliInfo(result);
      if (result.ok) {
        message.success(
          result.already_installed
            ? t("connectors.cliAlreadyInstalled", {
                binary: result.binary,
                defaultValue: `${result.binary} Installed`,
              })
            : t("connectors.cliInstallSuccess", {
                binary: result.binary,
                defaultValue: `${result.binary} Installation successful`,
              }),
        );
      } else {
        message.error(
          result.error ?? t("connectors.cliInstallFailed", "Host CLI install failed"),
        );
      }
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(
          e,
          t("connectors.cliInstallFailed", "Host CLI install failed"),
          t,
        ),
      );
    } finally {
      setInstallingCli(false);
    }
  };

  const extractPastedCredential = (text: string): string => {
    const trimmed = text.trim();
    try {
      const url = new URL(trimmed);
      const fromQuery =
        url.searchParams.get("code") ??
        url.searchParams.get("access_token") ??
        url.searchParams.get("token");
      if (fromQuery) return fromQuery;
    } catch {
      // not a full URL
    }
    const match = trimmed.match(/access_token=([^&\s#]+)/i);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    const mcpMatch = trimmed.match(/mcp_token=([^\s;,&"']+)/i);
    if (mcpMatch?.[1]) {
      return mcpMatch[1];
    }
    return trimmed;
  };

  const handlePasteToken = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        message.warning(t("connectors.clipboardEmpty", "Clipboard is empty"));
        return;
      }
      if (entry?.auth_kind === "personal_token") {
        form.setFieldValue("token", extractPastedCredential(text));
      } else if (entry?.auth_kind === "auth_code") {
        form.setFieldValue("auth_code", text);
      } else if (entry?.auth_kind === "api_key") {
        form.setFieldValue("api_key", text);
      }
      message.success(t("connectors.pasteSuccess", "Pasted"));
    } catch {
      message.error(
        t("connectors.clipboardDenied", "Cannot read clipboard — paste manually"),
      );
    }
  };

  const handleGuidedPaste = async () => {
    if (!entry || !isGuidedConnector(entry.kind)) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        message.warning(t("connectors.clipboardEmpty", "Clipboard is empty"));
        return;
      }
      const pastedUrl = extractHttpUrl(text);
      if (entry.kind === "dify") {
        if (!pastedUrl) {
          message.warning(
            t("connectors.difyPasteUrlRequired", "No MCP URL found in the clipboard"),
          );
          return;
        }
        form.setFieldValue("mcp_url", pastedUrl);
        await form.validateFields(["mcp_url"]);
      } else if (pastedUrl) {
        form.setFieldValue("base_url", pastedUrl);
      } else {
        form.setFieldValue("api_key", text);
      }
      saveFormDraft(
        draftScope,
        form.getFieldsValue() as Record<string, unknown>,
      );
      message.success(t("connectors.pasteSuccess", "Pasted"));
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) {
        message.warning(
          t(
            "connectors.difyMcpUrlInvalid",
            "Please paste Dify The access point provides the complete MCP Server URL",
          ),
        );
        return;
      }
      message.error(
        t("connectors.clipboardDenied", "Cannot read clipboard — paste manually"),
      );
    }
  };

  const handleOAuth = async () => {
    if (!entry || authorizing) return;
    const popup = window.open("", "octop-oauth", "width=520,height=720");
    if (!popup) {
      message.error(
        t(
          "connectors.oauthPopupBlocked",
          "The authorization window is blocked by the browser. Please allow this site to pop up the window and try again.",
        ),
      );
      return;
    }

    setAuthorizing(true);
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let stateId = "";

    const cleanup = () => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      window.removeEventListener("message", onMessage);
    };

    const finishWithTokens = async (tokens: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      try {
        const values = form.getFieldsValue();
        const credentials: Record<string, unknown> = {};
        if (tokens.access_token) credentials.access_token = tokens.access_token;
        if (tokens.refresh_token)
          credentials.refresh_token = tokens.refresh_token;
        if (tokens.expires_at) credentials.expires_at = tokens.expires_at;
        if (tokens.oauth_client_id)
          credentials.oauth_client_id = tokens.oauth_client_id;
        if (tokens.oauth_client_secret)
          credentials.oauth_client_secret = tokens.oauth_client_secret;
        if (tokens.openid) credentials.openid = tokens.openid;

        if (!credentials.access_token) {
          message.error(t("connectors.oauthFailed", "Failed to fetch OAuth result"));
          return;
        }

        if (instance) {
          await connectorsApi.patchInstance(instance.instance_id, {
            display_name: String(values.display_name || entry.name),
            description: String(values.description || entry.description),
            credentials,
            default_open: values.default_open === true,
            shared: values.shared === true,
          });
        } else {
          await connectorsApi.createInstance({
            kind: entry.kind,
            display_name: String(values.display_name || entry.name),
            description: String(values.description || entry.description),
            credentials,
            default_open: values.default_open === true,
            shared: values.shared === true,
          });
        }
        clearFormDraft(draftScope);
        message.success(t("connectors.createSuccess", "Connector created"));
        onSaved();
        onClose();
      } catch (e) {
        console.error(e);
        form.setFieldsValue({
          display_name: entry.name,
          description: entry.description,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_at,
          oauth_client_id: tokens.oauth_client_id,
          oauth_client_secret: tokens.oauth_client_secret,
          openid: tokens.openid,
        });
        message.error(
          apiErrorMessage(e, t("connectors.createFailed", "Failed to create"), t),
        );
      } finally {
        setAuthorizing(false);
      }
    };

    const claimPending = async () => {
      if (settled || !stateId) return;
      try {
        const pending = await connectorsApi.oauthPending(stateId);
        await finishWithTokens(pending.tokens ?? {});
      } catch {
        // Pending not ready yet (404) — keep polling.
      }
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== "octop:connector-oauth") return;
      if (ev.data.state_id !== stateId) return;
      void claimPending();
    };

    try {
      const { authorize_url, state_id } = await connectorsApi.oauthStart(
        { type: "catalog", kind: entry.kind },
        "/connectors",
      );
      stateId = state_id;
      window.addEventListener("message", onMessage);
      // Ardot (and some IdPs) set COOP so window.opener is null after redirect;
      // poll pending so the parent still claims tokens without postMessage.
      pollTimer = setInterval(() => {
        void claimPending();
      }, 1500);
      timeoutTimer = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            popup.close();
          } catch {
            // ignore
          }
          setAuthorizing(false);
          message.error(
            t("connectors.oauthTimedOut", "Authorization timed out; try one-click auth again"),
          );
        },
        5 * 60 * 1000,
      );
      popup.location.replace(authorize_url);
    } catch (e) {
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.oauthStartFailed", "Could not start OAuth")),
      );
      setAuthorizing(false);
    }
  };

  const handleProbe = async () => {
    if (!entry) return;
    const values = form.getFieldsValue();
    const preview = instanceDetail?.credentials_preview ?? {};
    const freshSecret = hasFreshCredentialInput(entry, values);
    const customConfigChanged = customCredentialConfigChanged(
      entry,
      values,
      preview,
    );
    const customHasStoredSecret = (entry.credential_fields ?? []).some(
      (field) => field.secret && preview[`${field.key}_configured`] === true,
    );
    const identityChanged = customConfigChanged;
    if (
      identityChanged &&
      !freshSecret &&
      (entry.auth_kind !== "custom_fields" || customHasStoredSecret)
    ) {
      message.warning(
        t(
          "connectors.probeNeedSecretAfterConfigChange",
          "The connection configuration has been modified. Please refill the key and try again.",
        ),
      );
      return;
    }
    const freshInput = freshSecret || identityChanged;
    // Only reuse saved creds when the form still matches the stored identity.
    const canUseStored = hasStoredCredentials && instance && !freshInput;

    if (!canUseStored) {
      try {
        await form.validateFields();
      } catch {
        message.warning(
          t("connectors.probeNeedConfig", "Fill in connection settings before probing"),
        );
        return;
      }
    }

    setProbing(true);
    setProbeResult(null);
    try {
      const r = canUseStored
        ? await connectorsApi.testInstance(instance.instance_id)
        : await connectorsApi.testCredentials({
            kind: entry.kind,
            credentials: buildCredentials(entry, values),
          });
      if (r.ok) {
        const tools = r.tools ?? [];
        setProbeResult(tools);
        if (canUseStored) {
          message.success(
            t(
              "connectors.probeUsedStoredCredentials",
              "Probe passed (using saved credentials)",
            ),
          );
        }
      } else {
        setProbeResult(null);
        message.error(r.error ?? t("connectors.probeFailed", "Probe failed"));
      }
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.probeFailed", "Probe failed"), t),
      );
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async () => {
    if (!entry) return;
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue();
    if (entry.auth_kind === "oauth2") {
      const token = String(values.access_token ?? "").trim();
      if (!hasStoredCredentials && !token) {
        message.warning(
          t("connectors.oauthNeedToken", "Complete authorization or paste a token first"),
        );
        return;
      }
    }
    setSaving(true);
    try {
      const payload = buildCredentials(entry, values);
      if (instance) {
        await connectorsApi.patchInstance(instance.instance_id, {
          display_name: values.display_name as string,
          description: values.description as string,
          credentials: payload,
          default_open: values.default_open === true,
          shared: values.shared === true,
        });
      } else {
        await connectorsApi.createInstance({
          kind: entry.kind,
          display_name: values.display_name as string,
          description: values.description as string,
          credentials: payload,
          default_open: values.default_open === true,
          shared: values.shared === true,
        });
      }
      message.success(
        instance
          ? t("connectors.saveSuccess", "Connector saved")
          : t("connectors.createSuccess", "Connector created"),
      );
      clearFormDraft(draftScope);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.createFailed", "Failed to create"), t),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!entry) return null;

  const hasOAuthPopup =
    entry.auth_kind === "oauth2" &&
    entry.oauth_ready &&
    oauthCallbackSupported();
  const hasAuthorizeUrl = Boolean(authInfo?.authorize_url);
  const hasLoginUrl = Boolean(authInfo?.login_url);
  const guideUrl = authInfo?.guide_url ?? entry.guide_url ?? entry.doc_url;
  const manualUrl = authInfo?.manual_url ?? entry.manual_url ?? guideUrl;
  const catalogAuthHint = authInfo?.auth_hint ?? entry.auth_hint;
  const authHint = catalogAuthHint;
  const guidedKind = isGuidedConnector(entry.kind) ? entry.kind : null;

  const preview = instanceDetail?.credentials_preview;
  const secretRequired = !hasStoredCredentials;
  const hideTopAuth = entry
    ? INLINE_CREDENTIAL_GUIDE_KINDS.has(entry.kind)
    : false;
  const hideFieldGuide = entry
    ? HIDE_INLINE_FIELD_GUIDE_KINDS.has(entry.kind)
    : false;
  const hideGuideLink =
    hideTopAuth ||
    Boolean(entry?.quick_auth_url && guideUrl === entry.quick_auth_url);

  return (
    <Drawer
      title={
        instance
          ? t("connectors.editConnection", {
              name: entry.name,
              defaultValue: `Edit ${entry.name} Connector`,
            })
          : t("connectors.createConnection", {
              name: entry.name,
              defaultValue: `Create ${entry.name} Connector`,
            })
      }
      open={open}
      onClose={onClose}
      width={440}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            icon={<Activity size={14} />}
            loading={probing}
            onClick={() => void handleProbe()}
          >
            {t("connectors.probe", "Probe")}
          </Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => void handleSubmit()}
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className={styles.drawerBody}>
        {loadingDetail ? (
          <div className={styles.drawerLoading}>
            <Spin size="small" />
          </div>
        ) : null}

        {authHint && <div className={styles.authHint}>{authHint}</div>}

        {guidedKind && (
          <div className={styles.guidedSetup}>
            <div className={styles.guidedSetupTitle}>
              {t("connectors.guidedSetup", "Quick setup")}
            </div>
              <ol>
                <li>
                  {t("connectors.difyStep1", "Publish the app or workflow in Dify")}
                </li>
                <li>
                  {t(
                    "connectors.difyStep2",
                    "Enable on access point MCP And copy the complete Server URL",
                  )}
                </li>
                <li>
                  {t("connectors.guidedStepProbe", "Probe and save after pasting credentials")}
                </li>
              </ol>
              </div>
            )}

            {guideUrl && !hideGuideLink && (
              <div className={styles.guideLinks}>
                <a href={guideUrl} target="_blank" rel="noreferrer">
                  {t("connectors.viewGuide", "View guide")}
                </a>
              </div>
            )}

            <div className={styles.quickAuthBar}>
              {guidedKind && (
                <>
              <Button
                icon={<ClipboardPaste size={14} />}
                onClick={() => void handleGuidedPaste()}
              >
                {t("connectors.pasteMcpUrl", "Paste MCP URL")}
              </Button>
            </>
          )}
          {entry && isHostCliConnector(entry.kind) && (
            <>
              {canInstallCli && (
                <Button
                  type={cliInfo?.installed ? "default" : "primary"}
                  icon={
                    cliInfo?.installed ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <Download size={14} />
                    )
                  }
                  loading={installingCli}
                  onClick={() => void handleInstallCli()}
                >
                  {cliInfo?.installed
                    ? t("connectors.cliReady", "CLI ready")
                    : t("connectors.installCli", "Install CLI")}
                </Button>
              )}
              {!canInstallCli && cliInfo?.installed && (
                <Button
                  type="default"
                  icon={<CheckCircle2 size={14} />}
                  disabled
                >
                  {t("connectors.cliReady", "CLI ready")}
                </Button>
              )}
              {!canInstallCli && !cliInfo?.installed && (
                <span className={styles.authHint}>
                  {t(
                    "connectors.cliInstallAdminOnly",
                    "Host CLI Requires administrator installation; you can copy the command and give it to the administrator for execution",
                  )}
                </span>
              )}
              {cliInfo?.install_command && (
                <Button
                  icon={<Copy size={14} />}
                  onClick={() =>
                    void handleCopyInstallCommand(cliInfo.install_command)
                  }
                >
                  {t("connectors.copyInstallCommand", "Copy install command")}
                </Button>
              )}
              {(cliInfo?.guide_url ||
                cliInfo?.doc_url ||
                entry.guide_url ||
                entry.doc_url) && (
                <Button
                  icon={<ExternalLink size={14} />}
                  onClick={() =>
                    openUrl(
                      cliInfo?.guide_url ||
                        entry.guide_url ||
                        cliInfo?.doc_url ||
                        entry.doc_url,
                    )
                  }
                >
                  {t("connectors.openCliDocs", "Install docs")}
                </Button>
              )}
            </>
          )}
          {hasOAuthPopup && (
            <Button
              type="primary"
              icon={<Sparkles size={14} />}
              loading={authorizing}
              onClick={() => void handleOAuth()}
            >
              {t("connectors.oneClickOAuth", "Authorize")}
            </Button>
          )}
          {hasAuthorizeUrl && !hideTopAuth && !hasOAuthPopup && (
            <Button
              type="primary"
              icon={<ExternalLink size={14} />}
              loading={openingAuthorize}
              onClick={() => void handleOpenAuthorize()}
            >
              {t("connectors.openAuthorizePage", "Open authorization page")}
            </Button>
          )}
          {hasLoginUrl && !hideTopAuth && (
            <Button icon={<ExternalLink size={14} />} onClick={handleOpenLogin}>
              {t("connectors.openLoginPage", "Open login page")}
            </Button>
          )}
          {!hideTopAuth &&
            !hasAuthorizeUrl &&
            !hasLoginUrl &&
            entry.quick_auth_url &&
            entry.auth_kind !== "oauth2" && (
              <Button
                type="primary"
                icon={<ExternalLink size={14} />}
                loading={openingAuthorize}
                onClick={() => void handleOpenAuthorize()}
              >
                {openAuthorizeLabel(entry.kind, t)}
              </Button>
            )}
          {(entry.auth_kind === "personal_token" ||
            entry.auth_kind === "auth_code" ||
            entry.auth_kind === "api_key") && (
            <Button
              icon={<ClipboardPaste size={14} />}
              onClick={() => void handlePasteToken()}
            >
              {t("connectors.pasteFromClipboard", "Paste from clipboard")}
            </Button>
          )}
        </div>

        {entry && isHostCliConnector(entry.kind) && cliInfo && (
          <div
            className={
              cliInfo.ok === false || !cliInfo.installed
                ? styles.cliInstallHintError
                : styles.cliInstallHint
            }
          >
            {cliInfo.installed ? (
              <div>
                {t("connectors.cliInstalledHint", {
                  binary: cliInfo.binary,
                  version: cliInfo.version ?? "",
                  defaultValue: cliInfo.version
                    ? `Host detected ${cliInfo.binary}(${cliInfo.version})`
                    : `Host detected ${cliInfo.binary}`,
                })}
              </div>
            ) : (
              <div>
                {cliInfo.error ??
                  t(
                    "connectors.cliMissingHint",
                    "CLI is not installed on the host. Click Install CLI, or run the command below on the Octop host.",
                  )}
              </div>
            )}
            {(!cliInfo.installed || cliInfo.ok === false) &&
              cliInfo.install_command && (
                <code className={styles.cliInstallCommand}>
                  {cliInfo.install_command}
                </code>
              )}
            {(!cliInfo.installed || cliInfo.ok === false) && (
              <div className={styles.cliInstallLinks}>
                {(cliInfo.guide_url || entry.guide_url) && (
                  <a
                    href={cliInfo.guide_url || entry.guide_url || undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("connectors.openCliDocs", "Install docs")}
                  </a>
                )}
                {(cliInfo.doc_url || entry.doc_url) && (
                  <a
                    href={cliInfo.doc_url || entry.doc_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("connectors.openCliRepo", "Project page")}
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <Form
          form={form}
          layout="vertical"
          onValuesChange={(_, all) => {
            if (!restoringDraftRef.current && draftScope) {
              saveFormDraft(
                draftScope,
                all as unknown as Record<string, unknown>,
              );
            }
          }}
        >
          <div className={styles.configSectionTitle}>
            {t("connectors.configSection", "Connection settings")}
          </div>
          <Form.Item
            name="display_name"
            label={t("connectors.displayName", "Display name")}
            rules={[{ required: true }]}
          >
            <Input placeholder={entry.name} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t("connectors.description", "Description")}
            rules={[{ required: true }]}
          >
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              placeholder={entry.description}
            />
          </Form.Item>

          {entry.auth_kind === "custom_fields" &&
            (entry.credential_fields ?? []).map((field) => {
              const isSecret = field.secret || field.field_type === "password";
              const input = isSecret ? (
                <Input.Password
                  placeholder={
                    hasStoredCredentials && field.secret
                      ? t("connectors.secretPlaceholder", "Leave blank to keep current value")
                      : field.placeholder ?? undefined
                  }
                />
              ) : (
                <Input placeholder={field.placeholder ?? undefined} />
              );
              return (
                <Form.Item
                  key={field.key}
                  name={field.key}
                  label={field.label}
                  rules={[
                    ...(isSecret
                      ? secretFieldRules(field.required && secretRequired)
                      : [{ required: field.required }]),
                    ...(entry.kind === "dify" && field.key === "mcp_url"
                      ? [
                          {
                            validator: (_: unknown, value: unknown) =>
                              !value || isDifyMcpServerUrl(String(value))
                                ? Promise.resolve()
                                : Promise.reject(
                                    new Error(
                                      t(
                                        "connectors.difyMcpUrlInvalid",
                                        "Please paste Dify The access point provides the complete MCP Server URL",
                                      ),
                                    ),
                                  ),
                          },
                        ]
                      : []),
                  ]}
                  extra={
                    configuredExtra(preview, `${field.key}_configured`, t) ??
                    field.help
                  }
                >
                  {input}
                </Form.Item>
              );
            })}

          {entry.auth_kind === "personal_token" && (
            <Form.Item
              name="token"
              label={t("connectors.token", "Access token")}
              rules={secretFieldRules(secretRequired)}
              extra={
                configuredExtra(preview, "token_configured", t) ??
                (!hideFieldGuide && manualUrl ? (
                  <a href={manualUrl} target="_blank" rel="noreferrer">
                    {t("connectors.getTokenAt", "Get a Token")}
                  </a>
                ) : !hideFieldGuide ? (
                  <a href={entry.doc_url} target="_blank" rel="noreferrer">
                    {t("connectors.getToken", "Get token")}
                  </a>
                ) : undefined)
              }
            >
              <Input.Password
                placeholder={hasStoredCredentials ? "••••••••" : undefined}
              />
            </Form.Item>
          )}

          {entry.auth_kind === "auth_code" && (
            <>
              <Form.Item
                name="auth_code"
                label={t("connectors.authCode", "Authorization code")}
                rules={secretFieldRules(secretRequired)}
                extra={
                  configuredExtra(preview, "auth_configured", t) ??
                  (!hideFieldGuide && entry.manual_url ? (
                    <a href={entry.manual_url} target="_blank" rel="noreferrer">
                      {authCodeGuideLabel(entry.kind, t)}
                    </a>
                  ) : !hideFieldGuide && manualUrl ? (
                    <a href={manualUrl} target="_blank" rel="noreferrer">
                      {authCodeGuideLabel(entry.kind, t)}
                    </a>
                  ) : undefined)
                }
              >
                <Input.Password
                  placeholder={
                    hasStoredCredentials
                      ? t("connectors.secretPlaceholder", "Leave blank to keep current value")
                      : t("connectors.authCodePlaceholder", "Paste authorization code")
                  }
                />
              </Form.Item>
            </>
          )}

          {entry.auth_kind === "api_key" && (
              <>
                <Form.Item
                  name="api_key"
                  label={t("connectors.apiKey", "API Key")}
                  rules={secretFieldRules(secretRequired)}
                  extra={
                    configuredExtra(preview, "api_key_configured", t) ??
                    (!hideFieldGuide && manualUrl ? (
                      <a href={manualUrl} target="_blank" rel="noreferrer">
                        {t("connectors.apiKeyDoc", "See how to get an API Key")}
                      </a>
                    ) : undefined)
                  }
                >
                  <Input.Password
                    placeholder={
                      hasStoredCredentials
                        ? t("connectors.secretPlaceholder", "Leave blank to keep current value")
                        : t("connectors.apiKeyPlaceholder", "Paste API Key")
                    }
                  />
                </Form.Item>
              </>
            )}

          {entry.auth_kind === "oauth2" && (
            <>
              <Form.Item name="access_token" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="refresh_token" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="expires_at" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="oauth_client_id" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="oauth_client_secret" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="openid" hidden>
                <Input />
              </Form.Item>
                {preview?.oauth_configured && !showManual && (
                  <div className={styles.configuredBadge}>
                    {t("connectors.oauthConfigured", "Authorized — probe or save now")}
                  </div>
                )}
                {entry.oauth_ready &&
                  hasOAuthPopup &&
                  !preview?.oauth_configured && (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--fn-text-tertiary)",
                        marginBottom: 8,
                      }}
                    >
                      {t(
                        "connectors.oauthHint",
                        "Click “One-click Authorization” to complete the login and it will be automatically saved; you can also paste it manually. Token",
                      )}
                    </div>
                  )}
                <>
                  <div
                    className={styles.manualToggle}
                    onClick={() => setShowManual((v) => !v)}
                    role="button"
                    tabIndex={0}
                  >
                    {showManual
                      ? t("connectors.hideManual", "Hide manual input")
                      : t("connectors.showManual", "Paste token manually")}
                  </div>
                  {showManual && (
                    <Form.Item
                      name="access_token_manual"
                      label={t("connectors.accessTokenManual", "Access Token")}
                      extra={
                        manualUrl ? (
                          <a href={manualUrl} target="_blank" rel="noreferrer">
                            {t(
                              "connectors.manualTokenDoc",
                              "Get manually Token Documentation",
                            )}
                          </a>
                        ) : undefined
                      }
                    >
                      <Input.Password
                        onChange={(e) =>
                          form.setFieldValue("access_token", e.target.value)
                        }
                      />
                    </Form.Item>
                  )}
                </>
            </>
          )}

          {entry.auth_kind === "imap_app_password" && (
            <>
              <Form.Item
                name="mail_provider"
                label={t("connectors.mailProvider", "Mail provider")}
                initialValue="gmail"
              >
                <Select
                  options={MAIL_PROVIDERS.map((item) => ({
                    value: item.id,
                    label: item.label,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="email"
                label={t("connectors.email", "Email address")}
                rules={[{ required: true }]}
              >
                <Input placeholder={selectedMailProvider.emailPlaceholder} />
              </Form.Item>
              <Form.Item
                name="password"
                label={t("connectors.authCode", "Authorization code")}
                rules={secretFieldRules(secretRequired)}
                extra={
                  configuredExtra(preview, "password_configured", t) ??
                  (selectedMailProvider.guideUrl ? (
                    <a
                      href={selectedMailProvider.guideUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t(
                        "connectors.personalMailAuthGuide",
                        "How to obtain email authorization code",
                      )}
                    </a>
                  ) : undefined)
                }
              >
                <Input.Password
                  placeholder={
                    hasStoredCredentials
                      ? t("connectors.secretPlaceholder", "Leave blank to keep current value")
                      : undefined
                  }
                />
              </Form.Item>
              {mailProvider === "custom" && (
                <>
                  <Form.Item
                    name="imap_host"
                    label={t("connectors.imapHost", "IMAP server")}
                    rules={[{ required: true }]}
                  >
                    <Input placeholder="imap.example.com" />
                  </Form.Item>
                  <Form.Item
                    name="smtp_host"
                    label={t("connectors.smtpHost", "SMTP server")}
                    rules={[{ required: true }]}
                  >
                    <Input placeholder="smtp.example.com" />
                  </Form.Item>
                </>
              )}
            </>
          )}

          {entry.auth_kind === "api_credentials" && (
            <>
              <Form.Item
                name="app_id"
                label="AppId"
                rules={[{ required: true }]}
              >
                <Input placeholder="Enterprise ID / AppId" />
              </Form.Item>
              <Form.Item
                name="sdk_id"
                label="SdkId"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="secret_key"
                label="Secret"
                rules={secretFieldRules(secretRequired)}
                extra={configuredExtra(preview, "secret_key_configured", t)}
              >
                <Input.Password
                  placeholder={
                    hasStoredCredentials
                      ? t("connectors.secretPlaceholder", "Leave blank to keep current value")
                      : undefined
                  }
                />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="shared"
            label={t("connectors.shared", "Share with others")}
            valuePropName="checked"
            extra={t(
              "connectors.sharedHint",
              "After sharing, other users can choose to use it, but they cannot view or modify the configuration.",
            )}
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="default_open"
            label={t("connectors.defaultEnabled", "Enable by default")}
            valuePropName="checked"
            extra={
              defaultOpen
                ? undefined
                : t(
                    "connectors.defaultOpenHint",
                    "When closed, you need to manually check it in the dialog to inject the tool.",
                  )
            }
          >
            <Switch />
          </Form.Item>
          {defaultOpen ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t(
                "connectors.defaultOpenWarning",
                "By default it will be in Dashboard,IM With Cron(When no connector is specially selected) Carrying this tool (extra cost token).Dashboard Can close the epicycle;Cron If a connector is selected explicitly, the selection takes precedence.",
              )}
            />
          ) : null}
        </Form>

        {probeResult !== null && (
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
                  {probeResult.length > 0
                    ? t("connectors.probeToolsHint", {
                        count: probeResult.length,
                        defaultValue: `The connection is normal and the following tool list is obtained (total ${probeResult.length} )`,
                      })
                    : t(
                        "connectors.probeToolsEmpty",
                        "The connection is OK, but no available tools found",
                      )}
                </div>
              </div>
            </div>
            {probeResult.length > 0 && (
              <ul className={styles.probeToolList}>
                {probeResult.map((tool, index) => (
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
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

type ConnectorTab = "enabled" | "builtin" | "custom";

const CONNECTOR_TABS: TabBarItem<ConnectorTab>[] = [
  { key: "enabled", labelKey: "connectors.tabEnabled", icon: Link2 },
  { key: "builtin", labelKey: "connectors.tabBuiltin", icon: Blocks },
  { key: "custom", labelKey: "connectors.tabCustom", icon: Wrench },
];

export default function ConnectorsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ConnectorTab>("enabled");
  const [drawerEntry, setDrawerEntry] = useState<ConnectorCatalogEntry | null>(
    null,
  );
  const [drawerInstance, setDrawerInstance] =
    useState<ConnectorInstance | null>(null);
  const [customFocusServerName, setCustomFocusServerName] = useState<
    string | null
  >(null);
  const { catalog, instances, loading, refresh } = useConnectorInstances();

  const configuredCount = useMemo(() => {
    return instances.filter((instance) => instance.has_credentials).length;
  }, [instances]);

  useEffect(() => {
    const oauthState = searchParams.get("oauth_state");
    if (!oauthState) return;
    void (async () => {
      try {
        const pending = await connectorsApi.oauthPending(oauthState);
        const kind = String(pending.kind || "");
        const entry = catalog.find((c) => c.kind === kind);
        const tokens = pending.tokens ?? {};
        if (!entry || !tokens.access_token) {
          message.error(t("connectors.oauthFailed", "Failed to fetch OAuth result"));
          return;
        }
        const credentials: Record<string, unknown> = {
          access_token: tokens.access_token,
        };
        if (tokens.refresh_token)
          credentials.refresh_token = tokens.refresh_token;
        if (tokens.expires_at) credentials.expires_at = tokens.expires_at;
        if (tokens.oauth_client_id)
          credentials.oauth_client_id = tokens.oauth_client_id;
        if (tokens.oauth_client_secret)
          credentials.oauth_client_secret = tokens.oauth_client_secret;
        if (tokens.openid) credentials.openid = tokens.openid;

        await connectorsApi.createInstance({
          kind: entry.kind,
          display_name: entry.name,
          description: entry.description,
          credentials,
          default_open: false,
        });
        await refresh();
        notifyConnectorsChanged();
        message.success(t("connectors.createSuccess", "Connector created"));
      } catch {
        message.error(t("connectors.oauthFailed", "Failed to fetch OAuth result"));
      }
      searchParams.delete("oauth_state");
      setSearchParams(searchParams, { replace: true });
    })();
  }, [searchParams, setSearchParams, catalog, refresh, t]);

  const handleConfigure = useCallback(
    (entry: ConnectorCatalogEntry, instance: ConnectorInstance | null) => {
      setDrawerEntry(entry);
      setDrawerInstance(instance);
    },
    [],
  );

  const handleSaved = useCallback(async () => {
    await refresh();
    notifyConnectorsChanged();
  }, [refresh]);

  const handleCloseDrawer = useCallback(() => {
    setDrawerEntry(null);
    setDrawerInstance(null);
  }, []);

  return (
    <PageShell.Tabbed
      title={t("pageShell.connectors.title")}
      subtitle={t("pageShell.connectors.subtitle")}
      tabBar={
        <TabBar
          tabs={CONNECTOR_TABS}
          activeKey={activeTab}
          onChange={(key) => {
            if (key === "custom") setCustomFocusServerName(null);
            setActiveTab(key);
          }}
        />
      }
    >
      {activeTab === "custom" ? (
        <CustomMcpTab focusServerName={customFocusServerName} />
      ) : activeTab === "enabled" ? (
        loading ? (
          <div className={styles.loadingState}>
            <Spin />
          </div>
        ) : instances.length === 0 ? (
          <div className={styles.emptyLayout}>
            <StreamSetupGuide
              className={styles.emptyGuide}
              wide
              plain
              icon={<OctopEmptyMascot />}
              title={t("connectors.emptyGuideTitle")}
              description={t("connectors.emptyGuideDesc")}
              steps={[
                {
                  label: t("connectors.emptyGuideStepWhat"),
                  detail: t("connectors.emptyGuideStepWhatDetail"),
                },
                {
                  label: t("connectors.emptyGuideStepHow"),
                  detail: t("connectors.emptyGuideStepHowDetail"),
                },
                {
                  label: t("connectors.emptyGuideStepShare"),
                  detail: t("connectors.emptyGuideStepShareDetail"),
                },
              ]}
              primaryAction={{
                label: t("connectors.emptyGuideBrowseBuiltin"),
                onClick: () => setActiveTab("builtin"),
                icon: <Plug size={14} />,
              }}
              secondaryAction={{
                label: t("connectors.emptyGuideAddCustom"),
                onClick: () => {
                  setCustomFocusServerName(null);
                  setActiveTab("custom");
                },
                icon: <Plus size={14} />,
                type: "default",
              }}
            />
          </div>
        ) : (
          <>
            <div className={styles.listToolbar}>
              <span className={styles.listToolbarMeta}>
                {t("connectors.enabledSummary", {
                  count: instances.length,
                  defaultValue: "Enabled {{count}} Connector instances",
                })}
              </span>
              <Button
                icon={<RefreshCw size={14} />}
                loading={loading}
                onClick={() => void refresh()}
              >
                {t("common.refresh")}
              </Button>
            </div>
            <div className={styles.typeGrid}>
              {instances.map((instance) => (
                <ConnectorInstanceCard
                  key={instance.instance_id}
                  instance={instance}
                  catalogEntry={catalog.find(
                    (entry) => entry.kind === instance.kind,
                  )}
                  onEdit={(item) => {
                    if (item.kind === "custom-mcp") {
                      setCustomFocusServerName(item.mcp_server_name);
                      setActiveTab("custom");
                      return;
                    }
                    const entry = catalog.find((row) => row.kind === item.kind);
                    if (entry) handleConfigure(entry, item);
                  }}
                  onChanged={handleSaved}
                />
              ))}
            </div>
          </>
        )
      ) : (
        <>
          <div className={styles.listToolbar}>
            <span className={styles.listToolbarMeta}>
              {t("connectors.listSummary", {
                total: catalog.length,
                configured: configuredCount,
                defaultValue:
                  "Currently supported {{total}} Connectors, configured {{configured}} A",
              })}
            </span>
            <Button
              icon={<RefreshCw size={14} />}
              loading={loading}
              onClick={() => void refresh()}
            >
              {t("common.refresh")}
            </Button>
          </div>
          {loading ? (
            <div className={styles.loadingState}>
              <Spin />
            </div>
          ) : (
            <div className={styles.typeGrid}>
              {catalog.map((entry) => (
                <ConnectorCard
                  key={entry.kind}
                  entry={entry}
                  onConfigure={handleConfigure}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ConnectorConfigDrawer
        open={drawerEntry !== null}
        entry={drawerEntry}
        instance={drawerInstance}
        onClose={handleCloseDrawer}
        onSaved={(created) => {
          if (created) setDrawerInstance(created);
          void handleSaved();
        }}
      />
    </PageShell.Tabbed>
  );
}
