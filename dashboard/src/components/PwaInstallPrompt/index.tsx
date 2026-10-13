import { useEffect, useSyncExternalStore, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { Download, MonitorDown, Share, X } from "lucide-react";
import {
  subscribePwaPrompt,
  getPwaInstallSnapshot,
  triggerInstall,
  waitForInstallPrompt,
} from "../../pwa-prompt";
import { isDesktopShell } from "../../utils/desktopChrome";
import styles from "./index.module.less";

const DISMISSED_KEY = "pwa:install-dismissed";
const IOS_SHOWN_KEY = "pwa:ios-guide-shown";

/** Any iOS browser — all support "Add to Home Screen" via the share sheet. */
function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  const ipadOs =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/i.test(ua) || ipadOs;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

// ─── iOS guide sheet ──────────────────────────────────────────────────────────

export function IosGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return createPortal(
    <div
      className={styles.iosOverlay}
      role="dialog"
      aria-modal="true"
<<<<<<< HEAD
      aria-label="Add to home screen"
=======
      aria-label={t("pwa.addToHomeScreen", "添加到主屏幕")}
>>>>>>> upstream/main
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.iosSheet}>
        <button
          className={styles.guideClose}
          onClick={onClose}
<<<<<<< HEAD
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className={styles.guideTitle}>Add to home screen</div>
        <p className={styles.guideDesc}>Will Octop Installed as App, open it at any time with one click.</p>
=======
          aria-label={t("pwa.close", "关闭")}
        >
          <X size={18} />
        </button>
        <div className={styles.guideTitle}>
          {t("pwa.addToHomeScreen", "添加到主屏幕")}
        </div>
        <p className={styles.guideDesc}>
          {t("pwa.installAsAppDesc", "将 Octop 安装为 App，随时一键打开。")}
        </p>
>>>>>>> upstream/main
        <ol className={styles.guideList}>
          <li>
            <span className={styles.guideStep}>1</span>
            <span>
<<<<<<< HEAD
              Click on the bottom toolbar{" "}
              <Share size={14} className={styles.guideInlineIcon} /> Share button
=======
              {t("pwa.iosStep1Prefix", "点击底部工具栏的")}{" "}
              <Share size={14} className={styles.guideInlineIcon} />{" "}
              {t("pwa.iosStep1Suffix", "分享按钮")}
>>>>>>> upstream/main
            </span>
          </li>
          <li>
            <span className={styles.guideStep}>2</span>
<<<<<<< HEAD
            <span>Scroll down and click “Add to Home Screen”</span>
          </li>
          <li>
            <span className={styles.guideStep}>3</span>
            <span>Click “Add” in the upper right corner to complete the installation</span>
=======
            <span>{t("pwa.iosStep2", "向下滚动，点击「添加到主屏幕」")}</span>
          </li>
          <li>
            <span className={styles.guideStep}>3</span>
            <span>{t("pwa.iosStep3", "点击右上角「添加」完成安装")}</span>
>>>>>>> upstream/main
          </li>
        </ol>
        <div className={styles.iosArrow}>↓</div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Desktop / Android guide (when beforeinstallprompt is not yet available) ──

export function DesktopInstallGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const isEdge = /edg/i.test(navigator.userAgent);
  return createPortal(
    <div
      className={styles.desktopOverlay}
      role="dialog"
      aria-modal="true"
<<<<<<< HEAD
      aria-label="Install as desktop app"
=======
      aria-label={t("pwa.installDesktopApp", "安装为桌面应用")}
>>>>>>> upstream/main
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.desktopSheet}>
        <button
          className={styles.guideClose}
          onClick={onClose}
<<<<<<< HEAD
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className={styles.guideTitle}>Install as desktop app</div>
        <p className={styles.guideDesc}>
          The browser is not ready for one-click installation. Please operate as follows, or refresh the page and click Header
          Install button in .
=======
          aria-label={t("pwa.close", "关闭")}
        >
          <X size={18} />
        </button>
        <div className={styles.guideTitle}>
          {t("pwa.installDesktopApp", "安装为桌面应用")}
        </div>
        <p className={styles.guideDesc}>
          {t(
            "pwa.desktopGuideDesc",
            "浏览器尚未准备好一键安装。请按以下方式操作，或刷新页面后再点 Header 中的安装按钮。",
          )}
>>>>>>> upstream/main
        </p>
        <ol className={styles.guideList}>
          <li>
            <span className={styles.guideStep}>1</span>
            <span>
<<<<<<< HEAD
              Look to the right of the address bar{" "}
              <MonitorDown size={14} className={styles.guideInlineIcon} />{" "}
              Install icon and click
=======
              {t("pwa.desktopStep1Prefix", "查看地址栏右侧的")}{" "}
              <MonitorDown size={14} className={styles.guideInlineIcon} />{" "}
              {t("pwa.desktopStep1Suffix", "安装图标并点击")}
>>>>>>> upstream/main
            </span>
          </li>
          <li>
            <span className={styles.guideStep}>2</span>
            <span>
<<<<<<< HEAD
              Or open the browser menu and choose “{isEdge ? "Install app" : "Install Octop"}”
=======
              {t("pwa.desktopStep2", {
                action: isEdge
                  ? t("pwa.menuActionApply", "应用")
                  : t("pwa.menuActionInstall", "安装"),
              })}
>>>>>>> upstream/main
            </span>
          </li>
          <li>
            <span className={styles.guideStep}>3</span>
<<<<<<< HEAD
            <span>After confirming the installation, you can open it with one click from the desktop or the program dock.</span>
          </li>
        </ol>
        <p className={styles.guideHint}>
          Via LAN IP Required for access HTTPS, otherwise the browser will not provide the installation option.
=======
            <span>
              {t("pwa.desktopStep3", "确认安装后，可从桌面或程序坞一键打开")}
            </span>
          </li>
        </ol>
        <p className={styles.guideHint}>
          {t(
            "pwa.desktopHint",
            "通过局域网 IP 访问时需使用 HTTPS，否则浏览器不会提供安装选项。",
          )}
>>>>>>> upstream/main
        </p>
      </div>
    </div>,
    document.body,
  );
}

