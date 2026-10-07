import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Spin,
  Switch,
} from "antd";
import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormInstance } from "antd";
import type { Rule } from "antd/es/form";
import {
  CHANNEL_FIELDS,
  CHANNEL_ICONS,
  CHANNEL_KEYS,
  CHANNEL_LABELS,
  CHANNEL_LABEL_KEYS,
  CHANNEL_URLS,
  DEFAULT_CHANNEL_DISPLAY_CONFIG,
  normalizeChannelFieldValue,
  type ChannelField,
  type ChannelKey,
} from "./constants";
import type { ChannelRow } from "../useChannels";
import styles from "../index.module.less";
import {
  clearFormDraft,
  loadFormDraft,
  saveFormDraft,
} from "../../../../utils/formDraft";

export interface ChannelFormValues {
  kind: ChannelKey;
  name?: string;
  enabled?: boolean;
  response_mode?: "invoke" | "stream";
  show_thinking?: boolean;
  show_tool_hints?: boolean;
  [k: string]: string | boolean | undefined;
  __raw_config?: string;
}

interface ChannelDrawerProps {
  open: boolean;
  editing: ChannelRow | null;
  loadingConfig: boolean;
  initialValues: ChannelFormValues | undefined;
  form: FormInstance<ChannelFormValues>;
  saving: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  onClose: () => void;
  onSubmit: (
    kind: ChannelKey,
    name: string,
    config: Record<string, unknown>,
    enabled: boolean,
  ) => Promise<boolean>;
  onTest?: () => void;
  testing?: boolean;
  agentId: string;
}

