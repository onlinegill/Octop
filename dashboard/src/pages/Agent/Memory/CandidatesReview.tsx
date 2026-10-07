/**
 * CandidatesReview.tsx — pending Candidate inbox.
 *
 * The candidate-review tab on the Memory page. Lists L1 Candidate rows
 * extracted by the LLM and lets the user promote them to atoms
 * or reject them. Both actions hit the same dashboard surface
 * the bridge already exposes (``promoteCandidate`` / ``rejectCandidate``).
 *
 * MVP scope:
 *   - status / candidate_type filters (defaults status = "pending")
 *   - row-level promote / reject buttons (promote is double-confirmed;
 *     reject opens a small modal so the user can attach a reason)
 *   - click the row → drawer with full Candidate detail (assertion,
 *     verbatim quote, raw_event ids, importance, etc.)
 *
 * Out of scope (deferred):
 *   - bulk select / bulk promote
 *   - inline editing of the candidate before promotion
 *   - the candidate diff view (vs existing atoms) — covered elsewhere.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { message } from "@/utils/antdMessage";

import { useTranslation } from "react-i18next";

import {
  memoryDashboardApi,
  type AtomKind,
  type CandidateItem,
  type CandidateStatus,
  type ListCandidatesBody,
} from "../../../api/modules/memoryDashboard";
import { useIsMobile } from "../../../hooks/useIsMobile";
import styles from "./CandidatesReview.module.less";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: CandidateStatus | ""; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "needs_review", label: "To be reviewed" },
  { value: "conflict", label: "Possible conflict" },
  { value: "promoted", label: "Adopted" },
  { value: "rejected", label: "Ignored" },
  { value: "", label: "All" },
];

const KIND_OPTIONS: { value: AtomKind | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "Fact", label: "Facts" },
  { value: "Decision", label: "Decide" },
  { value: "Task", label: "Task" },
  { value: "Preference", label: "Preference" },
  { value: "ConflictCandidate", label: "Possible conflict" },
];

interface Props {
  agentId: string;
}

export default function CandidatesReview({ agentId }: Props) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [items, setItems] = useState<CandidateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<CandidateStatus | "">("");
  const [kind, setKind] = useState<AtomKind | "">("");
  const [selected, setSelected] = useState<CandidateItem | null>(null);

  // reject-with-reason modal
  const [rejectTarget, setRejectTarget] = useState<CandidateItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // per-row pending state so the spinning button is local, not global
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const body: ListCandidatesBody = {
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    };
    if (status) body.status = status;
    if (kind) body.candidate_type = kind;
    try {
      const r = await memoryDashboardApi.listCandidates(agentId, body);
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error((e as Error).message ?? "load failed");
    } finally {
      setLoading(false);
    }
    // ``t`` is intentionally NOT a dependency — the i18n hook returns
    // a fresh ``t`` ref on every render, which would re-fire the load
    // effect on every keystroke / hover.
  }, [agentId, page, status, kind]);

  useEffect(() => {
    if (!agentId) return;
    void load();
  }, [agentId, load]);

  const handlePromote = async (c: CandidateItem) => {
    setBusyId(c.id);
    try {
      const r = await memoryDashboardApi.promoteCandidate(agentId, c.id);
      const detail =
        r.merged > 0
          ? `Merge with existing memory ${r.merged} Article`
          : r.needs_review > 0
          ? `Need to review ${r.needs_review} Article`
          : `Add new adoption ${r.promoted} Article`;
      message.success(
        t("memory.candidates.promoteOk", "Adopted") + ` · ${detail}`,
      );
      void load();
    } catch (e) {
      message.error((e as Error).message ?? "Operation failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      await memoryDashboardApi.rejectCandidate(agentId, rejectTarget.id, {
        reason: rejectReason.trim() || undefined,
      });
      message.success(t("memory.candidates.rejectOk", "Discarded"));
      setRejectTarget(null);
      setRejectReason("");
      void load();
    } catch (e) {
      message.error((e as Error).message ?? "Operation failed");
    } finally {
      setRejecting(false);
    }
  };

  return (
    <Card size="small" className={styles.candidatesCard}>
      <GuidanceBanner status={status} />
      <div className={styles.candidatesFilters}>
        <div className={styles.candidatesFilterField}>
          <span className={styles.candidatesFilterLabel}>
            {t("memory.candidates.statusLabel", "Status")}
          </span>
          <Select
            className={styles.candidatesFilterSelect}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className={styles.candidatesFilterField}>
          <span className={styles.candidatesFilterLabel}>
            {t("memory.candidates.kindLabel", "Type")}
          </span>
          <Select
            className={styles.candidatesFilterSelect}
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            options={KIND_OPTIONS}
          />
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Skeleton active />
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("memory.candidates.empty", "No memory content yet")}
        />
      ) : (
        <ul className={styles.candidateList}>
          {items.map((c) => {
            const decided = c.status === "promoted" || c.status === "rejected";
            return (
              <li key={c.id} className={styles.candidateRow}>
                <div
                  className={styles.candidateMain}
                  onClick={() => setSelected(c)}
                >
                  <Space size={4} wrap>
                    <Tag color={kindColor(c.candidate_type)}>
                      {kindLabel(c.candidate_type)}
                    </Tag>
                    <Tag color={statusColor(c.status)}>
                      {statusLabel(c.status)}
                    </Tag>
                    <ImportanceStars importance={c.importance} />
                  </Space>
                  <div className={styles.candidateTitle}>
                    {c.title || c.assertion}
                  </div>
                  <div className={styles.candidateMeta}>
                    “{c.verbatim_quote}” · {c.subject_name}
                  </div>
                </div>
                <div className={styles.candidateActions}>
                  <Popconfirm
                    title={t(
                      "memory.candidates.confirmPromote",
                      "Adopt this memory?",
                    )}
                    okText={t("common.confirm", "Confirm")}
                    cancelText={t("common.cancel", "Cancel")}
                    disabled={decided}
                    onConfirm={() => void handlePromote(c)}
                  >
                    <Button
                      type="primary"
                      size="small"
                      loading={busyId === c.id}
                      disabled={decided}
                    >
                      {t("memory.candidates.promote", "Adopt")}
                    </Button>
                  </Popconfirm>
                  <Button
                    danger
                    size="small"
                    disabled={decided}
                    onClick={() => {
                      setRejectTarget(c);
                      setRejectReason("");
                    }}
                  >
                    {t("memory.candidates.reject", "Discard")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.candidatesPagination}>
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          onChange={setPage}
          size={isMobile ? "small" : "default"}
        />
      </div>

      <Drawer
        title={t("memory.candidates.detail", "Memory draft detail")}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={isMobile ? "100%" : 560}
      >
        {selected ? (
          <div>
            <Space size={4} wrap style={{ marginBottom: 12 }}>
              <Tag color={kindColor(selected.candidate_type)}>
                {kindLabel(selected.candidate_type)}
              </Tag>
              <Tag color={statusColor(selected.status)}>
                {statusLabel(selected.status)}
              </Tag>
              <ImportanceStars importance={selected.importance} />
            </Space>
            <Typography.Title level={5}>Draft content</Typography.Title>
            <Typography.Paragraph>{selected.assertion}</Typography.Paragraph>
            <Typography.Title level={5}>Original story based on</Typography.Title>
            <Typography.Paragraph type="secondary">
              “{selected.verbatim_quote}”
            </Typography.Paragraph>
            <Typography.Title level={5}>Octop Suggestions</Typography.Title>
            <Typography.Paragraph>
              {selected.recommended_action}
              {selected.promotion_reason
                ? ` — ${selected.promotion_reason}`
                : ""}
            </Typography.Paragraph>
            <Typography.Title level={5}>About whom / What</Typography.Title>
            <Typography.Paragraph>{selected.subject_name}</Typography.Paragraph>
          </div>
        ) : null}
      </Drawer>

      <Modal
        title={t("memory.candidates.rejectTitle", "Discard this draft")}
        open={!!rejectTarget}
        confirmLoading={rejecting}
        okText={t("memory.candidates.confirmReject", "Confirm discard")}
        cancelText={t("common.cancel", "Cancel")}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (rejecting) return;
          setRejectTarget(null);
          setRejectReason("");
        }}
        onOk={() => void handleReject()}
      >
        <Typography.Paragraph>
          {t(
            "memory.candidates.rejectHint",
            "If ignored, this memory will not enter long-term memory. You can choose to fill in the reason for easy review in the future.",
          )}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={t(
            "memory.candidates.rejectReasonPlaceholder",
            "The reason is optional, for example: Expired / Wrong record / Not important",
          )}
        />
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Guidance banner — shown above the filter bar for actionable statuses
// ---------------------------------------------------------------------------

function GuidanceBanner({ status }: { status: CandidateStatus | "" }) {
  if (status === "pending") {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="About “pending” drafts"
        description={
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: "1.8" }}>
            <li>These drafts are produced by Octop Automatically extracted from the conversation and waiting for system rule judgment.</li>
            <li>
              The system will automatically decide: adopt it directly, merge it into existing memory, mark it for review or discard it.——
              <strong>No manual intervention required</strong>.
            </li>
            <li>
              If you need to deal with it in advance, you can switch to the “Pending Review” or “Possible Conflict” status to view the drafts that require your decision-making.
            </li>
          </ul>
        }
      />
    );
  }

  if (status === "needs_review") {
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 14 }}
        message="About the draft “To be reviewed”"
        description={
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: "1.8" }}>
            <li>
              <strong>Adopt</strong> → Enter long-term memory immediately and use it first in the next conversation.
            </li>
            <li>
              <strong>Ignore</strong> →
              It will not be entered into long-term memory, but reasons can be attached (saved in the operation log for easy review in the future).
            </li>
            <li>
              <strong>⏰ If 7 Not processed within days</strong>
              , the system will automatically add it to the long-term memory, but the confidence level is low and the order is lower, so it will not affect the main dialogue.
            </li>
          </ul>
        }
      />
    );
  }

  if (status === "conflict") {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 14 }}
        message="About the “Possible Conflict” draft"
        description={
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: "1.8" }}>
            <li>
              These drafts are inconsistent with existing long-term memory, and the system cannot automatically determine which one is accurate. It is up to you to decide.
            </li>
            <li>
              <strong>Adopt</strong> → Use this draft as the guideline for long-term memory.
            </li>
            <li>
              <strong>Ignore</strong> → Keep the original memory unchanged.
            </li>
            <li>
              <strong>⚠️ Conflict drafts have no automatic timeout</strong>
              , it will stay in this queue if not processed.
            </li>
          </ul>
        }
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function kindColor(k: string): string {
  switch (k) {
    case "Fact":
      return "default";
    case "Decision":
      return "geekblue";
    case "Task":
      return "orange";
    case "Preference":
      return "green";
    case "ConflictCandidate":
      return "red";
    default:
      return "default";
  }
}

function kindLabel(k: string): string {
  switch (k) {
    case "Fact":
      return "Facts";
    case "Decision":
      return "Decide";
    case "Task":
      return "Task";
    case "Preference":
      return "Preference";
    case "ConflictCandidate":
      return "Possible conflict";
    default:
      return k;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "pending":
      return "blue";
    case "needs_review":
      return "orange";
    case "conflict":
      return "red";
    case "promoted":
      return "green";
    case "rejected":
      return "default";
    default:
      return "default";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "pending":
      return "Pending";
    case "needs_review":
      return "To be reviewed";
    case "conflict":
      return "Possible conflict";
    case "promoted":
      return "Adopted";
    case "rejected":
      return "Ignored";
    default:
      return s;
  }
}
function ImportanceStars({ importance }: { importance: string }) {
  const n = importance === "high" ? 3 : importance === "medium" ? 2 : 1;
  return (
    <span
      title={`Importance:${
        importance === "high"
          ? "Very important"
          : importance === "medium"
          ? "Important"
          : "Average"
      }`}
      style={{ color: "#faad14", fontSize: 13, letterSpacing: 1 }}
    >
      {"★".repeat(n)}
      <span style={{ color: "#d9d9d9" }}>{"★".repeat(3 - n)}</span>
    </span>
  );
}
