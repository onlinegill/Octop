/**
 * EpisodesList.test.tsx — paginated episode list + detail drawer.
 *
 * What we cover:
 *   - mount → listEpisodes with default pagination
 *   - row renders summary + emotion tag + topics
 *   - clicking a row opens drawer showing verbatim_quote and people
 *   - empty state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeEpisode, listEpisodesResp } from "../../../test/memoryFixtures";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    listEpisodes: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import EpisodesList from "./EpisodesList";

const api = vi.mocked(memoryDashboardApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<EpisodesList />", () => {
  it("loads episodes and renders summary + topic tags", async () => {
    api.listEpisodes.mockResolvedValue(
      listEpisodesResp([
        makeEpisode({
          id: "ep-1",
          summary: "I watched a touching movie over the weekend.",
          topics: ["movie", "weekend", "emotion"],
        }),
      ]),
    );

    render(<EpisodesList agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("I watched a touching movie over the weekend.")).toBeInTheDocument();
    });

    expect(api.listEpisodes).toHaveBeenCalledWith("ZYWZTD", {
      offset: 0,
      limit: 20,
    });
    // first 3 topic tags rendered (component slices to 3)
    expect(screen.getByText("movie")).toBeInTheDocument();
    expect(screen.getByText("weekend")).toBeInTheDocument();
  });

  it("opens detail drawer with verbatim_quote + people on row click", async () => {
    api.listEpisodes.mockResolvedValue(
      listEpisodesResp([
        makeEpisode({
          id: "ep-1",
          summary: "I did a project with Xiao Li.",
          verbatim_quote: "Last week, Xiao Li and I paired up and programmed, and finally completed it at three in the morning.",
          people: ["Xiao Li"],
          topics: ["pair-programming"],
        }),
      ]),
    );

    const user = userEvent.setup();
    render(<EpisodesList agentId="ZYWZTD" />);

    await waitFor(() => {
      expect(screen.getByText("I did a project with Xiao Li.")).toBeInTheDocument();
    });
    await user.click(screen.getByText("I did a project with Xiao Li."));

    await waitFor(() => {
      expect(screen.getByText(/completed it at three in the morning/)).toBeInTheDocument();
    });
    expect(screen.getAllByText("Xiao Li").length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state on no items", async () => {
    api.listEpisodes.mockResolvedValue(listEpisodesResp([]));
    render(<EpisodesList agentId="ZYWZTD" />);
    await waitFor(() => expect(api.listEpisodes).toHaveBeenCalled());
    expect(document.querySelector(".ant-empty-image")).not.toBeNull();
  });
});
