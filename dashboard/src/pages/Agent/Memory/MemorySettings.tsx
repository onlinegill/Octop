import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Radio,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from "antd";
import { message } from "@/utils/antdMessage";

import { Brain, Cpu, Database, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  memoryDashboardApi,
  type ExtractConfig,
  type ExtractTriggerMode,
} from "../../../api/modules/memoryDashboard";
import { providerApi } from "../../../api/modules/provider";
import {
  MODEL_AUTO_VALUE,
  buildModelSelectOptions,
  defaultModelFromForm,
  defaultModelToForm,
  type ModelPickerOption,
} from "../../../utils/modelOptions";
import styles from "./MemorySettings.module.less";

interface Props {
  agentId: string;
}

const MIN_IDLE_MINUTES = 1;
const MIN_INTERVAL_HOURS = 0.1;

export default function MemorySettings({ agentId }: Props) {
  const { t } = useTranslation();
  const loadFailedMessage = t("memory.settings.loadFailed", "Failed to load memory settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [mode, setMode] = useState<ExtractTriggerMode>("idle");
  const [idleMinutes, setIdleMinutes] = useState(5);
  const [intervalHours, setIntervalHours] = useState(6);
  const [auxModel, setAuxModel] = useState<string>(MODEL_AUTO_VALUE);
  const [models, setModels] = useState<ModelPickerOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    providerApi
      .listResolvedModels()
      .then((data) => {
        if (!cancelled) setModels(data as ModelPickerOption[]);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyConfig = useCallback((cfg: ExtractConfig) => {
    setMemoryEnabled(cfg.memory_enabled ?? true);
    setMode(cfg.extract_trigger_mode);
    setAuxModel(defaultModelToForm(cfg.aux_model));
    setIdleMinutes(
      Math.max(
        MIN_IDLE_MINUTES,
        Math.round((cfg.extract_idle_seconds / 60) * 10) / 10,
      ),
    );
    setIntervalHours(
      Math.round((cfg.extract_interval_seconds / 3600) * 10) / 10,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    memoryDashboardApi
      .getExtractConfig(agentId)
      .then((cfg) => {
        if (!cancelled) applyConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) {
          message.error(loadFailedMessage);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, applyConfig, loadFailedMessage]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const cfg = await memoryDashboardApi.putExtractConfig(agentId, {
        memory_enabled: memoryEnabled,
        extract_on_session_end: true,
        extract_trigger_mode: mode,
        extract_idle_seconds: Math.round(
          Math.max(MIN_IDLE_MINUTES, idleMinutes) * 60,
        ),
        extract_interval_seconds: Math.round(intervalHours * 3600),
        aux_model: defaultModelFromForm(auxModel) ?? "",
      });
      applyConfig(cfg);
      message.success(t("memory.settings.saved", "Saved — the agent will reload automatically"));
    } catch {
      message.error(t("memory.settings.saveFailed", "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.settingsPage}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  return (
    <div className={styles.settingsPage}>
      <header className={styles.pageHeader}>
        <div className={styles.headerIcon}>
          <Brain size={22} />
        </div>
        <div>
          <h2>{t("memory.settings.title", "Memory settings")}</h2>
          <p>
            {t(
              "memory.settings.description",
              "Control this Agent Whether memory is used, and when conversational content is organized into long-term memory.",
            )}
          </p>
        </div>
      </header>

      <Card className={styles.settingCard}>
        <div className={styles.settingRow}>
          <div className={styles.settingIdentity}>
            <span className={styles.settingIcon}>
              <Database size={18} />
            </span>
            <div>
              <div className={styles.settingTitle}>
                {t("memory.settings.storageTitle", "Store memory")}
              </div>
              <div className={styles.settingDescription}>
                {t(
                  "memory.settings.storageDescription",
                  "Allow Agent Read existing memories and continue to accumulate memories from new conversations.",
                )}
              </div>
            </div>
          </div>
          <div className={styles.switchBlock}>
            <span
              className={memoryEnabled ? styles.statusOn : styles.statusOff}
            >
              {memoryEnabled
                ? t("memory.settings.enabled", "On")
                : t("memory.settings.disabled", "Off")}
            </span>
            <Switch checked={memoryEnabled} onChange={setMemoryEnabled} />
          </div>
        </div>

        {!memoryEnabled ? (
          <Alert
            className={styles.memoryWarning}
            type="warning"
            showIcon
            message={t(
              "memory.settings.disabledTitle",
              "After closing Agent Memory will no longer be used",
            )}
            description={t(
              "memory.settings.disabledDescription",
              "Agent No existing memories are read, and no new memories are captured or refined. Existing memories and conversation records will not be deleted and can continue to be used after reopening.",
            )}
          />
        ) : null}
      </Card>

      <Card
        className={`${styles.settingCard} ${
          !memoryEnabled ? styles.cardDisabled : ""
        }`}
      >
        <div className={styles.sectionHeading}>
          <span className={styles.settingIcon}>
            <Sparkles size={18} />
          </span>
          <div>
            <div className={styles.settingTitle}>
              {t("memory.settings.distillTitle", "Distillation timing")}
            </div>
            <div className={styles.settingDescription}>
              {t(
                "memory.settings.distillDescription",
                "Choose when to organize conversational memories into recallable long-term memory.",
              )}
            </div>
          </div>
        </div>

        <fieldset className={styles.strategyFields} disabled={!memoryEnabled}>
          <Radio.Group
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as ExtractTriggerMode)
            }
          >
            <Space direction="vertical" size={14}>
              <Radio value="idle">
                <span className={styles.radioTitle}>
                  {t("memory.extractConfig.modeIdle", "Distill after conversation goes idle")}
                </span>
                <Typography.Text type="secondary" className={styles.radioHint}>
                  {t(
                    "memory.extractConfig.modeIdleHint",
                    "Wait for the conversation to be quiet for a while before refining it for the best memory quality (recommended)",
                  )}
                </Typography.Text>
              </Radio>
              <Radio value="interval">
                <span className={styles.radioTitle}>
                  {t("memory.extractConfig.modeInterval", "Distill on a fixed interval")}
                </span>
                <Typography.Text type="secondary" className={styles.radioHint}>
                  {t(
                    "memory.extractConfig.modeIntervalHint",
                    "Organized in batches on a fixed cycle basis, which may include conversations that have not yet ended",
                  )}
                </Typography.Text>
              </Radio>
            </Space>
          </Radio.Group>

          <div className={styles.timeControl}>
            {mode === "idle" ? (
              <>
                <span>{t("memory.extractConfig.idlePrefix", "After")}</span>
                <InputNumber
                  min={MIN_IDLE_MINUTES}
                  max={7 * 24 * 60}
                  value={idleMinutes}
                  onChange={(value) =>
                    setIdleMinutes(
                      Math.max(MIN_IDLE_MINUTES, value ?? MIN_IDLE_MINUTES),
                    )
                  }
                />
                <span>{t("memory.extractConfig.minutes", "minutes of inactivity")}</span>
              </>
            ) : (
              <>
                <span>{t("memory.extractConfig.intervalPrefix", "Every")}</span>
                <InputNumber
                  min={MIN_INTERVAL_HOURS}
                  max={7 * 24}
                  step={0.5}
                  value={intervalHours}
                  onChange={(value) =>
                    setIntervalHours(value ?? MIN_INTERVAL_HOURS)
                  }
                />
                <span>{t("memory.extractConfig.hours", "hours")}</span>
              </>
            )}
          </div>

          {mode === "interval" ? (
            <Alert
              type="info"
              showIcon
              message={t(
                "memory.extractConfig.intervalNote",
                "Fixed intervals may run before the session ends; recommended in most scenarios “Conversation refined after free time”.",
              )}
            />
          ) : null}
        </fieldset>
      </Card>

      <Card
        className={`${styles.settingCard} ${
          !memoryEnabled ? styles.cardDisabled : ""
        }`}
      >
        <div className={styles.sectionHeading}>
          <span className={styles.settingIcon}>
            <Cpu size={18} />
          </span>
          <div>
            <div className={styles.settingTitle}>
              {t("memory.settings.extractModelTitle", "Extraction model")}
            </div>
            <div className={styles.settingDescription}>
              {t(
                "memory.settings.extractModelDescription",
                "The model invoked when refining memories. choose “Automatic” The default model used by the conversation follows; it is also possible to specify a cheaper or faster model specifically for refining.",
              )}
            </div>
          </div>
        </div>
        <fieldset className={styles.strategyFields} disabled={!memoryEnabled}>
          <Select
            style={{ minWidth: 280, maxWidth: 420 }}
            value={auxModel}
            loading={modelsLoading}
            disabled={!memoryEnabled}
            onChange={setAuxModel}
            options={buildModelSelectOptions(
              models,
              t("memory.settings.extractModelAuto", "Auto (follow chat model)"),
            )}
            showSearch
            optionFilterProp="label"
          />
        </fieldset>
      </Card>

      <div className={styles.saveBar}>
        <span>
          {t(
            "memory.settings.reloadHint",
            "After saving Agent It will be automatically reloaded and the current conversation will not be deleted.",
          )}
        </span>
        <Button type="primary" loading={saving} onClick={handleSave}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </div>
  );
}
