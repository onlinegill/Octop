import { useState, useEffect } from "react";
import {
  Form,
  InputNumber,
  Button,
  Card,
  Switch,
  TimePicker,
  Alert,
  Divider,
  Spin,
} from "antd";
import { message } from "@/utils/antdMessage";

import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../../../api";
import type { ProactiveCareConfig } from "../../../api/types";
import styles from "./ProactiveConfig.module.less";

interface Props {
  agentId: string;
  /** Switch to the episodes tab when the "view episodes" action is clicked. */
  onSwitchToEpisodes?: () => void;
}

export default function ProactiveConfig({
  agentId,
  onSwitchToEpisodes,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const config = await api.getProactiveCareConfig(agentId);
      setEnabled(config.enabled);

      form.setFieldsValue({
        enabled: config.enabled,
        active_hours_start: dayjs(
          config.active_hours_start || "09:00",
          "HH:mm",
        ),
        active_hours_end: dayjs(config.active_hours_end || "22:00", "HH:mm"),
        min_interval_hours: config.min_interval_hours ?? 5,
        max_interval_hours: config.max_interval_hours ?? 24,
      });
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : t("proactiveConfig.loadFailed", "Failed to load proactive reminder settings");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      const startStr: string = dayjs(values.active_hours_start).format("HH:mm");
      const endStr: string = dayjs(values.active_hours_end).format("HH:mm");

      // Validate the time range.
      if (startStr >= endStr) {
        message.error(
          t(
            "proactiveConfig.timeRangeError",
            "The start time of the care period must be earlier than the end time",
          ),
        );
        return;
      }

      const payload: ProactiveCareConfig = {
        enabled: values.enabled,
        active_hours_start: startStr,
        active_hours_end: endStr,
        min_interval_hours: values.min_interval_hours,
        max_interval_hours: values.max_interval_hours,
        episode_filter: null,
      };

      setSaving(true);
      await api.updateProactiveCareConfig(agentId, payload);
      message.success(t("proactiveConfig.saveSuccess", "Proactive reminder settings saved"));
    } catch (err) {
      if (err instanceof Error && "errorFields" in err) {
        // Form validation failed; antd already shows errors, so do not add another toast.
        return;
      }
      const errMsg =
        err instanceof Error
          ? err.message
          : t("proactiveConfig.saveFailed", "Failed to save proactive reminder settings");
      message.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    fetchConfig();
  };

  if (loading) {
    return (
      <div className={styles.centerState}>
        <Spin />
        <span className={styles.stateText}>
          {t("common.loading", "Loading…")}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.centerState}>
        <span className={styles.stateTextError}>{error}</span>
        <Button size="small" onClick={fetchConfig} style={{ marginTop: 12 }}>
          {t("environments.retry", "Retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.proactiveConfig}>
      {/* ── Header ── */}
      <div className={styles.configHeader}>
        <div>
          <h3 className={styles.configTitle}>
            {t("proactiveConfig.title", "Proactive Reminders")}
          </h3>
          <p className={styles.configDesc}>
            {t(
              "proactiveConfig.description",
              "Let Octop At the right time, I will take the initiative to send you a message of concern.",
            )}
          </p>
        </div>
      </div>

      {/* ── Episode source explanation banner ── */}
      <Alert
        type="info"
        showIcon
        message={
          <span>
            {t(
              "proactiveConfig.episodeBannerText",
              "Octop We will pick the right time from your emotional diary and take the initiative to send you a message of concern. You can check which records will be referenced in the “Emotion Diary”.",
            )}
            {onSwitchToEpisodes && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onSwitchToEpisodes}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "inherit",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontWeight: 500,
                    fontSize: "inherit",
                  }}
                >
                  {t("proactiveConfig.viewEpisodes", "Open Episodes →")}
                </button>
              </>
            )}
          </span>
        }
      />

      <Card className={styles.configCard}>
        <Form form={form} layout="vertical" className={styles.form}>
          {/* ── Enable switch ── */}
          <Form.Item
            label={t("proactiveConfig.enabled", "Enable Proactive Reminders")}
            name="enabled"
            valuePropName="checked"
            className={styles.switchItem}
          >
            <Switch onChange={(checked) => setEnabled(checked)} />
          </Form.Item>

          <Divider style={{ margin: "8px 0" }} />

          {/* ── Active hours ── */}
          <div className={styles.timeRangeRow}>
            <Form.Item
              label={t("proactiveConfig.activeHoursStart", "Care hours · start")}
              name="active_hours_start"
              className={styles.timeRangeItem}
              rules={[
                {
                  required: true,
                  message: t(
                    "proactiveConfig.activeHoursStartRequired",
                    "Please select a start time",
                  ),
                },
              ]}
            >
              <TimePicker
                format="HH:mm"
                style={{ width: "100%" }}
                needConfirm={false}
                disabled={!enabled}
              />
            </Form.Item>
            <Form.Item
              label={t("proactiveConfig.activeHoursEnd", "Care hours · end")}
              name="active_hours_end"
              className={styles.timeRangeItem}
              rules={[
                {
                  required: true,
                  message: t(
                    "proactiveConfig.activeHoursEndRequired",
                    "Please select end time",
                  ),
                },
              ]}
            >
              <TimePicker
                format="HH:mm"
                style={{ width: "100%" }}
                needConfirm={false}
                disabled={!enabled}
              />
            </Form.Item>
          </div>

          {/* ── Push interval ── */}
          <div className={styles.timeRangeRow}>
            <Form.Item
              label={t("proactiveConfig.minIntervalHours", "Min interval (hours)")}
              name="min_interval_hours"
              className={styles.timeRangeItem}
              rules={[
                {
                  required: true,
                  message: t(
                    "proactiveConfig.minIntervalRequired",
                    "Please enter minimum interval",
                  ),
                },
                {
                  type: "number",
                  min: 1,
                  message: t(
                    "proactiveConfig.minIntervalMin",
                    "The minimum interval cannot be less than 1 Hours",
                  ),
                },
                {
                  validator: (_, value) => {
                    const max = form.getFieldValue("max_interval_hours");
                    if (value != null && max != null && value > max) {
                      return Promise.reject(
                        t(
                          "proactiveConfig.intervalOrderError",
                          "The shortest interval cannot be greater than the longest interval",
                        ),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                disabled={!enabled}
                onChange={() => {
                  // Revalidate max_interval_hours.
                  form.validateFields(["max_interval_hours"]);
                }}
              />
            </Form.Item>
            <Form.Item
              label={t("proactiveConfig.maxIntervalHours", "Max interval (hours)")}
              name="max_interval_hours"
              className={styles.timeRangeItem}
              rules={[
                {
                  required: true,
                  message: t(
                    "proactiveConfig.maxIntervalRequired",
                    "Please enter the maximum interval",
                  ),
                },
                {
                  validator: (_, value) => {
                    const min = form.getFieldValue("min_interval_hours");
                    if (value != null && min != null && value < min) {
                      return Promise.reject(
                        t(
                          "proactiveConfig.intervalOrderError",
                          "The longest interval cannot be smaller than the shortest interval",
                        ),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                disabled={!enabled}
                onChange={() => {
                  form.validateFields(["min_interval_hours"]);
                }}
              />
            </Form.Item>
          </div>
        </Form>

        <div className={styles.actions}>
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t("common.save", "Save")}
          </Button>
          <Button onClick={handleReset} disabled={saving}>
            {t("common.reset", "Reset")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
