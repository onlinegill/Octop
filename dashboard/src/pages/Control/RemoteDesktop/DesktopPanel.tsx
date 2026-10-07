import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";

import {
  CheckCircle2,
  Copy,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Monitor,
  PlugZap,
  RefreshCw,
  Terminal,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import StreamConnectingIndicator from "../../../components/StreamConnectingIndicator";
import StreamEdgeControls from "../../../components/StreamEdgeControls/StreamEdgeControls";
import StreamSetupGuide from "../../../components/StreamSetupGuide/StreamSetupGuide";
import ForbiddenPage from "../../../components/ForbiddenPage";
import PageShell from "../../../layouts/PageShell";
import {
  desktopApi,
  type DesktopStatusResponse,
} from "../../../api/modules/desktop";
import {
  paintBase64JpegToCanvas,
  clearCanvas,
} from "../../../utils/browserCanvas";
import {
  useDesktopStream,
  type DesktopStreamError,
} from "../../../hooks/useDesktopStream";
import {
  useDesktopInstall,
  startDesktopInstall,
  cancelDesktopInstall,
  resetDesktopInstall,
  type DesktopInstallPhase,
} from "../../../hooks/useDesktopInstall";
import { useDesktopCanvasInteraction } from "../../../hooks/useDesktopCanvasInteraction";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { useLandscapeFullscreen } from "../../../hooks/useLandscapeFullscreen";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { userCan } from "../../../utils/permissions";
import { copyText } from "../../../utils/copyText";
import { showApiError } from "../../../utils/showApiToast";
import { wsStreamErrorMessage } from "../../../utils/apiError";
import {
  DESKTOP_FPS_PRESETS,
  DESKTOP_RESOLUTION_OPTIONS,
  desktopFpsLabel,
  desktopResolutionLabel,
  isDesktopResolution,
  type DesktopResolution,
} from "../../../utils/desktopViewport";
import { sendDesktopAction } from "./desktopShortcuts";
import { OctopEmptyMascot } from "../../../components/EmptyState";
import styles from "./DesktopPanel.module.less";

const RESOLUTION_STORAGE_KEY = "octop:remote-desktop:resolution";
const FPS_STORAGE_KEY = "octop:remote-desktop:max-fps";
const DEFAULT_RESOLUTION: DesktopResolution = "1920x1080";
const DEFAULT_MAX_FPS = 10;

type DesktopPanelProps = {
  /** Skip PageShell when mounted inside the remote-desktop hub. */
  embedded?: boolean;
  /** When false (hidden hub tab), pause the live stream. */
  isVisible?: boolean;
};

export default function DesktopPanel({
  embedded = false,
  isVisible = true,
}: DesktopPanelProps) {
  const { t } = useTranslation();
  const { modal, message } = App.useApp();
  const user = useCurrentUser();
  const canDesktop = userCan(user, "desktop");
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const uninstallAbortRef = useRef<AbortController | null>(null);
  const installLogRef = useRef<HTMLDivElement | null>(null);
  const streamDesiredRef = useRef(false);

  const [envStatus, setEnvStatus] = useState<DesktopStatusResponse | null>(
    null,
  );
  const [envLoading, setEnvLoading] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const openControlsDrawer = useCallback(() => setControlsOpen(true), []);
  const closeControlsDrawer = useCallback(() => setControlsOpen(false), []);
  const { phase: installPhase, logs: installLogs } = useDesktopInstall();
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallLogs, setUninstallLogs] = useState<string[]>([]);
  const [screenSize, setScreenSize] = useState({ width: 1920, height: 1080 });
  const screenSizeRef = useRef({ width: 1920, height: 1080 });
  const [resolution, setResolution] = useState<DesktopResolution>(() => {
    try {
      const saved = localStorage.getItem(RESOLUTION_STORAGE_KEY);
      if (saved && isDesktopResolution(saved)) return saved;
    } catch {
      // ignore
    }
    return DEFAULT_RESOLUTION;
  });
  const [maxFps, setMaxFps] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(FPS_STORAGE_KEY);
      if (saved) {
        const n = Number(saved);
        if (DESKTOP_FPS_PRESETS.some((v) => v === n)) return n;
      }
    } catch {
      // ignore
    }
    return DEFAULT_MAX_FPS;
  });
  const [geometryBusy, setGeometryBusy] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const { status, connect, sendEvent, disconnect } = useDesktopStream();

  const setupInstalled = envStatus?.setup_state === "ready";
  const envReady = Boolean(setupInstalled && envStatus?.ok);
  const permissionLabels = (envStatus?.permissions_needed ?? []).map((p) =>
    p === "screen_recording"
      ? t("remoteDesktop.permScreenRecording", "Screen Recording")
      : p === "accessibility"
      ? t("remoteDesktop.permAccessibility", "Accessibility")
      : p,
  );
  const needsMacPermissions =
    Boolean(setupInstalled) &&
    envStatus?.platform === "darwin" &&
    (envStatus?.permissions_needed?.length ?? 0) > 0;
  const canUninstall =
    Boolean(envStatus) &&
    envStatus?.setup_state !== "deps_missing" &&
    envStatus?.setup_state !== "unsupported";
  const isStreaming =
    status === "streaming" ||
    status === "connecting" ||
    status === "reconnecting";
  const showStream = isStreaming;
  const showEdgeControls = status === "streaming" && frameReady;

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") {
      setFrameReady(false);
      clearCanvas(canvasRef.current);
    } else if (
      status === "idle" ||
      status === "stopped" ||
      status === "error"
    ) {
      setFrameReady(false);
      clearCanvas(canvasRef.current);
    }
  }, [status]);

  const requireStream = useCallback(() => {
    if (status === "streaming") return true;
    message.info(t("remoteDesktop.shortcutsNeedConnect", "Connect to the remote desktop first"));
    return false;
  }, [status, t]);

  const refreshEnv = useCallback(async () => {
    setEnvLoading(true);
    try {
      const data = await desktopApi.status();
      setEnvStatus(data);
      return data;
    } catch (err) {
      showApiError(
        err,
        t("remoteDesktop.statusFailed", "Failed to load remote desktop status"),
        t,
      );
      return null;
    } finally {
      setEnvLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canDesktop) {
      void refreshEnv();
    }
  }, [canDesktop, refreshEnv]);

  useEffect(() => {
    if (installLogRef.current) {
      installLogRef.current.scrollTop = installLogRef.current.scrollHeight;
    }
  }, [installLogs]);

  useEffect(
    () => () => {
      uninstallAbortRef.current?.abort();
    },
    [],
  );

  // React to install completion. The install runs in a module-level store, so
  // this fires whenever a mounted page observes the terminal phase — including
  // after navigating back to the page while an install was in progress.
  const prevInstallPhaseRef = useRef<DesktopInstallPhase>(installPhase);
  useEffect(() => {
    const prev = prevInstallPhaseRef.current;
    prevInstallPhaseRef.current = installPhase;
    if (installPhase === "install_success") {
      setEnvModalOpen(false);
      void refreshEnv();
      if (prev === "installing") {
        message.success(t("remoteDesktop.installSuccess", "Desktop environment is ready"));
      }
      resetDesktopInstall();
    } else if (installPhase === "install_failed") {
      setEnvModalOpen(true);
    }
  }, [installPhase, refreshEnv, t]);

  const startInstall = useCallback(() => {
    startDesktopInstall();
    setEnvModalOpen(false);
  }, []);

  const handleUninstall = useCallback(() => {
    if (!canUninstall || uninstalling) return;
    const confirmText = envStatus?.native_capture
      ? t(
          "remoteDesktop.uninstallConfirmNative",
          "Will remove the remote desktop required Python Component, continue?",
        )
      : t(
          "remoteDesktop.uninstallConfirmLinux",
          "The virtual desktop service will be stopped and installed components removed. Do you want to continue?",
        );
    modal.confirm({
      title: t("remoteDesktop.uninstallTitle", "Uninstall remote desktop"),
      content: confirmText,
      okText: t("remoteDesktop.uninstall", "Uninstall"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () =>
        new Promise<void>((resolve, reject) => {
          if (isStreaming) {
            disconnect();
          }
          setUninstalling(true);
          setUninstallLogs([]);
          const hide = message.loading(
            t("remoteDesktop.uninstalling", "Uninstalling…"),
            0,
          );
          uninstallAbortRef.current = desktopApi.uninstallDesktop(
            (line) => setUninstallLogs((prev) => [...prev, line]),
            (success) => {
              uninstallAbortRef.current = null;
              setUninstalling(false);
              hide();
              void refreshEnv().then((data) => {
                const removed =
                  success ||
                  data?.setup_state === "deps_missing" ||
                  data?.setup_state === "needs_install";
                if (removed) {
                  setUninstallLogs([]);
                  message.success(
                    t("remoteDesktop.uninstallSuccess", "Remote desktop uninstalled"),
                  );
                  resolve();
                  return;
                }
                message.error(t("remoteDesktop.uninstallFailed", "Uninstall failed"));
                reject(new Error("uninstall failed"));
              });
            },
          );
        }),
    });
  }, [
    canUninstall,
    disconnect,
    envStatus?.native_capture,
    isStreaming,
    refreshEnv,
    t,
    uninstalling,
  ]);

  const openEnvModal = useCallback(() => {
    setEnvModalOpen(true);
    if (installPhase !== "installing") {
      resetDesktopInstall();
    }
    void refreshEnv();
  }, [installPhase, refreshEnv]);

  const closeEnvModal = useCallback(() => {
    setEnvModalOpen(false);
    if (
      installPhase === "install_success" ||
      installPhase === "install_failed"
    ) {
      void refreshEnv();
    }
  }, [installPhase, refreshEnv]);

  useEffect(() => {
    if (envStatus?.geometry && isDesktopResolution(envStatus.geometry)) {
      setResolution(envStatus.geometry);
    }
  }, [envStatus?.geometry]);

  const streamCallbacks = useCallback(
    () => ({
      onFrame: (data: string, width: number, height: number) => {
        setFrameReady(true);
        if (width > 0 && height > 0) {
          const prev = screenSizeRef.current;
          if (prev.width !== width || prev.height !== height) {
            screenSizeRef.current = { width, height };
            setScreenSize({ width, height });
          }
        }
        paintBase64JpegToCanvas(canvasRef.current, data);
      },
      onError: (err: DesktopStreamError) =>
        message.error(
          wsStreamErrorMessage(
            err,
            t("remoteDesktop.streamError", "Remote desktop connection failed"),
            t,
          ),
        ),
      onActionResult: ({ ok }: { ok: boolean }) => {
        if (!ok) {
          message.error(t("remoteDesktop.shortcutFailed", "Failed to run shortcut"));
        }
      },
    }),
    [t],
  );

  const startStream = useCallback(() => {
    connect(streamCallbacks(), { quality: 80, maxFps });
  }, [connect, maxFps, streamCallbacks]);

  const applyResolution = useCallback(
    async (value: DesktopResolution) => {
      setResolution(value);
      try {
        localStorage.setItem(RESOLUTION_STORAGE_KEY, value);
      } catch {
        // ignore
      }
      if (envStatus?.platform !== "linux") return;
      setGeometryBusy(true);
      try {
        await desktopApi.setGeometry(value);
        await refreshEnv();
        if (isStreaming) startStream();
      } catch (err) {
        showApiError(
          err,
          t("remoteDesktop.geometryFailed", "Failed to change resolution"),
          t,
        );
      } finally {
        setGeometryBusy(false);
      }
    },
    [envStatus?.platform, isStreaming, refreshEnv, startStream, t],
  );

  const handleResolutionChange = useCallback(
    (value: DesktopResolution) => {
      if (envStatus?.platform === "linux" && isStreaming) {
        modal.confirm({
          title: t("remoteDesktop.geometryRestartTitle", "Change resolution"),
          content: t(
            "remoteDesktop.geometryRestartWarning",
            "The virtual desktop will be restarted and current connections will be briefly interrupted.",
          ),
          okText: t("common.confirm", "Confirm"),
          cancelText: t("common.cancel", "Cancel"),
          onOk: () => applyResolution(value),
        });
        return;
      }
      void applyResolution(value);
    },
    [applyResolution, envStatus?.platform, isStreaming, t],
  );

  const handleFpsChange = useCallback(
    (fps: number) => {
      setMaxFps(fps);
      try {
        localStorage.setItem(FPS_STORAGE_KEY, String(fps));
      } catch {
        // ignore
      }
      if (isStreaming) {
        connect(streamCallbacks(), { quality: 80, maxFps: fps });
      }
    },
    [connect, isStreaming, streamCallbacks],
  );

  const handleEvent = useCallback(
    (event: Record<string, unknown>) => {
      sendEvent(event);
    },
    [sendEvent],
  );

  const interaction = useDesktopCanvasInteraction({
    enabled: status === "streaming" && frameReady,
    canvasRef,
    screenWidth: screenSize.width,
    screenHeight: screenSize.height,
    onEvent: handleEvent,
  });

  const handleConnect = useCallback(() => {
    if (!envReady) {
      if (needsMacPermissions) {
        message.warning(
          t(
            "remoteDesktop.connectDisabledPerms",
            "Please enable screen recording and accessibility permissions in system settings first, and then restart Octop",
          ),
        );
        return;
      }
      openEnvModal();
      return;
    }
    streamDesiredRef.current = true;
    startStream();
  }, [envReady, needsMacPermissions, openEnvModal, startStream, t]);

  const handleDisconnect = useCallback(() => {
    streamDesiredRef.current = false;
    disconnect();
    clearCanvas(canvasRef.current);
  }, [disconnect]);

  // Pause/resume when the hub tab is hidden so phone/desktop don't stream at once.
  useEffect(() => {
    if (!isVisible) {
      disconnect();
      clearCanvas(canvasRef.current);
      return;
    }
    if (streamDesiredRef.current && envReady) {
      startStream();
    }
  }, [isVisible, disconnect, startStream, envReady]);

  const handleRefreshStream = useCallback(() => {
    if (!requireStream()) return;
    startStream();
    message.success(t("remoteDesktop.refreshStreamDone", "Stream refreshed"));
  }, [requireStream, startStream, t]);

  const handleFullscreen = useLandscapeFullscreen(viewportRef, {
    isMobile,
    onError: () =>
      message.error(t("remoteDesktop.fullscreenFailed", "Could not enter fullscreen")),
  });

  const runShortcut = useCallback(
    (action: Parameters<typeof sendDesktopAction>[1]) => {
      if (!requireStream()) return;
      if (!sendDesktopAction(sendEvent, action)) {
        message.error(t("remoteDesktop.shortcutFailed", "Failed to run shortcut"));
      }
    },
    [requireStream, sendEvent, t],
  );

  const handleShowDesktop = useCallback(() => {
    runShortcut("show_desktop");
  }, [runShortcut]);

  const handleOpenMenu = useCallback(() => {
    runShortcut("open_menu");
  }, [runShortcut]);

  const handleOpenTerminal = useCallback(() => {
    runShortcut("open_terminal");
  }, [runShortcut]);

  const handleOpenFiles = useCallback(() => {
    runShortcut("open_files");
  }, [runShortcut]);

  const handleCloseWindow = useCallback(() => {
    runShortcut("close_window");
  }, [runShortcut]);

  type ShortcutTone =
    | "blue"
    | "emerald"
    | "violet"
    | "amber"
    | "rose"
    | "orange";

  const shortcutIconToneClass: Record<ShortcutTone, string> = {
    blue: styles.shortcutIconBlue,
    emerald: styles.shortcutIconEmerald,
    violet: styles.shortcutIconViolet,
    amber: styles.shortcutIconAmber,
    rose: styles.shortcutIconRose,
    orange: styles.shortcutIconOrange,
  };

  const shortcutItems = useMemo(
    () => [
      {
        id: "showDesktop",
        label: t("remoteDesktop.showDesktop", "Show desktop"),
        icon: LayoutGrid,
        tone: "blue" as const,
        onClick: handleShowDesktop,
      },
      {
        id: "openTerminal",
        label: t("remoteDesktop.openTerminal", "Terminal"),
        icon: Terminal,
        tone: "emerald" as const,
        onClick: handleOpenTerminal,
      },
      {
        id: "openMenu",
        label: t("remoteDesktop.openMenu", "App menu"),
        icon: Monitor,
        tone: "violet" as const,
        onClick: handleOpenMenu,
      },
      {
        id: "openFiles",
        label: t("remoteDesktop.openFiles", "Files"),
        icon: FolderOpen,
        tone: "amber" as const,
        onClick: handleOpenFiles,
      },
      {
        id: "closeWindow",
        label: t("remoteDesktop.closeWindow", "Close window"),
        icon: X,
        tone: "rose" as const,
        onClick: handleCloseWindow,
      },
      {
        id: "refreshStream",
        label: t("remoteDesktop.refreshStream", "Refresh"),
        icon: RefreshCw,
        tone: "orange" as const,
        onClick: handleRefreshStream,
        disabled: !isStreaming,
      },
    ],
    [
      t,
      handleShowDesktop,
      handleOpenTerminal,
      handleOpenMenu,
      handleOpenFiles,
      handleCloseWindow,
      handleRefreshStream,
      isStreaming,
    ],
  );

  const renderControlsContent = () => (
    <div className={styles.drawerContent}>
      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <span className={styles.settingsCardTitle}>
            {t("remoteDesktop.streamSettings", "Stream settings")}
          </span>
          {isStreaming ? (
            <Tag color="success" style={{ margin: 0 }}>
              {status === "streaming"
                ? t("remoteDesktop.streaming", "Streaming")
                : status === "reconnecting"
                ? t("remoteDesktop.reconnecting", "Reconnecting")
                : t("remoteDesktop.connecting", "Connecting")}
            </Tag>
          ) : (
            <Tag style={{ margin: 0 }}>{t("remoteDesktop.idle", "Disconnected")}</Tag>
          )}
        </div>
        <div className={styles.settingsGrid}>
          {envStatus?.platform === "linux" ? (
            <div className={styles.settingItem}>
              <span className={styles.settingLabel}>
                {t("remoteDesktop.resolution", "Resolution")}
              </span>
              <Select
                size="middle"
                className={styles.settingSelectFull}
                value={resolution}
                disabled={geometryBusy}
                onChange={(v) => handleResolutionChange(v)}
                options={DESKTOP_RESOLUTION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: desktopResolutionLabel(o.value),
                }))}
              />
            </div>
          ) : null}
          <div className={styles.settingItem}>
            <span className={styles.settingLabel}>
              {t("remoteDesktop.streamFps", "Frame rate")}
            </span>
            <Select
              size="middle"
              className={styles.settingSelectFull}
              value={maxFps}
              onChange={handleFpsChange}
              options={DESKTOP_FPS_PRESETS.map((fps) => ({
                value: fps,
                label: desktopFpsLabel(fps),
              }))}
            />
          </div>
        </div>
      </div>

      {isMobile && (
        <Button
          block
          icon={<Maximize2 size={14} />}
          onClick={() => {
            closeControlsDrawer();
            void handleFullscreen();
          }}
        >
          {t("remoteDesktop.fullscreen", "Fullscreen")}
        </Button>
      )}

      <div className={styles.shortcutsCard}>
        <div className={styles.shortcutsCardHeader}>
          <span className={styles.shortcutsTitle}>
            {t("remoteDesktop.shortcuts", "Shortcuts")}
          </span>
        </div>
        <div className={styles.shortcutsList}>
          {shortcutItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={styles.shortcutRow}
                onClick={item.onClick}
                disabled={item.disabled}
              >
                <span
                  className={`${styles.shortcutIcon} ${
                    shortcutIconToneClass[item.tone]
                  }`}
                >
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className={styles.shortcutLabel}>{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.hintText}>
          {t(
            "remoteDesktop.mobileHint",
            "Click on the screen to control the remote desktop; shortcut buttons will send commonly used shortcut keys.",
          )}
        </p>
      </div>
    </div>
  );

  const cancelInstall = useCallback(() => {
    cancelDesktopInstall();
    message.info(
      t(
        "remoteDesktop.installCancelHint",
        "The installation request has been cancelled. The server may still be installing. Please refresh the status later.",
      ),
    );
  }, [t]);

  const handleCopyInstallLog = useCallback(async () => {
    const title = t("remoteDesktop.installFailed", "Installation failed");
    const hint = t("remoteDesktop.installFailedHint");
    const logBody =
      installLogs.length > 0
        ? installLogs.join("\n")
        : t("common.installLogEmpty");
    const payload = `${title}\n${hint}\n\n${logBody}`;
    const ok = await copyText(payload);
    if (ok) {
      message.success(t("common.copied", "Copied to clipboard"));
    } else {
      message.error(t("common.copyFailed", "Failed to copy to clipboard"));
    }
  }, [installLogs, t]);

  const renderInstallLog = (
    maxHeight?: number,
    extraClass?: string,
    emptyLabel?: string,
  ) => (
    <div
      ref={installLogRef}
      className={`${styles.installLog} ${extraClass ?? ""}`}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {installLogs.length === 0 ? (
        <div>
          {emptyLabel ?? t("remoteDesktop.installing", "Starting installation...")}
        </div>
      ) : (
        installLogs.map((line, i) => <div key={i}>{line}</div>)
      )}
    </div>
  );

  const renderViewportUninstallProgress = () => (
    <div className={styles.installProgress}>
      <RefreshCw size={32} className={styles.streamLoadingIcon} />
      <div className={styles.installProgressTitle}>
        {t("remoteDesktop.uninstalling", "Uninstalling…")}
      </div>
      <div className={styles.installLog}>
        {uninstallLogs.length === 0 ? (
          <div>{t("remoteDesktop.uninstalling", "Uninstalling…")}</div>
        ) : (
          uninstallLogs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );

  const renderViewportInstallProgress = () => (
    <div className={styles.installProgress}>
      <RefreshCw size={32} className={styles.streamLoadingIcon} />
      <div className={styles.installProgressTitle}>
        {t("remoteDesktop.installProgress", "Installing…")}
      </div>
      {renderInstallLog()}
      <div className={styles.installProgressActions}>
        <Button onClick={cancelInstall}>{t("common.cancel")}</Button>
      </div>
    </div>
  );

  const renderEnvModalContent = () => {
    if (envLoading && installPhase === "idle") {
      return (
        <div style={{ textAlign: "center", padding: 24 }}>
          {t("remoteDesktop.checking", "Checking desktop environment...")}
        </div>
      );
    }

    if (installPhase === "installing") {
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message={t("remoteDesktop.resourceWarningTitle", "Resource usage notice")}
            description={t("remoteDesktop.resourceWarningDesc")}
          />
          {renderInstallLog()}
        </Space>
      );
    }

    if (installPhase === "install_success") {
      return (
        <Result
          icon={
            <CheckCircle2 size={40} color="var(--fn-color-success,#52c41a)" />
          }
          title={t("remoteDesktop.installSuccess", "Desktop environment is ready")}
          subTitle={t("remoteDesktop.installSuccessHint")}
          style={{ padding: "8px 0" }}
        />
      );
    }

    if (installPhase === "install_failed") {
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Result
            icon={<Terminal size={40} color="var(--fn-color-error,#ff4d4f)" />}
            title={t("remoteDesktop.installFailed", "Installation failed")}
            subTitle={t("remoteDesktop.installFailedHint")}
            style={{ padding: "8px 0" }}
          />
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--fn-text-tertiary)" }}>
                {t("remoteDesktop.installLog", "Installation log")}
              </span>
              <Button
                size="small"
                icon={<Copy size={14} />}
                onClick={() => void handleCopyInstallLog()}
              >
                {t("common.copyErrorForOctop", "Copy error details")}
              </Button>
            </div>
            {renderInstallLog(
              160,
              styles.installLogCompact,
              t("common.installLogEmpty"),
            )}
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--fn-text-secondary)",
              }}
            >
              {t(
                "common.askOctopHint",
                "If the installation fails, you can copy the error message below and send it to Octop Check.",
              )}
            </div>
          </div>
        </Space>
      );
    }

    if (needsMacPermissions) {
      return (
        <Alert
          type="warning"
          showIcon
          message={t(
            "remoteDesktop.macPermissionsTitle",
            "Need macOS System permissions",
          )}
          description={t("remoteDesktop.macPermissionsDesc", {
            permissions: permissionLabels.join(
              t("remoteDesktop.permJoin", ","),
            ),
          })}
        />
      );
    }

    if (envReady) {
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Result
            icon={
              <CheckCircle2 size={40} color="var(--fn-color-success,#52c41a)" />
            }
            title={t("remoteDesktop.envReady", "Desktop environment is ready")}
            subTitle={
              envStatus?.display
                ? t("remoteDesktop.displayReady", {
                    display: envStatus.display,
                  })
                : undefined
            }
            style={{ padding: "8px 0" }}
          />
          {envStatus?.native_capture ? (
            <Alert
              type="info"
              showIcon
              message={t("remoteDesktop.nativeReadyTitle", "Host desktop ready")}
              description={t(
                "remoteDesktop.nativeReadyDesc",
                "The local screen will be captured directly and injected into the keyboard and mouse without installing a virtual desktop.",
              )}
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message={t("remoteDesktop.resourceInfoTitle", "About resource usage")}
              description={t("remoteDesktop.resourceInfoDesc")}
            />
          )}
        </Space>
      );
    }

    return (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message={t("remoteDesktop.resourceWarningTitle", "Resource usage notice")}
          description={t("remoteDesktop.resourceWarningDesc")}
        />
      </Space>
    );
  };

  const envModalFooter = () => {
    if (installPhase === "installing") {
      return (
        <Button onClick={closeEnvModal}>
          {t("remoteDesktop.hideInstall", "Hide progress")}
        </Button>
      );
    }
    if (installPhase === "install_failed") {
      return (
        <Space>
          <Button onClick={closeEnvModal}>{t("common.close")}</Button>
          <Button type="primary" onClick={startInstall}>
            {t("remoteDesktop.installRetry", "Retry installation")}
          </Button>
        </Space>
      );
    }
    if (installPhase === "install_success") {
      return (
        <Button type="primary" onClick={closeEnvModal}>
          {t("common.close")}
        </Button>
      );
    }
    if (needsMacPermissions) {
      return (
        <Space>
          <Button onClick={closeEnvModal}>{t("common.close")}</Button>
          <Button
            type="primary"
            loading={envLoading}
            onClick={() => void refreshEnv()}
          >
            {t("remoteDesktop.recheck", "Recheck")}
          </Button>
        </Space>
      );
    }
    if (!envReady) {
      return (
        <Space>
          <Button onClick={closeEnvModal}>{t("common.close")}</Button>
          <Button type="primary" onClick={startInstall}>
            {envStatus?.native_capture
              ? t("remoteDesktop.installDeps", "Install dependencies")
              : t("remoteDesktop.install", "Install desktop environment")}
          </Button>
        </Space>
      );
    }
    return (
      <Button type="primary" onClick={closeEnvModal}>
        {t("common.close")}
      </Button>
    );
  };

  const pageTitle = t("nav.remoteDesktop", "Remote Desktop");
  const pageSubtitle = t(
    "pageShell.desktop.subtitle",
    "View and control Octop Host operating system desktop",
  );
  const setupMascot = <OctopEmptyMascot />;

  if (user === null) {
    const loading = (
      <div className={styles.roleGate}>
        <Spin size="large" />
      </div>
    );
    if (embedded) {
      return <div className={styles.embeddedRoot}>{loading}</div>;
    }
    return (
      <PageShell title={pageTitle} subtitle={pageSubtitle} fill>
        {loading}
      </PageShell>
    );
  }

  if (!canDesktop) {
    return <ForbiddenPage />;
  }

  const headerActions = isStreaming ? (
    <Space size={8} wrap>
      <Tooltip title={t("remoteDesktop.disconnect", "Disconnect")}>
        <Button
          size={isMobile ? "small" : "middle"}
          danger
          icon={<Unplug size={14} />}
          onClick={handleDisconnect}
          aria-label={t("remoteDesktop.disconnect", "Disconnect")}
        >
          {!isMobile && t("remoteDesktop.disconnect", "Disconnect")}
        </Button>
      </Tooltip>
    </Space>
  ) : undefined;

  const checkGuideAction = needsMacPermissions
    ? {
        label: t("remoteDesktop.recheck", "Recheck"),
        onClick: () => void refreshEnv(),
        icon: <RefreshCw size={14} />,
        loading: envLoading,
        type: "default" as const,
      }
    : {
        label: t("remoteDesktop.checkInstallShort", "Check"),
        onClick: openEnvModal,
        icon: <Monitor size={14} />,
        type: "default" as const,
        title: t("remoteDesktop.checkInstallTip"),
      };

  const connectGuideAction = {
    label: t("remoteDesktop.connect", "Connect"),
    onClick: handleConnect,
    icon: <PlugZap size={14} />,
    disabled: !envReady,
    title: envReady
      ? undefined
      : needsMacPermissions
      ? t(
          "remoteDesktop.connectDisabledPerms",
          "Please enable screen recording and accessibility permissions in system settings first, and then restart Octop",
        )
      : t("remoteDesktop.connectDisabled"),
  };

  const uninstallGuideAction = canUninstall
    ? {
        label: t("remoteDesktop.uninstall", "Uninstall"),
        onClick: handleUninstall,
        icon: <Trash2 size={14} />,
        loading: uninstalling,
        disabled: uninstalling || envLoading,
        danger: true,
        type: "default" as const,
      }
    : undefined;

  const pageBody = (
    <>
      <Modal
        title={t("remoteDesktop.checkInstall", "Check desktop")}
        open={envModalOpen}
        onCancel={closeEnvModal}
        footer={envModalFooter()}
        width={isMobile ? "100%" : 560}
        style={isMobile ? { top: 20, maxWidth: "100vw" } : undefined}
        destroyOnHidden
        maskClosable={installPhase !== "installing"}
      >
        {renderEnvModalContent()}
      </Modal>

      <div className={styles.remoteDesktopPage}>
        {embedded && headerActions ? (
          <div className={styles.embeddedActions}>{headerActions}</div>
        ) : null}
        {needsMacPermissions && !showStream && (
          <Alert
            type="warning"
            showIcon
            message={t(
              "remoteDesktop.macPermissionsTitle",
              "Need macOS System permissions",
            )}
            description={t("remoteDesktop.macPermissionsDesc", {
              permissions: permissionLabels.join(
                t("remoteDesktop.permJoin", ","),
              ),
            })}
            style={{ marginBottom: 12 }}
            action={
              <Button
                size="small"
                loading={envLoading}
                onClick={() => void refreshEnv()}
              >
                {t("remoteDesktop.recheck", "Recheck")}
              </Button>
            }
          />
        )}
        {envReady && !showStream && envStatus?.native_capture && (
          <Alert
            type="success"
            showIcon
            message={t("remoteDesktop.nativeReadyTitle", "Host desktop ready")}
            description={t(
              "remoteDesktop.nativeReadyDesc",
              "The local screen will be captured directly and injected into the keyboard and mouse without installing a virtual desktop.",
            )}
          />
        )}
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${
            isMobile ? styles.viewportMobile : ""
          }`}
        >
          {!showStream ? (
            installPhase === "installing" ? (
              renderViewportInstallProgress()
            ) : uninstalling ? (
              renderViewportUninstallProgress()
            ) : (
              <StreamSetupGuide
                plain
                icon={setupMascot}
                title={
                  envReady
                    ? t("remoteDesktop.connectTitle", "Connect to remote desktop")
                    : needsMacPermissions
                    ? t(
                        "remoteDesktop.macPermissionsTitle",
                        "Need macOS System permissions",
                      )
                    : t("remoteDesktop.subtitle", "Control the Octop host operating system desktop")
                }
                description={
                  envReady
                    ? t(
                        "remoteDesktop.connectIdleDesc",
                        "Click “Connect” below to start controlling the host desktop in real time",
                      )
                    : needsMacPermissions
                    ? t("remoteDesktop.macPermissionsGuideDesc", {
                        permissions: permissionLabels.join(
                          t("remoteDesktop.permJoin", ","),
                        ),
                      })
                    : t(
                        "remoteDesktop.setupDesc",
                        "Follow the steps below to complete the environment configuration and you can remotely control the host desktop in the browser",
                      )
                }
                steps={
                  envReady
                    ? [
                        {
                          label: t(
                            "remoteDesktop.idleStep1",
                            "Click “Connect” to establish a remote desktop session",
                          ),
                        },
                        {
                          label: t(
                            "remoteDesktop.idleStep2",
                            "Click, drag and enter on the screen to control the remote desktop",
                          ),
                        },
                      ]
                    : needsMacPermissions
                    ? [
                        {
                          label: t(
                            "remoteDesktop.macPermStep1",
                            "Open System Settings → Privacy & Security",
                          ),
                        },
                        {
                          label: t("remoteDesktop.macPermStep2", {
                            permissions: permissionLabels.join(
                              t("remoteDesktop.permJoin", ","),
                            ),
                          }),
                        },
                        {
                          label: t(
                            "remoteDesktop.macPermStep3",
                            "Restart Octop(octop run), then return to this page and click “Retest”",
                          ),
                        },
                      ]
                    : [
                        {
                          label: t(
                            "remoteDesktop.setupStep1",
                            "Click “Check” to check Python Dependencies and desktop environment status",
                          ),
                        },
                        {
                          label: t(
                            "remoteDesktop.setupStep2",
                            "If it is not installed, follow the instructions in the pop-up window to complete the installation (Linux Graphics-free server can build a virtual desktop with one click)",
                          ),
                        },
                        {
                          label: t(
                            "remoteDesktop.setupStep3",
                            "After the environment is ready, click “Connect” to start real-time screen viewing and keyboard and mouse control.",
                          ),
                        },
                      ]
                }
                primaryAction={checkGuideAction}
                secondaryAction={connectGuideAction}
                extraAction={uninstallGuideAction}
              />
            )
          ) : (
            <div className={styles.streamSurface}>
              {isStreaming && !frameReady && (
                <div className={styles.streamLoading}>
                  <StreamConnectingIndicator
                    label={
                      status === "connecting"
                        ? t("remoteDesktop.connecting", "Connecting")
                        : status === "reconnecting"
                        ? t("remoteDesktop.reconnecting", "Reconnecting")
                        : t("remoteDesktop.waitingFrame", "Waiting for video…")
                    }
                  />
                </div>
              )}
              <StreamEdgeControls
                visible={showEdgeControls}
                isMobile={isMobile}
                fullscreenLabel={t("remoteDesktop.fullscreen", "Fullscreen")}
                controlsLabel={t(
                  "remoteDesktop.openControls",
                  "Controls and quick operations",
                )}
                streamingLabel={
                  status === "streaming"
                    ? t("remoteDesktop.streaming", "Streaming")
                    : t("remoteDesktop.connecting", "Connecting")
                }
                onFullscreen={() => void handleFullscreen()}
                onOpenControls={openControlsDrawer}
              />
              <canvas
                ref={canvasRef}
                className={`${styles.canvas} ${
                  isMobile ? styles.canvasMobile : ""
                } ${!frameReady ? styles.canvasHidden : ""}`}
                onPointerDown={interaction.onPointerDown}
                onPointerMove={interaction.onPointerMove}
                onPointerLeave={interaction.onPointerLeave}
                onDoubleClick={interaction.onDoubleClick}
                onContextMenu={interaction.onContextMenu}
                onWheel={interaction.onWheel}
                onKeyDown={interaction.onKeyDown}
                onKeyUp={interaction.onKeyUp}
                {...interaction.canvasProps}
              />
            </div>
          )}
        </div>
      </div>

      <Drawer
        title={t("remoteDesktop.controlsTitle", "Controls")}
        placement={isMobile ? "bottom" : "right"}
        open={controlsOpen}
        onClose={closeControlsDrawer}
        width={isMobile ? "100%" : 360}
        height={isMobile ? "min(75vh, 560px)" : undefined}
        destroyOnHidden={false}
        styles={{ body: { padding: "12px 16px 16px" } }}
      >
        {renderControlsContent()}
      </Drawer>
    </>
  );

  if (embedded) {
    return <div className={styles.embeddedRoot}>{pageBody}</div>;
  }

  return (
    <PageShell
      title={pageTitle}
      subtitle={pageSubtitle}
      fill
      actions={headerActions}
    >
      {pageBody}
    </PageShell>
  );
}
