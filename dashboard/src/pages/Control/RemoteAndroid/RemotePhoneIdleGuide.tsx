import type { Ref } from "react";
import { Button } from "antd";
import { Download, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import StreamSetupGuide from "../../../components/StreamSetupGuide/StreamSetupGuide";
import { OctopEmptyMascot } from "../../../components/EmptyState";
import type { MobileStatusResponse } from "../../../api/modules/mobile";
import styles from "./index.module.less";

type RemotePhoneIdleGuideProps = {
  variant?: "screen" | "shell";
  loading: boolean;
  statusData: MobileStatusResponse | null;
  installPhase: "idle" | "installing" | "success" | "failed";
  installLogs: string[];
  installLogRef: Ref<HTMLDivElement>;
  ready: boolean;
  needsInstall: boolean;
  needsDevice: boolean;
  device: string;
  onConnect: () => void;
  onInstall: () => void;
  onRefresh: () => void;
  onCancelInstall: () => void;
};

export default function RemotePhoneIdleGuide({
  variant = "screen",
  loading,
  statusData,
  installPhase,
  installLogs,
  installLogRef,
  ready,
  needsInstall,
  needsDevice,
  device,
  onConnect,
  onInstall,
  onRefresh,
  onCancelInstall,
}: RemotePhoneIdleGuideProps) {
  const { t } = useTranslation();

  if (loading && !statusData) {
    return null;
  }

  if (installPhase === "installing") {
    return (
      <div className={styles.installProgress}>
        <RefreshCw size={32} className={styles.streamLoadingIcon} />
        <div className={styles.installProgressTitle}>
          {t("remoteAndroid.installProgress", "Installing Android container…")}
        </div>
        <div ref={installLogRef} className={styles.installLog}>
          {installLogs.length === 0 ? (
            <div>{t("remoteAndroid.installing", "Starting install…")}</div>
          ) : (
            installLogs.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
        <div className={styles.installProgressActions}>
          <Button onClick={onCancelInstall}>
            {t("common.cancel", "Cancel")}
          </Button>
        </div>
      </div>
    );
  }

  const isShell = variant === "shell";

  return (
    <StreamSetupGuide
      icon={<OctopEmptyMascot size={120} className={styles.setupMascot} />}
      title={
        ready
          ? isShell
            ? t("remoteAndroid.shellConnectTitle", "Connect for ADB Shell")
            : t("remoteAndroid.connectTitle", "Connect remote phone")
          : needsInstall
          ? t("remoteAndroid.needsInstall", "Container install required")
          : needsDevice
          ? t("remoteAndroid.needsDevice", "No device connected")
          : t("pageShell.mobile.title", "Remote Phone")
      }
      description={
        ready
          ? isShell
            ? t(
                "remoteAndroid.shellConnectIdleDesc",
                "Click Connect to start streaming, then run commands in the terminal below.",
              )
            : t(
                "remoteAndroid.connectIdleDesc",
                "Click Connect below to stream and control the phone in real time.",
              )
          : needsInstall
          ? t(
              "remoteAndroid.needsInstallDesc",
              "This host uses containers Android Backend. You can pull and start the container with one click; if it is not installed Docker Installation will be attempted automatically (manual installation required if failed).",
            )
          : needsDevice
          ? t(
              "remoteAndroid.needsDeviceDesc",
              "Start an Android emulator or connect a phone via USB, then refresh.",
            )
          : t(
              "remoteAndroid.setupDesc",
              "Connect a phone over USB with debugging enabled, then start streaming.",
            )
      }
      steps={
        ready
          ? [
              {
                label: t("remoteAndroid.idleStep1", "Select a device"),
              },
              {
                label: isShell
                  ? t(
                      "remoteAndroid.shellIdleStep2",
                      "Click Connect, then use the terminal below to run adb shell commands",
                    )
                  : t(
                      "remoteAndroid.idleStep2",
                      "Click Connect, then tap, swipe, and type on the phone screen; once connected the Agent can use the device too",
                    ),
              },
            ]
          : needsInstall
          ? [
              {
                label: t(
                  "remoteAndroid.installStep1",
                  "Click “Install Container”; if the host is not installed Docker Will be installed automatically",
                ),
              },
              {
                label: t(
                  "remoteAndroid.installStep2",
                  "Waiting for pull and start Android Container",
                ),
              },
              {
                label: t(
                  "remoteAndroid.installStep3",
                  "After the installation is complete, refresh the status and click “Connect”",
                ),
              },
            ]
          : [
              {
                label: t(
                  "remoteAndroid.setupStep1",
                  "Enable USB debugging on the phone and plug it in",
                ),
              },
              {
                label: t(
                  "remoteAndroid.setupStep2",
                  "Click Refresh until the device appears in the list",
                ),
              },
              {
                label: t(
                  "remoteAndroid.setupStep3",
                  "Click Connect to start live control",
                ),
              },
            ]
      }
      primaryAction={
        ready
          ? {
              label: t("remoteAndroid.connect", "Connect"),
              onClick: onConnect,
              icon: <PlugZap size={14} />,
              disabled: !device,
            }
          : needsInstall
          ? {
              label:
                installPhase === "failed"
                  ? t("remoteAndroid.installRetry", "Retry install")
                  : t("remoteAndroid.install", "Install container"),
              onClick: onInstall,
              icon: <Download size={14} />,
            }
          : {
              label: t("remoteAndroid.refresh", "Refresh"),
              onClick: onRefresh,
              icon: <RefreshCw size={14} />,
              loading,
            }
      }
      secondaryAction={
        needsInstall
          ? {
              label: t("remoteAndroid.refresh", "Refresh"),
              onClick: onRefresh,
              icon: <RefreshCw size={14} />,
              loading,
              type: "default",
            }
          : undefined
      }
    />
  );
}
