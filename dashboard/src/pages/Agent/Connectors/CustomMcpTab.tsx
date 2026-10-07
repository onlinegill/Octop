import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, Segmented, Spin } from "antd";
import { message } from "@/utils/antdMessage";

import { Globe, Plus, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  connectorsApi,
  type ConnectorProbeResult,
  type CustomMcpServers,
  type CustomMcpTransport,
} from "../../../api/modules/connectors";
import { apiErrorMessage } from "../../../utils/apiError";
import { CustomMcpServerCard } from "./CustomMcpServerCard";
import {
  EXAMPLE_JSON,
  PROBE_ON_SAVE_KEY,
  cardsToServers,
  hasHttpProbeTargets,
  mergeCustomMcpCards,
  newCard,
  notifyConnectorsChanged,
  oauthHintsFromServers,
  serversToCards,
  type EditorMode,
  type ServerCardState,
} from "./customMcpUtils";
import styles from "./index.module.less";

interface CustomMcpTabProps {
  focusServerName?: string | null;
}

export function CustomMcpTab({ focusServerName }: CustomMcpTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<string, { name: string; description: string }[]>
  >({});
  const [mode, setMode] = useState<EditorMode>("visual");
  const [cards, setCards] = useState<ServerCardState[]>([]);
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [probeOnSave, setProbeOnSave] = useState(
    () => localStorage.getItem(PROBE_ON_SAVE_KEY) === "1",
  );
  const [oauthAvailable, setOauthAvailable] = useState<Record<string, boolean>>(
    {},
  );
  const [authorizingKey, setAuthorizingKey] = useState<string | null>(null);
  const [persistedNames, setPersistedNames] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    localStorage.setItem(PROBE_ON_SAVE_KEY, probeOnSave ? "1" : "0");
  }, [probeOnSave]);

  const applySavedServers = (
    servers: CustomMcpServers,
    prevCards: ServerCardState[],
  ) => {
    const nextCards = mergeCustomMcpCards(servers, prevCards);
    setCards(nextCards);
    setPersistedNames(new Set(Object.keys(servers)));
    setJsonText(JSON.stringify(servers, null, 2));
    setOauthAvailable(oauthHintsFromServers(servers, nextCards));
    return nextCards;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { servers } = await connectorsApi.getCustomMcp();
      applySavedServers(servers, []);
      setProbeResults({});
      setJsonError(null);
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(
          e,
          t("connectors.customMcp.loadFailed", "Failed to load custom MCP"),
          t,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusServerName || loading) return;
    setMode("visual");
    setCards((prev) =>
      prev.map((card) =>
        card.name.trim() === focusServerName
          ? { ...card, collapsed: false }
          : card,
      ),
    );
  }, [focusServerName, loading]);

  const persistServerPatch = async (
    card: ServerCardState,
    apiPatch: {
      enabled?: boolean;
      default_open?: boolean;
      shared?: boolean;
    },
    localPatch: Partial<ServerCardState>,
  ) => {
    const optimisticCards = cards.map((item) =>
      item.key === card.key ? { ...item, ...localPatch } : item,
    );
    updateCard(card.key, localPatch);
    const name = card.name.trim();
    if (!name || !persistedNames.has(name)) {
      return;
    }
    try {
      const { servers } = await connectorsApi.patchCustomMcpServer(
        name,
        apiPatch,
      );
      applySavedServers(servers, optimisticCards);
      notifyConnectorsChanged();
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.customMcp.saveFailed", "Failed to save"), t),
      );
      await load();
    }
  };

  const syncJsonFromCards = useCallback((nextCards: ServerCardState[]) => {
    try {
      const servers = cardsToServers(nextCards);
      setJsonText(JSON.stringify(servers, null, 2));
      setJsonError(null);
    } catch {
      // keep previous json while visual has incomplete names
    }
  }, []);

  const updateCard = (key: string, patch: Partial<ServerCardState>) => {
    setCards((prev) => {
      const next = prev.map((card) =>
        card.key === key ? { ...card, ...patch } : card,
      );
      syncJsonFromCards(next);
      return next;
    });
  };

  const handleModeChange = (nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === "json") {
      try {
        const servers = cardsToServers(cards);
        setJsonText(JSON.stringify(servers, null, 2));
        setJsonError(null);
      } catch (e) {
        message.warning(
          t(
            "connectors.customMcp.visualInvalid",
            "The visualization configuration is incomplete. Please correct the name and required fields first.",
          ),
        );
        console.error(e);
        return;
      }
    } else {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("root must be object");
        }
        const servers = parsed as CustomMcpServers;
        setCards(serversToCards(servers));
        setJsonError(null);
      } catch {
        setJsonError(
          t(
            "connectors.customMcp.jsonInvalid",
            "JSON Invalid format, cannot switch to visualization",
          ),
        );
        message.error(
          t(
            "connectors.customMcp.jsonInvalid",
            "JSON Invalid format, cannot switch to visualization",
          ),
        );
        return;
      }
    }
    setMode(nextMode);
  };

  const handleAdd = (transport: CustomMcpTransport) => {
    setCards((prev) => {
      const next = [...prev, newCard(transport, prev.length)];
      syncJsonFromCards(next);
      return next;
    });
    setMode("visual");
  };

  const handleRemove = async (key: string) => {
    const card = cards.find((item) => item.key === key);
    const serverName = card?.name.trim() ?? "";
    const nextCards = cards.filter((item) => item.key !== key);
    setCards(nextCards);
    syncJsonFromCards(nextCards);
    setProbeResults((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOauthAvailable((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    if (!serverName || !persistedNames.has(serverName)) {
      return;
    }

    try {
      await connectorsApi.deleteInstance(`custom:${serverName}`);
      setPersistedNames((prev) => {
        const next = new Set(prev);
        next.delete(serverName);
        return next;
      });
      notifyConnectorsChanged();
      message.success(t("connectors.deleteSuccess", "Deleted"));
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.deleteFailed", "Delete failed"), t),
      );
      await load();
    }
  };

  const clearProbeResult = (key: string) => {
    setProbeResults((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOauthAvailable((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const applyProbeResult = (
    card: ServerCardState,
    result: ConnectorProbeResult,
    options: { fromSave?: boolean } = {},
  ) => {
    const fromSave = options.fromSave === true;
    if (result.ok) {
      const tools = result.tools ?? [];
      setProbeResults((prev) => ({ ...prev, [card.key]: tools }));
      setOauthAvailable((prev) => ({ ...prev, [card.key]: false }));
      if (!fromSave) {
        updateCard(card.key, { collapsed: false });
      }
      if (!fromSave) {
        if (tools.length === 0) {
          message.success(
            t("connectors.probeToolsEmpty", "Connection OK, but no tools were found"),
          );
        } else {
          message.success(t("connectors.customMcp.probeComplete", "Connection verified"));
        }
      }
      return;
    }
    setProbeResults((prev) => {
      const next = { ...prev };
      delete next[card.key];
      return next;
    });
    if (result.oauth?.available) {
      setOauthAvailable((prev) => ({ ...prev, [card.key]: true }));
      if (fromSave) {
        updateCard(card.key, { enabled: false, defaultOpen: false });
      } else {
        updateCard(card.key, {
          collapsed: false,
          enabled: false,
          defaultOpen: false,
        });
      }
      if (!fromSave) {
        message.warning(
          t(
            "connectors.customMcp.probeNeedsOAuth",
            "This MCP Need OAuth Only authorized to access",
          ),
        );
      }
      return;
    }
    setOauthAvailable((prev) => ({ ...prev, [card.key]: false }));
    if (!fromSave) {
      message.error(result.error ?? t("connectors.probeFailed", "Probe failed"));
    }
  };

  const runProbe = async (
    card: ServerCardState,
    options: { byName?: boolean; fromSave?: boolean } = {},
  ) => {
    const byName = options.byName === true;
    const fromSave = options.fromSave === true;
    setProbingKey(card.key);
    clearProbeResult(card.key);
    try {
      let result: ConnectorProbeResult;
      if (byName || card.oauthConfigured) {
        result = await connectorsApi.testCustomMcp({ name: card.name.trim() });
      } else {
        const map = cardsToServers([card]);
        const server = map[card.name.trim()];
        result = await connectorsApi.testCustomMcp({ server });
      }
      applyProbeResult(card, result, { fromSave });
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.probeFailed", "Probe failed"), t),
      );
    } finally {
      setProbingKey(null);
    }
  };

  const resolveServersForSave = (): CustomMcpServers | null => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("root must be object");
        }
        setJsonError(null);
        return parsed as CustomMcpServers;
      } catch {
        setJsonError(t("connectors.customMcp.jsonInvalid", "Invalid JSON"));
        message.error(t("connectors.customMcp.jsonInvalid", "Invalid JSON"));
        return null;
      }
    }
    try {
      return cardsToServers(cards);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "duplicate_name") {
        message.warning(
          t("connectors.customMcp.duplicateName", "Server IDs must be unique"),
        );
      } else if (code === "empty_name") {
        message.warning(
          t("connectors.customMcp.emptyName", "Server ID is required"),
        );
      } else {
        message.warning(
          apiErrorMessage(
            e,
            t("connectors.customMcp.visualInvalid", "Fix names and required fields before switching"),
            t,
          ),
        );
      }
      return null;
    }
  };

  const handleSave = async () => {
    const servers = resolveServersForSave();
    if (!servers) return;
    setSaving(true);
    try {
      const saved = await connectorsApi.putCustomMcp(servers);
      const nextCards = applySavedServers(saved.servers, cards);
      notifyConnectorsChanged();
      message.success(
        t("connectors.customMcp.saveSuccess", "Custom MCP saved"),
      );
      if (probeOnSave && showProbeSection) {
        for (const card of nextCards) {
          if (card.transport !== "streamable_http" || !card.url.trim()) {
            continue;
          }
          await runProbe(card, { byName: true, fromSave: true });
        }
      }
    } catch (e) {
      console.error(e);
      message.error(
        apiErrorMessage(e, t("connectors.customMcp.saveFailed", "Failed to save"), t),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async (card: ServerCardState) => {
    try {
      cardsToServers([card]);
    } catch {
      message.warning(
        t("connectors.customMcp.probeNeedConfig", "Fill in the configuration before probing"),
      );
      return;
    }
    await runProbe(card);
  };

  const handleOAuth = async (card: ServerCardState) => {
    const serverName = card.name.trim();
    if (!serverName) {
      message.warning(t("connectors.customMcp.emptyName", "Server ID is required"));
      return;
    }
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

    setAuthorizingKey(card.key);
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let stateId = "";

    const cleanup = () => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      window.removeEventListener("message", onMessage);
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      setAuthorizingKey(null);
      try {
        const { servers } = await connectorsApi.getCustomMcp();
        const nextCards = applySavedServers(servers, cards);
        const refreshed = nextCards.find((c) => c.name.trim() === serverName);
        if (refreshed) {
          await runProbe(refreshed, { byName: true });
        }
        message.success(
          t("connectors.oauthConfigured", "Authorized — probe or save now"),
        );
      } catch (e) {
        console.error(e);
        message.error(
          apiErrorMessage(
            e,
            t("connectors.oauthFailed", "Failed to fetch OAuth result"),
            t,
          ),
        );
      }
    };

    const claimPending = async () => {
      if (!stateId || settled) return;
      try {
        const pending = await connectorsApi.oauthPending(stateId);
        if (pending.applied || pending.server_name) {
          await finish();
        }
      } catch {
        // keep polling until timeout
      }
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type !== "octop:connector-oauth") return;
      if (ev.data.state_id !== stateId) return;
      void claimPending();
    };

    try {
      const servers = resolveServersForSave();
      if (!servers) {
        try {
          popup.close();
        } catch {
          // ignore
        }
        setAuthorizingKey(null);
        return;
      }
      const saved = await connectorsApi.putCustomMcp(servers);
      applySavedServers(saved.servers, cards);
      notifyConnectorsChanged();

      const { authorize_url, state_id } = await connectorsApi.oauthStart(
        { type: "custom_mcp", server_name: serverName },
        window.location.pathname,
      );
      stateId = state_id;
      window.addEventListener("message", onMessage);
      pollTimer = setInterval(() => {
        void claimPending();
      }, 1200);
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        setAuthorizingKey(null);
        message.error(
          t("connectors.oauthTimedOut", "Authorization timed out; try one-click auth again"),
        );
      }, 120_000);
      popup.location.replace(authorize_url);
    } catch (e) {
      cleanup();
      setAuthorizingKey(null);
      try {
        popup.close();
      } catch {
        // ignore
      }
      message.error(
        apiErrorMessage(
          e,
          t("connectors.oauthStartFailed", "Could not start OAuth"),
          t,
        ),
      );
    }
  };

  const transportOptions = useMemo(
    () => [
      { value: "streamable_http", label: "streamable_http" },
      { value: "stdio", label: "stdio" },
    ],
    [],
  );

  const showProbeSection = useMemo(() => {
    if (mode === "visual") {
      return hasHttpProbeTargets(cards);
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }
      return hasHttpProbeTargets(parsed as CustomMcpServers);
    } catch {
      return false;
    }
  }, [mode, cards, jsonText]);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spin />
      </div>
    );
  }

  const saveFooter = (
    <div
      className={`${styles.customMcpFooter}${
        showProbeSection ? "" : ` ${styles.customMcpFooterSaveOnly}`
      }`}
    >
      {showProbeSection ? (
        <div className={styles.customMcpFooterMain}>
          <Checkbox
            checked={probeOnSave}
            onChange={(e) => setProbeOnSave(e.target.checked)}
          >
            {t("connectors.customMcp.probeOnSave", "Probe connection after save")}
          </Checkbox>
          <p className={styles.customMcpFooterHint}>
            {t(
              "connectors.customMcp.probeOnSaveHint",
              "Will be filled in to you MCP Address to initiate a request to verify availability; if login is required, you will be guided through OAuth.",
            )}
          </p>
        </div>
      ) : null}
      <Button
        type="primary"
        className={styles.customMcpFooterSave}
        loading={saving}
        onClick={() => void handleSave()}
      >
        {t("common.save")}
      </Button>
    </div>
  );

  return (
    <div className={styles.customMcpTab}>
      <div className={styles.customMcpIntro}>
        <div className={styles.customMcpIntroTitle}>
          {t(
            "connectors.customMcp.introTitle",
            "MCP Server configuration (JSON Format). Refer to the following format:",
          )}
        </div>
        <pre className={styles.customMcpExample}>{EXAMPLE_JSON}</pre>
      </div>

      <div className={styles.customMcpToolbar}>
        <Segmented
          value={mode}
          onChange={(value) => handleModeChange(value as EditorMode)}
          options={[
            {
              value: "visual",
              label: t("connectors.customMcp.modeVisual", "Visual"),
            },
            {
              value: "json",
              label: t("connectors.customMcp.modeJson", "</> JSON"),
            },
          ]}
        />
      </div>

      {mode === "json" ? (
        <>
          <div className={styles.customMcpPanel}>
            <div className={styles.customMcpJsonEditor}>
              <Input.TextArea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError(null);
                }}
                autoSize={{ minRows: 16, maxRows: 32 }}
                className={styles.customMcpJsonArea}
                spellCheck={false}
              />
              {jsonError ? (
                <div className={styles.customMcpJsonError}>{jsonError}</div>
              ) : null}
            </div>
          </div>
          {saveFooter}
        </>
      ) : (
        <>
          <div className={styles.customMcpPanel}>
            <div className={styles.customMcpAddRow}>
              <button
                type="button"
                className={styles.customMcpAddBtn}
                onClick={() => handleAdd("streamable_http")}
              >
                <Globe size={18} />
                <span>
                  {t("connectors.customMcp.addHttp", "Add HTTP Server")}
                </span>
                <Plus size={16} />
              </button>
              <button
                type="button"
                className={styles.customMcpAddBtn}
                onClick={() => handleAdd("stdio")}
              >
                <Terminal size={18} />
                <span>
                  {t("connectors.customMcp.addStdio", "Add Stdio Server")}
                </span>
                <Plus size={16} />
              </button>
            </div>

            <div className={styles.customMcpListSection}>
              <div className={styles.customMcpListTitle}>
                {t("connectors.customMcp.listTitle", "Configured servers")}
                {cards.length > 0 ? (
                  <span className={styles.customMcpListCount}>
                    {cards.length}
                  </span>
                ) : null}
              </div>

              {cards.length === 0 ? (
                <div className={styles.customMcpEmpty}>
                  {t(
                    "connectors.customMcp.emptyList",
                    "No customizations added yet MCP, click the button above to start configuration",
                  )}
                </div>
              ) : (
                <div className={styles.customMcpGrid}>
                  {cards.map((card) => (
                    <CustomMcpServerCard
                      key={card.key}
                      card={card}
                      probing={probingKey === card.key}
                      authorizing={authorizingKey === card.key}
                      oauthAvailable={oauthAvailable[card.key] === true}
                      probeTools={probeResults[card.key]}
                      transportOptions={transportOptions}
                      onUpdate={updateCard}
                      onToggleEnabled={(enabled) => {
                        if (
                          oauthAvailable[card.key] &&
                          !card.oauthConfigured &&
                          enabled
                        ) {
                          message.warning(
                            t(
                              "connectors.customMcp.oauthBeforeEnable",
                              "Please complete first OAuth Enable after authorization",
                            ),
                          );
                          return;
                        }
                        void persistServerPatch(
                          card,
                          {
                            enabled,
                            ...(enabled ? {} : { default_open: false }),
                          },
                          {
                            enabled,
                            ...(enabled ? {} : { defaultOpen: false }),
                          },
                        );
                      }}
                      onDefaultOpenChange={(defaultOpen) => {
                        void persistServerPatch(
                          card,
                          { default_open: defaultOpen },
                          { defaultOpen },
                        );
                      }}
                      onSharedChange={(shared) => {
                        void persistServerPatch(card, { shared }, { shared });
                      }}
                      onRemove={() => handleRemove(card.key)}
                      onProbe={() => void handleProbe(card)}
                      onAuthorize={() => void handleOAuth(card)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          {saveFooter}
        </>
      )}
    </div>
  );
}
