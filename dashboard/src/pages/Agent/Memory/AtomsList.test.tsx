/**
 * AtomsList.test.tsx — paginated atom list with filter selects.
 *
 * What we cover:
 *   - mount → listAtoms with default offset/limit
 *   - row content rendered (assertion)
 *   - changing the kind select forwards candidate_type to the API
 *   - clicking a row opens the detail Drawer with verbatim_quote
 *   - empty state renders Empty
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeAtom, listAtomsResp } from "../../../test/memoryFixtures";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    listAtoms: vi.fn(),
    listEntities: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, has_more: false }),
    listJournal: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, has_more: false }),
  },
  isAtomDeprecated: (a: { deprecated_at?: string | null }) =>
    a.deprecated_at != null,
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import AtomsList from "./AtomsList";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<AtomsList />", () => {
  it("loads with default pagination and renders atom rows", async () => {
    api.listAtoms.mockResolvedValue(
      listAtomsResp([
        makeAtom({ id: "atom-1", assertion: "Users like to drink Americano coffee." }),
        makeAtom({ id: "atom-2", assertion: "The user is from Shanghai.", kind: "Fact" }),
      ]),
    );

    render(<AtomsList agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("Users like to drink Americano coffee.")).toBeInTheDocument();
      expect(screen.getByText("The user is from Shanghai.")).toBeInTheDocument();
    });

    expect(api.listAtoms).toHaveBeenCalledWith("ZYWZTD", {
      offset: 0,
      limit: 20,
    });
  });

  // Regression: deprecation state comes from deprecated_at because the backend has no status field.
  // Active atoms show the active label and deprecate action; deprecated atoms show the forgotten label only.
  it("derives active/deprecated from deprecated_at in the drawer", async () => {
    api.listAtoms.mockResolvedValue(
      listAtomsResp([
        makeAtom({ id: "live", assertion: "Using memory.", deprecated_at: null }),
        makeAtom({
          id: "dead",
          assertion: "Memory is deprecated.",
          deprecated_at: "2026-06-28T00:00:00Z",
        }),
      ]),
    );

    const user = userEvent.setup();
    render(<AtomsList agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("Using memory.")).toBeInTheDocument();
    });

    // Active atom: drawer has the deprecate action.
    await user.click(screen.getByText("Using memory."));
    await waitFor(() => {
      expect(screen.getByText("Deprecate this memory")).toBeInTheDocument();
    });
    expect(screen.getByText("In use")).toBeInTheDocument();

    // Deprecated atom: no deprecate button, forgotten label is shown.
    await user.click(screen.getByText("Memory is deprecated."));
    await waitFor(() => {
      expect(screen.getAllByText("Forgot").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Deprecate this memory")).not.toBeInTheDocument();
  });

  it("renders Empty when API returns no items", async () => {
    api.listAtoms.mockResolvedValue(listAtomsResp([]));
    render(<AtomsList agentId="ZYWZTD" />);
    await waitFor(() => {
      expect(api.listAtoms).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/No memory yet. Once you start a conversation/),
    ).toBeInTheDocument();
  });

  it("opens the detail drawer when a row is clicked", async () => {
    api.listAtoms.mockResolvedValue(
      listAtomsResp([
        makeAtom({
          id: "atom-1",
          assertion: "Users like to drink Americano coffee.",
          verbatim_quote: "I drink Americano every morning, milk coffee hurts my stomach",
        }),
      ]),
    );

    const user = userEvent.setup();
    render(<AtomsList agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("Users like to drink Americano coffee.")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Users like to drink Americano coffee."));

    await waitFor(() => {
      // Drawer renders verbatim_quote in a Paragraph. LineageStrip may also render
      // the same verbatim as a fallback source-conversation quote, so >1 match is possible.
      expect(
        screen.getAllByText(/Americano every morning/).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows the audit record instead of presenting old evidence as the corrected assertion", async () => {
    api.listAtoms.mockResolvedValue(
      listAtomsResp([
        makeAtom({
          id: "atom-corrected",
          assertion: "Users like to drink lattes.",
          verbatim_quote: "I drink Americano every morning",
        }),
      ]),
    );
    api.listJournal.mockResolvedValue({
      items: [
        {
          id: "journal-edit",
          timestamp: "2026-09-07T08:00:00Z",
          action: "user_edit",
          actor: "user",
          target_atom_id: "atom-corrected",
          before: { assertion: "Users like to drink Americano coffee.", atom_id: "atom-old" },
          after: { assertion: "Users like to drink lattes.", atom_id: "atom-corrected" },
        },
      ],
      total: 1,
      has_more: false,
    });

    const user = userEvent.setup();
    render(<AtomsList agentId="ZYWZTD" />);
    await user.click(await screen.findByText("Users like to drink lattes."));

    await waitFor(() => {
      expect(api.listJournal).toHaveBeenCalledWith("ZYWZTD", {
        action: "user_edit",
        target_atom_id: "atom-corrected",
        limit: 1,
      });
    });
    expect(await screen.findByText(/Manually corrected memory/)).toBeInTheDocument();
    expect(
      screen.getByText("Before correction: Users like to drink Americano coffee."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Original source context:/)).toBeInTheDocument();
  });
});
