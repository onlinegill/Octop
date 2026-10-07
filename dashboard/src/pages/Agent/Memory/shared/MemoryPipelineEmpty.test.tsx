/**
 * MemoryPipelineEmpty.test.tsx — guided empty state for tree / atom list.
 *
 * Coverage:
 *   - raw material present -> "distilling" copy with raw count
 *   - pending candidates append the review suffix
 *   - zero raw events -> plain "start chatting" empty
 *   - stats failure degrades to the no-raw empty (never crashes)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { statsCountsFixture } from "../../../../test/memoryFixtures";

vi.mock("../../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    statsCounts: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../../api/modules/memoryDashboard";
import MemoryPipelineEmpty from "./MemoryPipelineEmpty";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<MemoryPipelineEmpty />", () => {
  it("explains distillation when raw material exists but atoms don't", async () => {
    api.statsCounts.mockResolvedValue(
      statsCountsFixture({ raw_events: 42, atoms: 0, candidates_pending: 0 }),
    );

    render(<MemoryPipelineEmpty agentId="A1" />);

    await waitFor(() => {
      expect(screen.getByText("Memories are still being distilled")).toBeInTheDocument();
    });
    expect(screen.getByText(/Captured 42 Dialogue memory/)).toBeInTheDocument();
    expect(screen.queryByText(/Candidate memory to be confirmed/)).not.toBeInTheDocument();
    expect(api.statsCounts).toHaveBeenCalledWith("A1");
  });

  it("appends the pending-review suffix when candidates are waiting", async () => {
    api.statsCounts.mockResolvedValue(
      statsCountsFixture({ raw_events: 42, atoms: 0, candidates_pending: 3 }),
    );

    render(<MemoryPipelineEmpty agentId="A1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Also 3 Candidate memories are yet to be confirmed/),
      ).toBeInTheDocument();
    });
  });

  it("shows the start-chatting empty when nothing was captured yet", async () => {
    api.statsCounts.mockResolvedValue(
      statsCountsFixture({ raw_events: 0, atoms: 0, candidates_pending: 0 }),
    );

    render(<MemoryPipelineEmpty agentId="A1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/No memory yet. Once you start a conversation/),
      ).toBeInTheDocument();
    });
  });

  it("degrades to the plain empty when stats loading fails", async () => {
    api.statsCounts.mockRejectedValue(new Error("boom"));

    render(<MemoryPipelineEmpty agentId="A1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/No memory yet. Once you start a conversation/),
      ).toBeInTheDocument();
    });
  });
});
