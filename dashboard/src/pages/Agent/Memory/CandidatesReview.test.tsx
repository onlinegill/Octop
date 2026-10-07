/**
 * CandidatesReview.test.tsx — pending Candidate inbox.
 *
 * What we cover:
 *   - mount → listCandidates without a status filter (All) by default
 *   - row renders title + verbatim_quote + subject_name
 *   - clicking the promote button opens the Popconfirm, confirming
 *     fires promoteCandidate and re-loads the list
 *   - clicking the reject button opens the Modal, submitting calls
 *     rejectCandidate with the reason and re-loads the list
 *   - empty state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  listCandidatesResp,
  makeCandidate,
  promoteResp,
  rejectResp,
} from "../../../test/memoryFixtures";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    listCandidates: vi.fn(),
    promoteCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import CandidatesReview from "./CandidatesReview";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<CandidatesReview />", () => {
  it("loads all candidates by default and renders title + quote", async () => {
    api.listCandidates.mockResolvedValue(
      listCandidatesResp([
        makeCandidate({
          id: "cand-1",
          title: "Coffee preference",
          verbatim_quote: "I have to drink Americano every day",
          subject_name: "User",
        }),
      ]),
    );

    render(<CandidatesReview agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("Coffee preference")).toBeInTheDocument();
    });

    expect(api.listCandidates).toHaveBeenCalledWith("ZYWZTD", {
      offset: 0,
      limit: 20,
    });
    // verbatim quote and subject_name render in the meta line
    expect(
      screen.getByText(/I have to drink Americano every day/),
    ).toBeInTheDocument();
  });

  it("promotes a candidate via Popconfirm and re-loads", async () => {
    api.listCandidates.mockResolvedValue(
      listCandidatesResp([makeCandidate({ id: "cand-1", title: "Coffee preference" })]),
    );
    api.promoteCandidate.mockResolvedValue(promoteResp());

    const user = userEvent.setup();
    render(<CandidatesReview agentId="ZYWZTD" />);

    await waitFor(() =>
      expect(screen.getByText("Coffee preference")).toBeInTheDocument(),
    );

    const promoteBtn = screen.getByRole("button", { name: /Adopt/ });
    await user.click(promoteBtn);

    // Popconfirm okText renders as the shared "Confirm" label.
    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/ });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.promoteCandidate).toHaveBeenCalledWith("ZYWZTD", "cand-1");
    });
    // listCandidates was called twice: initial + reload after promote
    await waitFor(() => {
      expect(api.listCandidates).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects a candidate with a typed reason via Modal", async () => {
    api.listCandidates.mockResolvedValue(
      listCandidatesResp([makeCandidate({ id: "cand-1", title: "Questionable facts" })]),
    );
    api.rejectCandidate.mockResolvedValue(rejectResp());

    const user = userEvent.setup();
    render(<CandidatesReview agentId="ZYWZTD" />);

    await waitFor(() =>
      expect(screen.getByText("Questionable facts")).toBeInTheDocument(),
    );

    const rejectBtn = screen.getByRole("button", { name: /Discard/ });
    await user.click(rejectBtn);

    await waitFor(() => {
      expect(screen.getByText("Discard this draft")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/reason is optional/);
    await user.type(textarea, "Duplicate information");

    const okBtn = screen.getByRole("button", { name: /Confirm discard/ });
    await user.click(okBtn);

    await waitFor(() => {
      expect(api.rejectCandidate).toHaveBeenCalledWith("ZYWZTD", "cand-1", {
        reason: "Duplicate information",
      });
    });
    await waitFor(() => {
      expect(api.listCandidates).toHaveBeenCalledTimes(2);
    });
  });

  it("renders the empty placeholder when no candidates match", async () => {
    api.listCandidates.mockResolvedValue(listCandidatesResp([]));
    render(<CandidatesReview agentId="ZYWZTD" />);
    await waitFor(() => expect(api.listCandidates).toHaveBeenCalled());
    expect(screen.getByText("No memory content yet")).toBeInTheDocument();
  });

  it("disables promote/reject buttons for already-decided candidates", async () => {
    api.listCandidates.mockResolvedValue(
      listCandidatesResp([
        makeCandidate({
          id: "cand-1",
          title: "Candidates for promotion",
          status: "promoted",
          decided_at: "2026-06-29T10:00:00Z",
          decided_by: "user",
        }),
      ]),
    );

    render(<CandidatesReview agentId="ZYWZTD" />);
    await waitFor(() =>
      expect(screen.getByText("Candidates for promotion")).toBeInTheDocument(),
    );

    const promoteBtn = screen.getByRole("button", { name: /Adopt/ });
    const rejectBtn = screen.getByRole("button", { name: /Discard/ });
    expect(promoteBtn).toBeDisabled();
    expect(rejectBtn).toBeDisabled();
  });
});
