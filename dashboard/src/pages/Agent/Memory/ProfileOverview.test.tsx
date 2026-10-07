import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import {
  makeAtom,
  makeEntity,
  listAtomsResp,
  statsCountsFixture,
  terminalAtomResp,
  terminalEntityResp,
} from "../../../test/memoryFixtures";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    terminalAboutMe: vi.fn(),
    terminalCurrentFocus: vi.fn(),
    terminalThingsYouToldMe: vi.fn(),
    terminalEntities: vi.fn(),
    statsCounts: vi.fn(),
    listAtoms: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import ProfileOverview from "./ProfileOverview";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

function stubProfile() {
  api.terminalAboutMe.mockResolvedValue(
    terminalAtomResp([makeAtom({ id: "a1", assertion: "You only drink Americano." })]),
  );
  api.terminalCurrentFocus.mockResolvedValue(
    terminalAtomResp([
      makeAtom({
        id: "a2",
        assertion: "You are writing a design document for a memory module.",
        kind: "Task",
      }),
    ]),
  );
  api.terminalThingsYouToldMe.mockResolvedValue(
    terminalAtomResp([
      makeAtom({ id: "a3", assertion: "Were you born in1995Years.", kind: "Fact" }),
    ]),
  );
  api.terminalEntities.mockResolvedValue(
    terminalEntityResp([
      makeEntity({
        id: "e1",
        canonical_name: "Bo5hengProject",
        entity_type: "Project",
      }),
    ]),
  );
  api.statsCounts.mockResolvedValue(
    statsCountsFixture({ atoms: 127, entities: 18 }),
  );
  api.listAtoms.mockResolvedValue(
    listAtomsResp([
      makeAtom({ id: "a1", confidence: "high" }),
      makeAtom({ id: "a2", confidence: "medium" }),
    ]),
  );
}

describe("<ProfileOverview />", () => {
  it("fans out to profile endpoints and renders the four profile cards", async () => {
    stubProfile();

    render(<ProfileOverview agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getAllByText(/User portrait/).length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/Just drink Americano coffee/)).toBeInTheDocument();
    expect(screen.getByText(/Memory module design documentation/)).toBeInTheDocument();
    expect(screen.getByText(/Born in1995Year/)).toBeInTheDocument();
    expect(screen.getByText("Bo5hengProject")).toBeInTheDocument();
    expect(screen.getByText("About you")).toBeInTheDocument();
    expect(screen.getByText("Current focus")).toBeInTheDocument();
    expect(screen.getByText("The facts you mentioned")).toBeInTheDocument();
    expect(screen.getByText("Key people and things")).toBeInTheDocument();

    expect(api.terminalAboutMe).toHaveBeenCalledWith("ZYWZTD", 12);
    expect(api.terminalCurrentFocus).toHaveBeenCalledWith("ZYWZTD", 12);
    expect(api.terminalThingsYouToldMe).toHaveBeenCalledWith("ZYWZTD", 12);
    expect(api.terminalEntities).toHaveBeenCalledWith("ZYWZTD", 12);
    expect(api.statsCounts).toHaveBeenCalledWith("ZYWZTD");
  });

  it("survives partial endpoint failures", async () => {
    api.terminalAboutMe.mockRejectedValue(new Error("about me boom"));
    api.terminalCurrentFocus.mockResolvedValue(terminalAtomResp([]));
    api.terminalThingsYouToldMe.mockResolvedValue(terminalAtomResp([]));
    api.terminalEntities.mockResolvedValue(terminalEntityResp([]));
    api.statsCounts.mockResolvedValue(statsCountsFixture());
    api.listAtoms.mockResolvedValue(listAtomsResp([]));

    render(<ProfileOverview agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getAllByText(/User portrait/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Octop Still getting to know you/)).toBeInTheDocument();
  });

  it("caps a section at 6 rows and shows View all that calls onViewAll", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      makeAtom({ id: `m${i}`, assertion: `About you entry${i + 1}` }),
    );
    api.terminalAboutMe.mockResolvedValue(terminalAtomResp(many));
    api.terminalCurrentFocus.mockResolvedValue(terminalAtomResp([]));
    api.terminalThingsYouToldMe.mockResolvedValue(terminalAtomResp([]));
    api.terminalEntities.mockResolvedValue(terminalEntityResp([]));
    api.statsCounts.mockResolvedValue(statsCountsFixture());
    api.listAtoms.mockResolvedValue(listAtomsResp([]));

    const onViewAll = vi.fn();
    render(<ProfileOverview agentId="ZYWZTD" onViewAll={onViewAll} />);

    await waitFor(() => {
      expect(screen.getByText("About you entry1")).toBeInTheDocument();
    });
    // Visible rows are capped at 6: the 6th row exists, the 7th does not.
    expect(screen.getByText("About you entry6")).toBeInTheDocument();
    expect(screen.queryByText("About you entry7")).not.toBeInTheDocument();

    const viewAll = screen.getByRole("button", { name: /View all/ });
    fireEvent.click(viewAll);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("does not call endpoints when agentId is empty", () => {
    render(<ProfileOverview agentId="" />);
    expect(api.terminalAboutMe).not.toHaveBeenCalled();
    expect(api.statsCounts).not.toHaveBeenCalled();
  });

  it("refresh button triggers another profile fan-out", async () => {
    stubProfile();

    render(<ProfileOverview agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(api.statsCounts).toHaveBeenCalledTimes(1);
    });

    const refreshBtn = screen.getByRole("button");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.statsCounts).toHaveBeenCalledTimes(2);
      expect(api.terminalAboutMe).toHaveBeenCalledTimes(2);
    });
  });
});
