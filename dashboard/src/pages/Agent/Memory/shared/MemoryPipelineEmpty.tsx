/**
 * MemoryPipelineEmpty — guided empty state for the memory tree / atom list.
 *
 * A bare <Empty> reads as "memory is broken" to users whose atoms haven't
 * been distilled yet, even though raw materials are being captured from the
 * very first conversation turn. This component checks stats_counts and, when
 * raw events exist, explains that distillation runs automatically after the
 * session goes idle — turning "it doesn't work" into "it's on its way".
 *
 * Degrades to the plain <Empty> whenever stats are unavailable (endpoint
 * missing in test mocks, request failure, older bridge), matching the
 * defensive pattern in LineageStrip.
 */

import { useEffect, useState } from "react";
import { Empty, Skeleton } from "antd";
import { useTranslation } from "react-i18next";

import {
  memoryDashboardApi,
  type StatsCounts,
} from "../../../../api/modules/memoryDashboard";

interface Props {
  agentId: string;
}

export default function MemoryPipelineEmpty({ agentId }: Props) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<StatsCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCounts(null);

    (async () => {
      try {
        if (typeof memoryDashboardApi.statsCounts !== "function") return;
        const c = await memoryDashboardApi
          .statsCounts(agentId)
          .catch(() => null);
        if (!cancelled) setCounts(c);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  }

  const rawCount = counts?.raw_events ?? 0;
  const pendingCount = counts?.candidates_pending ?? 0;

  if (rawCount <= 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t(
          "memory.pipeline.emptyNoRaw",
          "No memory yet. Once you start a conversation, the system automatically captures the footage and refines the memory.",
        )}
      />
    );
  }

  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t("memory.pipeline.emptyTitle", "Memories are still being distilled")}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--fn-text-tertiary, #8c8c8c)",
          maxWidth: 420,
          margin: "0 auto",
          lineHeight: 1.6,
        }}
      >
        {t(
          "memory.pipeline.emptyWithRaw",
          "Captured {{n}} Dialogue memory. Memory retrieval runs automatically after a session becomes idle, with the first memories usually appearing after a few rounds of dialogue.",
          { n: rawCount },
        )}
        {pendingCount > 0 ? (
          <>
            {" "}
            {t(
              "memory.pipeline.emptyPendingSuffix",
              "Also {{n}} Candidate memories are yet to be confirmed, please go to “Memory Precipitation” to view.",
              { n: pendingCount },
            )}
          </>
        ) : null}
      </div>
    </Empty>
  );
}
