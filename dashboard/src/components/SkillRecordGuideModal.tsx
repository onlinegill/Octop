/**
 * Skill Record Guide Modal — onboarding popup for browser skill recording.
 *
 * Displayed in the Remote Browser page. Shows a brief walkthrough of the
 * recording workflow. No input fields here — the user fills in the task
 * objective and operation description in the AI chat panel after recording
 * starts.
 */
import { useState } from "react";
import { Modal, Button, Steps, Typography, Space, Alert } from "antd";
import { useTranslation } from "react-i18next";
import { Sparkles, ArrowRight } from "lucide-react";

interface SkillRecordGuideModalProps {
  open: boolean;
  onCancel: () => void;
  /** Callback when user clicks "start recording" — no payload, just triggers the flow */
  onStartRecording: () => void;
  /** Whether browser env is ready */
  envReady: boolean;
}

export default function SkillRecordGuideModal({
  open,
  onCancel,
  onStartRecording,
  envReady,
}: SkillRecordGuideModalProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  const stepItems = [
    {
      title: t("skillRecordGuide.step1Title", "Start recording"),
      description: t(
        "skillRecordGuide.step1Desc",
        "Click the button below and the system will start recording all browser actions.",
      ),
    },
    {
      title: t("skillRecordGuide.step2Title", "Enter the task goal"),
      description: t(
        "skillRecordGuide.step2Desc",
        'After recording starts,AIThe assistant will prompt you to enter the task goal——This will become the name of the skill and the trigger keyword (e.g."LoginOASystem").',
      ),
    },
    {
      title: t("skillRecordGuide.step3Title", "Describe the steps"),
      description: t(
        "skillRecordGuide.step3Desc",
        "Then describe what you wantAIThe operations performed by the assistant in the browser will be automatically performed and recorded by the assistant.",
      ),
    },
    {
      title: t("skillRecordGuide.step4Title", "Stop and confirm"),
      description: t(
        "skillRecordGuide.step4Desc",
        'After the operation is completed, enter"End"Stop recording. After confirmation, the skill will be saved under the name of the task target. Then just enter the mission target keyword to trigger playback.',
      ),
    },
  ];

  const handleStart = () => {
    setCurrentStep(0);
    onStartRecording();
  };

  const handleClose = () => {
    setCurrentStep(0);
    onCancel();
  };

  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles
            size={18}
            style={{ color: "var(--fn-color-brand, #635bff)" }}
          />
          <span>{t("skillRecordGuide.title", "Skill recording guide")}</span>
        </div>
      }
      open={open}
      onCancel={handleClose}
      width={520}
      footer={
        <Space>
          <Button onClick={handleClose}>{t("common.cancel", "Cancel")}</Button>
          <Button
            type="primary"
            icon={<ArrowRight size={14} />}
            onClick={handleStart}
            disabled={!envReady}
          >
            {envReady
              ? t("skillRecordGuide.startRecording", "Start recording")
              : t("skillRecordGuide.envNotReady", "Browser environment required first")}
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <div style={{ padding: "8px 0" }}>
        <Typography.Paragraph
          style={{
            fontSize: 14,
            color: "var(--fn-text-secondary)",
            marginBottom: 16,
          }}
        >
          {t(
            "skillRecordGuide.intro",
            "By recording browser operations, reusable skill scripts are automatically generated. Once recording starts, you willAIEnter the task goal and operation description in the assistant dialog.",
          )}
        </Typography.Paragraph>

        <Steps
          current={currentStep}
          onChange={setCurrentStep}
          direction="vertical"
          size="small"
          items={stepItems.map((item) => ({
            title: item.title,
            description: item.description,
          }))}
          style={{ marginBottom: 8 }}
        />

        {!envReady && (
          <Alert
            type="warning"
            showIcon
            message={t("skillRecordGuide.envWarning", "Browser environment not ready")}
            description={t(
              "skillRecordGuide.envWarningDesc",
              "Please make sure the browser environment is available before starting recording.",
            )}
            style={{ marginBottom: 8 }}
          />
        )}
      </div>
    </Modal>
  );
}
