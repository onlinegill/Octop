import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAtomsResp,
  listEntitiesResp,
  makeAtom,
  makeEntity,
} from "../../../test/memoryFixtures";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    listEntities: vi.fn(),
    listAtoms: vi.fn(),
    listJournal: vi.fn(),
  },
  isAtomDeprecated: (atom: { deprecated_at?: string | null }) =>
    atom.deprecated_at != null,
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import MemoryTree from "./MemoryTree";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<MemoryTree />", () => {
  it("shows correction audit in the tree detail drawer", async () => {
    api.listEntities.mockResolvedValue(
      listEntitiesResp([
        makeEntity({
          id: "entity-project",
          canonical_name: "Pindou workbench",
          atom_count: 1,
        }),
      ]),
    );
    api.listAtoms.mockResolvedValue(
      listAtomsResp([
        makeAtom({
          id: "atom-corrected",
          entity_id: "entity-project",
          candidate_id: "",
          assertion: "The penguin image has been adjusted.",
          verbatim_quote: "Unlike Penguin, it needs to be readjusted.",
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
          before: {
            assertion: "Unlike Penguin, it needs to be readjusted.",
            atom_id: "atom-old",
          },
          after: {
            assertion: "The penguin image has been adjusted.",
            atom_id: "atom-corrected",
          },
        },
      ],
      total: 1,
      has_more: false,
    });

    const user = userEvent.setup();
    render(<MemoryTree agentId="main" />);

    await user.click(await screen.findByText("Pindou workbench"));
    await user.click(await screen.findByText("The penguin image has been adjusted."));

    await waitFor(() => {
      expect(api.listJournal).toHaveBeenCalledWith("main", {
        action: "user_edit",
        target_atom_id: "atom-corrected",
        limit: 1,
      });
    });
    expect(await screen.findByText(/Artificially corrected memory/)).toBeInTheDocument();
    expect(
      screen.getByText("Before correction: Penguin does not look like it and needs to be readjusted."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Original source context:/)).toBeInTheDocument();
  });
});
