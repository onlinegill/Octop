import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  statsAtomKindsFixture,
  statsCountsFixture,
  statsGrowthFixture,
} from "../../../test/memoryFixtures";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 240 }}>{children}</div>
    ),
  };
});

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    statsCounts: vi.fn(),
    statsAtomKinds: vi.fn(),
    statsGrowth: vi.fn(),
    getExtractConfig: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import Overview from "./Overview";

const api = vi.mocked(memoryDashboardApi, true);

const memoryConfig = {
  memory_enabled: true,
  extract_on_session_end: true,
  extract_trigger_mode: "idle" as const,
  extract_idle_seconds: 300,
  extract_interval_seconds: 21600,
};

function stubOverview() {
  api.statsCounts.mockResolvedValue(statsCountsFixture());
  api.statsAtomKinds.mockResolvedValue(statsAtomKindsFixture());
  api.statsGrowth.mockResolvedValue(statsGrowthFixture());
  api.getExtractConfig.mockResolvedValue(memoryConfig);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<Overview />", () => {
  it("renders a compact status, metrics, pipeline, and charts", async () => {
    stubOverview();
    render(<Overview agentId="ZYWZTD" />);

    await screen.findByText("Memory overview");
    expect(screen.getByText("Memory running")).toBeInTheDocument();
    expect(screen.getAllByText("Long term memory").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Key themes")).toBeInTheDocument();
    expect(screen.getByText("Memory processing progress")).toBeInTheDocument();
    expect(screen.getByText("Near 7 Daily dialogue rounds")).toBeInTheDocument();
    expect(screen.getByText("Near 7 Day memory growth")).toBeInTheDocument();
    expect(screen.getByText("Memory type")).toBeInTheDocument();

    expect(api.statsGrowth).toHaveBeenCalledWith("ZYWZTD", 7);
    expect(api.getExtractConfig).toHaveBeenCalledWith("ZYWZTD");
  });

  it("shows the disabled memory state", async () => {
    stubOverview();
    api.getExtractConfig.mockResolvedValue({
      ...memoryConfig,
      memory_enabled: false,
    });
    render(<Overview agentId="ZYWZTD" />);
    expect(await screen.findByText("Memory is off")).toBeInTheDocument();
  });

  it("keeps memory enabled for responses from an older API process", async () => {
    stubOverview();
    const { memory_enabled: _legacyMissingField, ...legacyConfig } =
      memoryConfig;
    api.getExtractConfig.mockResolvedValue(legacyConfig);
    render(<Overview agentId="ZYWZTD" />);
    expect(await screen.findByText("Memory running")).toBeInTheDocument();
  });

  it("supports pipeline and settings navigation", async () => {
    stubOverview();
    const onViewConversations = vi.fn();
    const onReviewCandidates = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <Overview
        agentId="ZYWZTD"
        onViewConversations={onViewConversations}
        onReviewCandidates={onReviewCandidates}
        onOpenSettings={onOpenSettings}
      />,
    );

    await screen.findByText("Memory processing progress");
    fireEvent.click(screen.getByRole("button", { name: /Dialogue memory/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onViewConversations).toHaveBeenCalledOnce();
    expect(onReviewCandidates).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("isolates partial endpoint failures", async () => {
    api.statsCounts.mockRejectedValue(new Error("counts"));
    api.statsAtomKinds.mockRejectedValue(new Error("kinds"));
    api.statsGrowth.mockRejectedValue(new Error("growth"));
    api.getExtractConfig.mockRejectedValue(new Error("config"));
    render(<Overview agentId="ZYWZTD" />);

    await screen.findByText("Memory overview");
    expect(screen.getByText("No memory type data yet")).toBeInTheDocument();
    expect(screen.getByText("Near 7 No dialogue rounds for the day")).toBeInTheDocument();
    expect(screen.getByText("Near 7 No new additions for days")).toBeInTheDocument();
  });

  it("refreshes all overview sources", async () => {
    stubOverview();
    render(<Overview agentId="ZYWZTD" />);
    await waitFor(() => expect(api.statsCounts).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.statsCounts).toHaveBeenCalledTimes(2));
    expect(api.getExtractConfig).toHaveBeenCalledTimes(2);
  });
});
