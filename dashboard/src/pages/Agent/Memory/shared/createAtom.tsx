/**
 * createAtom — modal for manually adding an Entity + AtomCard.
 */
import { useEffect } from "react";
import { Form, Input, Modal, Radio, Select } from "antd";
import { message } from "@/utils/antdMessage";
import { useTranslation } from "react-i18next";

import {
  memoryDashboardApi,
  type AtomItem,
  type AtomKind,
  type EntityItem,
} from "../../../../api/modules/memoryDashboard";

const KIND_OPTIONS: { value: AtomKind; label: string }[] = [
  { value: "Fact", label: "Facts" },
  { value: "Preference", label: "Preference" },
  { value: "Decision", label: "Decide" },
  { value: "Task", label: "Task" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "Fact", label: "Facts" },
  { value: "Person", label: "Characters" },
  { value: "User", label: "User" },
  { value: "Project", label: "Project" },
  { value: "Decision", label: "Decide" },
  { value: "Task", label: "Task" },
];

interface Props {
  open: boolean;
  agentId: string;
  entities: EntityItem[];
  /** When set, lock the form to this existing topic. */
  presetEntityId?: string;
  onClose: () => void;
  onSuccess?: (
    atom: AtomItem,
    entity: EntityItem,
    createdEntity: boolean,
  ) => void;
}

export default function CreateAtomModal({
  open,
  agentId,
  entities,
  presetEntityId,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const topicMode = Form.useWatch("topicMode", form) as
    | "existing"
    | "new"
    | undefined;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      topicMode: presetEntityId || entities.length > 0 ? "existing" : "new",
      entity_id: presetEntityId,
      entity_name: undefined,
      entity_type: "Fact",
      kind: "Fact",
      assertion: "",
    });
  }, [open, presetEntityId, entities.length, form]);

  const lockedToEntity = Boolean(presetEntityId);

  return (
    <Modal
      title={
        lockedToEntity
          ? t("memory.create.titleInTopic", "Add a memory under this topic")
          : t("memory.create.title", "New memory")
      }
      open={open}
      onCancel={onClose}
      okText={t("memory.create.ok", "Save")}
      cancelText={t("common.cancel", "Cancel")}
      destroyOnHidden
      onOk={async () => {
        const values = await form.validateFields();
        const assertion = String(values.assertion || "").trim();
        try {
          const body =
            values.topicMode === "new"
              ? {
                  assertion,
                  entity_name: String(values.entity_name || "").trim(),
                  entity_type: values.entity_type as string,
                  kind: values.kind as AtomKind,
                }
              : {
                  assertion,
                  entity_id: values.entity_id as string,
                  kind: values.kind as AtomKind,
                };
          const r = await memoryDashboardApi.createAtom(agentId, body);
          message.success(t("memory.create.success", "Memory added"));
          onSuccess?.(r.atom, r.entity, r.created_entity);
          onClose();
        } catch (e) {
          message.error(
            t("memory.create.failed", {
              message: (e as Error).message ?? e,
              defaultValue: "Add failed:{{message}}",
            }),
          );
          throw e;
        }
      }}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        {!lockedToEntity ? (
          <Form.Item name="topicMode" label={t("memory.create.topic", "Topic")}>
            <Radio.Group>
              <Radio.Button value="existing" disabled={entities.length === 0}>
                {t("memory.create.existingTopic", "Existing topic")}
              </Radio.Button>
              <Radio.Button value="new">
                {t("memory.create.newTopic", "New topic")}
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
        ) : null}

        {lockedToEntity || topicMode === "existing" ? (
          <Form.Item
            name="entity_id"
            label={
              lockedToEntity
                ? undefined
                : t("memory.create.pickTopic", "Choose a topic")
            }
            rules={
              lockedToEntity
                ? []
                : [
                    {
                      required: true,
                      message: t("memory.create.topicRequired", "Please choose a topic"),
                    },
                  ]
            }
            hidden={lockedToEntity}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={entities.map((e) => ({
                value: e.id,
                label: e.canonical_name,
              }))}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="entity_name"
              label={t("memory.create.topicName", "Topic name")}
              rules={[
                {
                  required: true,
                  message: t(
                    "memory.create.topicNameRequired",
                    "Please fill in the topic name",
                  ),
                },
              ]}
            >
              <Input
                placeholder={t(
                  "memory.create.topicNamePlaceholder",
                  "For example: drink preferences",
                )}
              />
            </Form.Item>
            <Form.Item
              name="entity_type"
              label={t("memory.create.topicType", "Topic type")}
            >
              <Select options={ENTITY_TYPE_OPTIONS} />
            </Form.Item>
          </>
        )}

        <Form.Item name="kind" label={t("memory.create.kind", "Memory type")}>
          <Select options={KIND_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="assertion"
          label={t("memory.create.assertion", "Memory")}
          rules={[
            {
              required: true,
              message: t("memory.create.assertionRequired", "Please enter the memory"),
            },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder={t(
              "memory.create.assertionPlaceholder",
              "For example: I like to drink Americano coffee",
            )}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