interface PwaInstallPromptProps {
  compact?: boolean;
  /**
   * `chatFloat` matches the chat page right-side circular float buttons
   * (browser / expert / files).
   */
  appearance?: "default" | "chatFloat";
}

/**
 * Android/Desktop: reads the deferred prompt captured at module load time
 * (pwa-prompt.ts) via useSyncExternalStore, so it correctly reflects the event
 * even when it fires before React mounts.
 *
 * iOS: shows an install button that opens the step-by-step guide sheet.
 */
export default function PwaInstallPrompt({
  compact,
  appearance = "default",
}: PwaInstallPromptProps) {
  const { t } = useTranslation();
  const installState = useSyncExternalStore(
    subscribePwaPrompt,
    getPwaInstallSnapshot,
  );
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [ios] = useState(() => isIosDevice());
  const [dismissed, setDismissed] = useState(
    () => !!localStorage.getItem(DISMISSED_KEY),
  );

  if (isStandalone() || isDesktopShell() || installState.installed) return null;

  // Chat right float: always expose the install entry until the app is
  // installed (ignore Header dismiss + beforeinstallprompt lag). Dev has no
  // SW, so the old swReady gate hid the button entirely on localhost Vite.
  // Header compact still requires readiness (or iOS) and honors dismiss.
  const chatFloat = appearance === "chatFloat";
  const browserInstallReady =
    ios || installState.prompt || installState.swReady;
  if (!chatFloat && (dismissed || !browserInstallReady)) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setShowIosGuide(false);
    setShowDesktopGuide(false);
  };

  const handleAndroidInstall = async () => {
    if (ios) {
      setShowIosGuide(true);
      return;
    }
    if (installing) return;
    setInstalling(true);
    try {
      if (!installState.prompt) {
        await waitForInstallPrompt(4000);
      }
      const outcome = await triggerInstall();
      if (outcome === "accepted") return;
      if (outcome === "dismissed") {
        localStorage.setItem(DISMISSED_KEY, "1");
        setDismissed(true);
        return;
      }
      setShowDesktopGuide(true);
    } finally {
      setInstalling(false);
    }
  };

  const tooltipTitle = ios
<<<<<<< HEAD
    ? "Add to home screen"
    : installState.prompt
    ? "Install as desktop app"
    : "Install as desktop app";
=======
    ? t("pwa.addToHomeScreen", "添加到主屏幕")
    : t("pwa.installDesktopApp", "安装为桌面应用");
>>>>>>> upstream/main

  const btnClass = chatFloat
    ? styles.installBtnChatFloat
    : `${styles.installBtn} ${compact ? styles.installBtnCompact : ""}`;

  const button = (
    <button
      type="button"
      className={btnClass}
      onClick={() => void handleAndroidInstall()}
      disabled={installing}
<<<<<<< HEAD
      aria-label="Install app"
=======
      aria-label={t("pwa.installApp", "安装应用")}
>>>>>>> upstream/main
    >
      <Download
        size={chatFloat ? 20 : compact ? 15 : 16}
        strokeWidth={chatFloat ? 2.1 : 1.8}
        className={styles.installIcon}
      />
<<<<<<< HEAD
      {!compact && !chatFloat && <span className={styles.label}>Installation</span>}
=======
      {!compact && !chatFloat && (
        <span className={styles.label}>{t("pwa.install", "安装")}</span>
      )}
>>>>>>> upstream/main
    </button>
  );

  return (
    <>
      <Tooltip title={tooltipTitle} placement={chatFloat ? "left" : "top"}>
        {chatFloat ? (
          <span className={styles.chatFloatBtnWrap}>{button}</span>
        ) : (
          button
        )}
      </Tooltip>

      {ios && showIosGuide && <IosGuide onClose={handleDismiss} />}
      {!ios && showDesktopGuide && (
        <DesktopInstallGuide onClose={() => setShowDesktopGuide(false)} />
      )}
    </>
  );
}

// ─── Auto-prompt for iOS (mounted in MainLayout) ──────────────────────────────

/**
 * On iOS, automatically shows the guide sheet after a short delay on
 * the first visit. Covers Chat mobile where the global Header is hidden.
 */
export function PwaAutoPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosDevice() || isStandalone() || isDesktopShell()) return;
    if (
      localStorage.getItem(DISMISSED_KEY) ||
      localStorage.getItem(IOS_SHOWN_KEY)
    )
      return;
    const t = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const handleClose = () => {
    localStorage.setItem(IOS_SHOWN_KEY, "1");
    setShow(false);
  };

  if (!show) return null;
  return <IosGuide onClose={handleClose} />;
}