function FormItemForField({
  field,
  disabled = false,
}: {
  field: ChannelField;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const label = field.label.startsWith("channels.")
    ? t(field.label)
    : field.label;
  if (field.type === "switch") {
    return (
      <Form.Item
        name={field.name}
        label={label}
        valuePropName="checked"
        extra={field.helpKey ? t(field.helpKey) : undefined}
      >
        <Switch />
      </Form.Item>
    );
  }
  const Input1 =
    field.type === "password"
      ? Input.Password
      : field.type === "textarea" || field.type === "json"
      ? Input.TextArea
      : Input;
  const rules: Rule[] = field.required
    ? [
        {
          required: true,
          message: t("channels.fieldRequired", { label }),
        },
      ]
    : [];
  if (field.type === "json") {
    rules.push({
      validator: async (_: unknown, value: unknown) => {
        if (!value) return;
        try {
          normalizeChannelFieldValue(field.name, value);
        } catch {
          throw new Error(
            t("channels.fieldMustBeJsonObject", { label: field.label }),
          );
        }
      },
    });
  }
  if (
    field.name === "allowed_channel_ids" ||
    field.name === "allowed_user_ids"
  ) {
    rules.push({
      validator: async (_: unknown, value: unknown) => {
        try {
          normalizeChannelFieldValue(field.name, value);
        } catch {
          throw new Error(t("channels.discordInvalidIds"));
        }
      },
    });
  }
  return (
    <Form.Item name={field.name} label={label} rules={rules}>
      <Input1
        disabled={disabled}
        placeholder={field.placeholder}
        {...(field.type === "textarea" || field.type === "json"
          ? { rows: 5 }
          : {})}
      />
    </Form.Item>
  );
}

function DisplaySettingsFields() {
  const { t } = useTranslation();
  const responseMode =
    Form.useWatch("response_mode") ??
    DEFAULT_CHANNEL_DISPLAY_CONFIG.response_mode;
  const disableStreamToggles = responseMode === "invoke";
  return (
    <div className={styles.displaySettings}>
      <div className={styles.displaySettingsTitle}>
        {t("channels.channelSettings")}
      </div>
      <Form.Item
        name="enabled"
        label={t("channels.enableChannel")}
        tooltip={t("channels.enableChannelDesc")}
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item
        name="response_mode"
        label={t("channels.responseMode")}
        tooltip={t("channels.responseModeDesc")}
      >
        <Select
          options={[
            { label: t("channels.responseModeInvoke"), value: "invoke" },
            { label: t("channels.responseModeStream"), value: "stream" },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="show_thinking"
        label={t("channels.showThinking")}
        tooltip={t("channels.showThinkingDesc")}
        valuePropName="checked"
      >
        <Switch disabled={disableStreamToggles} />
      </Form.Item>
      <Form.Item
        name="show_tool_hints"
        label={t("channels.showToolHints")}
        tooltip={t("channels.showToolHintsDesc")}
        valuePropName="checked"
      >
        <Switch disabled={disableStreamToggles} />
      </Form.Item>
    </div>
  );
}

export function ChannelDrawer({
  open,
  editing,
  loadingConfig,
  initialValues,
  form,
  saving,
  onDelete,
  deleting,
  onClose,
  onSubmit,
  onTest,
  testing,
}: ChannelDrawerProps) {
  const { t } = useTranslation();
  const isEdit = editing !== null;
  const [selectedKind, setSelectedKind] = useState<ChannelKey>(
    initialValues?.kind ?? "discord",
  );
  const allowAllDiscordChannels =
    Form.useWatch("allow_all_channels", form) !== false;
  const draftScope = editing
    ? `channel:${editing.id}`
    : selectedKind
    ? `channel:new:${selectedKind}`
    : "";
  const restoringDraftRef = useRef(false);

  useEffect(() => {
    if (open && initialValues?.kind) {
      setSelectedKind(initialValues.kind);
    }
  }, [open, initialValues?.kind]);

  // Restore session draft after server/default values are applied.
  useEffect(() => {
    if (!open || loadingConfig || !draftScope) return;
    const draft = loadFormDraft<ChannelFormValues>(draftScope);
    if (!draft) return;
    restoringDraftRef.current = true;
    form.setFieldsValue(draft);
    if (draft.kind) setSelectedKind(draft.kind);
    restoringDraftRef.current = false;
  }, [open, loadingConfig, draftScope, form]);

  // ── Form ────────────────────────────────────────────────────────────────
  const fields = CHANNEL_FIELDS[selectedKind];
  const hasSchema = !!fields && fields.length > 0;
  const labelKey = CHANNEL_LABEL_KEYS[selectedKind];
  const kindLabel = labelKey ? t(labelKey) : CHANNEL_LABELS[selectedKind];
  const introUrl = CHANNEL_URLS[selectedKind];

  const handleFinish = (values: ChannelFormValues) => {
    const {
      kind,
      __raw_config,
      response_mode,
      show_thinking,
      show_tool_hints,
      ...rest
    } = values;
    let config: Record<string, unknown> = {};
    if (hasSchema) {
      for (const [k, v] of Object.entries(rest)) {
        if (
          k === "name" ||
          k === "enabled" ||
          v === undefined ||
          v === null ||
          v === ""
        ) {
          continue;
        }
        config[k] = normalizeChannelFieldValue(k, v);
      }
    } else if (__raw_config !== undefined) {
      const trimmed = __raw_config.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            config = parsed as Record<string, unknown>;
          }
        } catch {
          return;
        }
      }
    }
    config = {
      ...config,
      response_mode:
        response_mode ?? DEFAULT_CHANNEL_DISPLAY_CONFIG.response_mode,
      show_thinking:
        show_thinking ?? DEFAULT_CHANNEL_DISPLAY_CONFIG.show_thinking,
      show_tool_hints:
        show_tool_hints ?? DEFAULT_CHANNEL_DISPLAY_CONFIG.show_tool_hints,
    };
    void (async () => {
      const ok = await onSubmit(kind, kind, config, values.enabled ?? false);
      if (ok) clearFormDraft(draftScope);
    })();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Drawer
      width={460}
      placement="right"
      title={
        <div className={styles.drawerTitle}>
          {CHANNEL_ICONS[selectedKind] && (
            <img
              src={CHANNEL_ICONS[selectedKind]}
              alt={kindLabel}
              style={{ width: 22, height: 22 }}
            />
          )}
          <span>
            {isEdit
              ? t("channels.channelSettingsNamed", { kind: kindLabel })
              : t("channels.createChannel")}
          </span>
        </div>
      }
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        !loadingConfig ? (
          <div className={styles.drawerFooter}>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            {isEdit && onDelete && (
              <Popconfirm
                title={t("channels.deleteConfirmTitle", {
                  name: editing?.id ?? "",
                })}
                okText={t("common.delete")}
                cancelText={t("common.cancel")}
                okButtonProps={{ danger: true }}
                onConfirm={onDelete}
              >
                <Button danger loading={deleting}>
                  {t("common.delete")}
                </Button>
              </Popconfirm>
            )}
            {onTest && (
              <Button
                icon={<Activity size={14} />}
                loading={testing}
                onClick={onTest}
              >
                {t("channels.checkConnection")}
              </Button>
            )}
            <Button
              type="primary"
              loading={saving}
              onClick={() => form.submit()}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : null
      }
    >
      {loadingConfig ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : (
        <Form<ChannelFormValues>
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onFinish={handleFinish}
          onValuesChange={(changed, all) => {
            if (changed.kind) setSelectedKind(changed.kind as ChannelKey);
            if (!restoringDraftRef.current && draftScope) {
              saveFormDraft(
                draftScope,
                all as unknown as Record<string, unknown>,
              );
            }
          }}
        >
          <Form.Item
            name="kind"
            label={t("channels.channelType")}
            rules={[{ required: true }]}
          >
            <Select
              disabled={isEdit}
              options={CHANNEL_KEYS.map((k) => ({
                value: k,
                label: CHANNEL_LABELS[k],
              }))}
            />
          </Form.Item>

          {isEdit && editing && (
            <Form.Item label="Channel ID">
              <Input value={editing.id} readOnly />
            </Form.Item>
          )}

          {selectedKind === "discord" && (
            <Alert
              type="info"
              showIcon
              message={t("channels.discordSetupHelp")}
              style={{ marginBottom: 16 }}
            />
          )}

          {introUrl && (
            <div className={styles.channelIntroBanner}>
              <div className={styles.bannerText}>
                <div className={styles.bannerDesc}>
                  {t(`channels.intro_${selectedKind}`, kindLabel)}
                </div>
                <a
                  href={introUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.bannerLink}
                >
                  {t("channels.getCredentials")}
                  <span className={styles.bannerLinkArrow}>&#8250;</span>
                </a>
              </div>
            </div>
          )}

          {hasSchema ? (
            fields!.map((f) => (
              <FormItemForField
                key={f.name}
                field={f}
                disabled={
                  selectedKind === "discord" &&
                  f.name === "allowed_channel_ids" &&
                  allowAllDiscordChannels
                }
              />
            ))
          ) : (
            <Form.Item
              name="__raw_config"
              label="Config (JSON)"
              tooltip={t("channels.rawConfigTooltip")}
              rules={[
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    try {
                      const parsed = JSON.parse(value);
                      if (
                        !parsed ||
                        typeof parsed !== "object" ||
                        Array.isArray(parsed)
                      ) {
                        return Promise.reject(
                          new Error(t("channels.jsonMustBeObject")),
                        );
                      }
                      return Promise.resolve();
                    } catch {
                      return Promise.reject(
                        new Error(t("channels.invalidJson")),
                      );
                    }
                  },
                },
              ]}
            >
              <Input.TextArea
                rows={6}
                placeholder='{"app_id": "…", "app_secret": "…"}'
              />
            </Form.Item>
          )}

          <DisplaySettingsFields />
        </Form>
      )}
    </Drawer>
  );
}
