import { useEffect, useState, useSyncExternalStore } from "react";
import {
  subscribePwaPrompt,
  getPwaInstallSnapshot,
  triggerInstall,
  waitForInstallPrompt,
} from "../../pwa-prompt";
import {
  DesktopInstallGuide,
  IosGuide,
} from "../../components/PwaInstallPrompt";
import { copyText } from "../../utils/copyText";

interface CheckItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "loading" | "info";
  detail: string;
}

function StatusDot({ status }: { status: CheckItem["status"] }) {
  const colors: Record<string, string> = {
    pass: "#22c55e",
    fail: "#ef4444",
    warn: "#f59e0b",
    loading: "#94a3b8",
    info: "#60a5fa",
  };
  const labels: Record<string, string> = {
    pass: "✓",
    fail: "✗",
    warn: "!",
    loading: "…",
    info: "i",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: colors[status],
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {labels[status]}
    </span>
  );
}

export default function PwaDebugPage() {
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [swLog, setSwLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [forceInstalling, setForceInstalling] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isIos] = useState(
    () =>
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  );
  const installSnap = useSyncExternalStore(
    subscribePwaPrompt,
    getPwaInstallSnapshot,
  );

  useEffect(() => {
    const items: CheckItem[] = [];
    const log: string[] = [];

    // ── 1. Protocol ──────────────────────────────────────────────
    const isHttps =
      location.protocol === "https:" || location.hostname === "localhost";
    items.push({
      id: "https",
      label: "HTTPS / localhost",
      status: isHttps ? "pass" : "fail",
      detail: location.protocol + "//" + location.hostname,
    });
    log.push(`protocol: ${location.protocol}  host: ${location.hostname}`);

    // ── 2. Service Worker support ────────────────────────────────
    const swSupported = "serviceWorker" in navigator;
    items.push({
      id: "sw-support",
      label: "Service Worker Support",
      status: swSupported ? "pass" : "fail",
      detail: swSupported ? "Support" : "Browser does not support SW",
    });
    log.push(`SW support: ${swSupported}`);

    // ── 3. SW registration state ─────────────────────────────────
    if (swSupported) {
      navigator.serviceWorker
        .getRegistration("/")
        .then((reg) => {
          if (!reg) {
            setChecks((prev) => [
              ...prev,
              {
                id: "sw-reg",
                label: "SW Registration status",
                status: "fail",
                detail: "Not found any Service Worker Register",
              },
            ]);
            log.push("SW registration: NONE");
          } else {
            const state = reg.active
              ? "active"
              : reg.installing
              ? "installing"
              : reg.waiting
              ? "waiting"
              : "unknown";
            const scope = reg.scope;
            setChecks((prev) => [
              ...prev,
              {
                id: "sw-reg",
                label: "SW Registration status",
                status: state === "active" ? "pass" : "warn",
                detail: `scope: ${scope}  state: ${state}`,
              },
            ]);
            log.push(`SW reg scope: ${scope}  state: ${state}`);

            // ── 4. SW controlling ──────────────────────────────────
            const controlled = !!navigator.serviceWorker.controller;
            setChecks((prev) => [
              ...prev,
              {
                id: "sw-control",
                label: "SW Control current page",
                status: controlled ? "pass" : "warn",
                detail: controlled
                  ? `controller: ${navigator.serviceWorker.controller?.scriptURL}`
                  : "SW The current page is not controlled (needs to refresh or clientsClaim)",
              },
            ]);
            log.push(
              `SW controller: ${
                navigator.serviceWorker.controller?.scriptURL ?? "none"
              }`,
            );
          }
        })
        .catch((e) => {
          setChecks((prev) => [
            ...prev,
            {
              id: "sw-reg",
              label: "SW Registration status",
              status: "fail",
              detail: `Error: ${e.message}`,
            },
          ]);
        });
    }

    // ── 5. Manifest fetch ────────────────────────────────────────
    fetch("/manifest.json")
      .then(async (res) => {
        const ct = res.headers.get("content-type") ?? "";
        let detail = `HTTP ${res.status}  Content-Type: ${ct}`;
        let status: CheckItem["status"] = "fail";
        if (res.ok) {
          try {
            const json = await res.json();
            const hasName = !!json.name;
            const hasIcons = Array.isArray(json.icons) && json.icons.length > 0;
            const hasStartUrl = !!json.start_url;
            const hasDisplay =
              json.display === "standalone" || json.display === "fullscreen";
            const allOk = hasName && hasIcons && hasStartUrl && hasDisplay;
            status = allOk ? "pass" : "warn";
            detail = `HTTP ${res.status} | name:${hasName} icons:${hasIcons} start_url:${hasStartUrl} display:${json.display} | CT:${ct}`;
            log.push(
              `manifest: ${JSON.stringify({
                name: json.name,
                display: json.display,
                icons: json.icons?.length,
                id: json.id,
              })}`,
            );

            // Chrome installability requires icon pixels to match manifest sizes.
            const icons = Array.isArray(json.icons) ? json.icons : [];
            void Promise.all(
              icons.map(async (icon: { src?: string; sizes?: string }) => {
                const src = icon.src;
                const sizes = icon.sizes ?? "";
                if (!src || !sizes || sizes === "any") return null;
                const [w, h] = sizes.split("x").map(Number);
                if (!w || !h) return null;
                try {
                  const img = new Image();
                  const loaded = await new Promise<boolean>((resolve) => {
                    img.onload = () => resolve(true);
                    img.onerror = () => resolve(false);
                    img.src = src.startsWith("/") ? src : `/${src}`;
                  });
                  if (!loaded) {
                    return `${src}: Loading failed`;
                  }
                  if (img.naturalWidth !== w || img.naturalHeight !== h) {
                    return `${src}: Statement ${sizes}, actual ${img.naturalWidth}x${img.naturalHeight}`;
                  }
                  return null;
                } catch {
                  return `${src}: Verification exception`;
                }
              }),
            ).then((mismatches) => {
              const bad = mismatches.filter(Boolean) as string[];
              if (bad.length === 0) {
                setChecks((prev) => [
                  ...prev,
                  {
                    id: "icon-sizes",
                    label: "Icon size and manifest Consistent",
                    status: "pass",
                    detail: `Verified ${icons.length} Icons`,
                  },
                ]);
                log.push("icon sizes: all match manifest");
              } else {
                setChecks((prev) => [
                  ...prev,
                  {
                    id: "icon-sizes",
                    label: "Icon size and manifest Consistent",
                    status: "fail",
                    detail: bad.join(" | "),
                  },
                ]);
                log.push(`icon size mismatch: ${bad.join("; ")}`);
              }
              setSwLog((prev) => [
                ...prev,
                bad.length === 0
                  ? "icon sizes: all match manifest"
                  : `icon size mismatch: ${bad.join("; ")}`,
              ]);
            });
          } catch {
            status = "fail";
            detail = `HTTP ${res.status} But JSON Parsing failed`;
          }
        } else {
          detail = `HTTP ${res.status} — Intercepted or 404`;
          log.push(`manifest fetch failed: ${res.status} url=${res.url}`);
        }
        setChecks((prev) => [
          ...prev,
          { id: "manifest", label: "manifest.json Accessible", status, detail },
        ]);
      })
      .catch((e) => {
        const detail = `fetch Failed: ${e.message}(may be intercepted by authentication proxy)`;
        log.push(`manifest fetch error: ${e.message}`);
        setChecks((prev) => [
          ...prev,
          {
            id: "manifest",
            label: "manifest.json Accessible",
            status: "fail",
            detail,
          },
        ]);
      });

    // ── 6. sw.js fetch ───────────────────────────────────────────
    // Use GET + abort so HEAD 405 (some servers block HEAD) doesn't cause false fail.
    const swAbort = new AbortController();
    fetch("/sw.js", { signal: swAbort.signal })
      .then((res) => {
        swAbort.abort();
        const cc = res.headers.get("cache-control") ?? "(none)";
        const ct = res.headers.get("content-type") ?? "(none)";
        const status: CheckItem["status"] = res.ok
          ? cc.includes("no-cache") || cc.includes("no-store")
            ? "pass"
            : "warn"
          : "fail";
        const detail = `HTTP ${res.status} | Cache-Control: ${cc} | Content-Type: ${ct}`;
        log.push(`sw.js: ${detail}`);
        setChecks((prev) => [
          ...prev,
          { id: "sw-fetch", label: "sw.js Accessible without strong caching", status, detail },
        ]);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setChecks((prev) => [
          ...prev,
          {
            id: "sw-fetch",
            label: "sw.js Accessible without strong caching",
            status: "fail",
            detail: `fetch Failed: ${e.message}`,
          },
        ]);
      });

    // ── 7. beforeinstallprompt ───────────────────────────────────
    // Checked via useSyncExternalStore below, but add as static check here
    items.push({
      id: "bip",
      label: "beforeinstallprompt Status",
      status: "info",
      detail: "See real-time status below",
    });

    // ── 8. Standalone mode ───────────────────────────────────────
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    items.push({
      id: "standalone",
      label: "Current operating mode",
      status: standalone ? "info" : "info",
      detail: standalone
        ? "standalone(Installed mode)"
        : "browser tab(browser tab)",
    });
    log.push(`standalone: ${standalone}`);

    // ── 9. User Agent ────────────────────────────────────────────
    items.push({
      id: "ua",
      label: "User Agent",
      status: "info",
      detail: navigator.userAgent,
    });
    log.push(`UA: ${navigator.userAgent}`);

    // ── 10. dismissed flag ───────────────────────────────────────
    const dismissed = localStorage.getItem("pwa:install-dismissed");
    items.push({
      id: "dismissed",
      label: "The user has clicked “Do not install”",
      status: dismissed ? "warn" : "pass",
      detail: dismissed ? `Already set (see below for clearing method)` : "Not set",
    });
    log.push(`dismissed flag: ${dismissed ?? "not set"}`);

    setSwLog((prev) => [...prev, ...log]);
    setChecks((prev) => {
      // merge static items first, then async items will append
      const ids = new Set(prev.map((c) => c.id));
      return [...prev, ...items.filter((i) => !ids.has(i.id))];
    });
  }, []);

  const allChecks: CheckItem[] = [
    ...checks,
    {
      id: "bip-live",
      label: "beforeinstallprompt Captured",
      status: installSnap.prompt ? "pass" : "warn",
      detail: installSnap.prompt
        ? "✓ Event captured to trigger installation"
        : "Uncaught (Chrome Event not sent after internal evaluation, possibly during silent period)",
    },
    {
      id: "swready-live",
      label: "Front end swReady Status",
      status: installSnap.swReady ? "pass" : "warn",
      detail: installSnap.swReady
        ? `swReady=true(Button should be displayed)`
        : `swReady=false(pwa-prompt.ts Detection SW Failed, button hidden)`,
    },
  ];

  const handleClearDismissed = () => {
    localStorage.removeItem("pwa:install-dismissed");
    localStorage.removeItem("pwa:ios-guide-shown");
    alert("Cleared, please refresh the page");
  };

  const handleCopyLog = () => {
    const text =
      allChecks
        .map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`)
        .join("\n") +
      "\n\n--- raw log ---\n" +
      swLog.join("\n");
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleInstall = async () => {
    const result = await triggerInstall();
    alert(`Installation results: ${result}`);
  };

  /** Best-effort install: clear local dismiss, wait for prompt, call prompt(). */
  const handleForceInstall = async () => {
    if (forceInstalling) return;
    setForceInstalling(true);
    setSwLog((prev) => [
      ...prev,
      "[force] Clear the local deny flag and try to trigger the installation dialog…",
    ]);
    localStorage.removeItem("pwa:install-dismissed");
    localStorage.removeItem("pwa:ios-guide-shown");

    try {
      if (isIos) {
        setShowIosGuide(true);
        setSwLog((prev) => [
          ...prev,
          "[force] iOS Need to manually “Add to Home Screen”, the boot has been turned on",
        ]);
        return;
      }

      if (!getPwaInstallSnapshot().prompt) {
        setSwLog((prev) => [
          ...prev,
          "[force] Not captured yet beforeinstallprompt, wait 3 Seconds…",
        ]);
        await waitForInstallPrompt(3000);
      }

      const result = await triggerInstall();
      setSwLog((prev) => [...prev, `[force] triggerInstall → ${result}`]);

      if (result === "accepted") {
        alert("Installation accepted, the app should appear in the Dock/Launch pad");
        return;
      }
      if (result === "dismissed") {
        alert("The installation dialog box has popped up and you have chosen to cancel.");
        return;
      }

      setSwLog((prev) => [
        ...prev,
        "[force] Not provided by browser programmatic install, open the manual installation guide",
      ]);
      setShowManualGuide(true);
    } finally {
      setForceInstalling(false);
    }
  };

  const handleWaitPrompt = async () => {
    setSwLog((prev) => [...prev, "[wait] Wait beforeinstallprompt 8 Seconds..."]);
    const prompt = await waitForInstallPrompt(8000);
    setSwLog((prev) => [
      ...prev,
      prompt
        ? "[wait] ✓ Event captured"
        : "[wait] ✗ 8 Not triggered within seconds,Chrome In silent period or failed assessment",
    ]);
  };

  const handleResetPwa = async () => {
    if (
      !confirm(
        "Will log out the current Service Worker And clear all PWA Status. Are you sure you want to reset?\nThe page will automatically refresh after the operation is completed.",
      )
    ) {
      return;
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
    localStorage.removeItem("pwa:install-dismissed");
    localStorage.removeItem("pwa:ios-guide-shown");
    // Clear any cached PWA install decision so Chrome re-evaluates on next visit.
    if ("caches" in window) {
      const names = await caches.keys();
      for (const n of names) {
        if (n.toLowerCase().includes("workbox")) await caches.delete(n);
      }
    }
    setSwLog((prev) => [...prev, "[reset] SW Log out + Cache cleaning completed and will be refreshed soon"]);
    setTimeout(() => location.reload(), 800);
  };

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        padding: "20px 16px calc(40px + env(safe-area-inset-bottom, 0px))",
        maxWidth: 640,
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2
        style={{
          margin: "0 0 4px",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--fn-text-primary)",
        }}
      >
        PWA Diagnosis
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13,
          color: "var(--fn-text-tertiary)",
        }}
      >
        Visit this page on your mobile phone to view PWA Are the installation conditions met?
      </p>

      {/* Check list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 24,
        }}
      >
        {allChecks.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--fn-bg-secondary, rgba(255,255,255,0.04))",
              border:
                "1px solid var(--fn-border-primary, rgba(255,255,255,0.07))",
            }}
          >
            <StatusDot status={c.status} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--fn-text-primary)",
                  marginBottom: 2,
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fn-text-tertiary)",
                  wordBreak: "break-all",
                  lineHeight: 1.5,
                }}
              >
                {c.detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}
      >
        <button
          type="button"
          onClick={() => void handleForceInstall()}
          disabled={forceInstalling}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            background: forceInstalling ? "#94a3b8" : "var(--fn-color-brand)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: forceInstalling ? "not-allowed" : "pointer",
          }}
        >
          {forceInstalling ? "Installation attempt in progress…" : "Force an installation attempt"}
        </button>
        <button
          onClick={handleCopyLog}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid var(--fn-border-primary)",
            background: "var(--fn-bg-tertiary)",
            color: "var(--fn-text-primary)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied ✓" : "Copy diagnostic report"}
        </button>
        <button
          onClick={handleClearDismissed}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid #f59e0b",
            background: "transparent",
            color: "#f59e0b",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Clear the “Do Not Install” mark
        </button>
        <button
          onClick={() => void handleWaitPrompt()}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid var(--fn-border-primary)",
            background: "var(--fn-bg-tertiary)",
            color: "var(--fn-text-primary)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Wait for installation event (8s)
        </button>
        <button
          onClick={() => void handleResetPwa()}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid #ef4444",
            background: "transparent",
            color: "#ef4444",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Reset PWA Status (logout SW)
        </button>
        {installSnap.prompt && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid var(--fn-color-brand)",
              background: "transparent",
              color: "var(--fn-color-brand)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Direct prompt(captured)
          </button>
        )}
      </div>

      {showManualGuide && (
        <DesktopInstallGuide onClose={() => setShowManualGuide(false)} />
      )}
      {showIosGuide && <IosGuide onClose={() => setShowIosGuide(false)} />}

      {/* Instructions */}
      <div
        style={{
          padding: "14px 14px",
          borderRadius: 10,
          fontSize: 12,
          background: "rgba(96,165,250,0.08)",
          border: "1px solid rgba(96,165,250,0.2)",
          color: "var(--fn-text-secondary)",
          lineHeight: 1.7,
        }}
      >
        <strong>Description:</strong>
        <br />• <strong>SW Not controlling the current page</strong>: Normal, just refresh after the first visit
        <br />• <strong>beforeinstallprompt Not caught</strong>:Chrome
        Need"Engagement"Triggered——Closes after a few minutes of normal use on the site and reopens the next day or a few hours later,Chrome
        The installation bar will pop up automatically.
        <br />• <strong>manifest Intercepted</strong>
        : Need to be in reverse proxy/Allowed in the gateway whitelist /manifest.json
        <br />• <strong>“Do not install” flag set</strong>: Refresh after clicking the “Clear” button
        <br />• <strong>Force an installation attempt</strong>: Called after clearing the local reject flag
        beforeinstallprompt;If the browser does not send this event, it will open the manual installation guide (the webpage cannot bypass
        Chrome Forced pop-up window)
        <br />• Click “Copy Diagnostic Report” to send the results to the developer
      </div>
    </div>
  );
}
