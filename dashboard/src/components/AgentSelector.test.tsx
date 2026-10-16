import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OctopAgent } from "../context/AgentContext";

const state = {
  agents: [] as OctopAgent[],
  activeAgentId: "writer" as string | null,
  loading: false,
};

const setActiveAgent = vi.fn((id: string | null) => {
  state.activeAgentId = id;
});

vi.mock("../context/AgentContext", () => ({
  useAgent: () => ({
    get agents() {
      return state.agents;
    },
    get activeAgentId() {
      return state.activeAgentId;
    },
    get loading() {
      return state.loading;
    },
    setActiveAgent,
  }),
}));

import AgentSelector from "./AgentSelector";

function fakeAgent(
  partial: Pick<OctopAgent, "agent_id" | "name"> & Partial<OctopAgent>,
): OctopAgent {
  return {
    id: 1,
    description: null,
    persona_mbti: null,
    default_model: null,
    system_prompt: null,
    template_name: null,
    state: "running",
    last_error: null,
    icon: null,
    icon_name: null,
    icon_url: null,
    color: "#2563eb",
    config: {},
    is_owner: true,
    kind: "expert",
    ...partial,
  };
}

const writer = fakeAgent({ agent_id: "writer", name: "Writer" });
const crew = fakeAgent({
  agent_id: "crew",
  name: "Research team",
  kind: "team",
});
const remoteWriter = fakeAgent({
  agent_id: "bridge:c1:writer",
  name: "Peer writer",
  bridge: true,
  bridge_connection_id: "c1",
  bridge_connection_name: "Cloud",
});
const remoteCrew = fakeAgent({
  agent_id: "bridge:c1:crew",
  name: "Opposite end research team",
  kind: "team",
  bridge: true,
  bridge_connection_id: "c1",
  bridge_connection_name: "Cloud",
});

describe("AgentSelector groups", () => {
  beforeEach(() => {
    setActiveAgent.mockClear();
    state.agents = [writer, crew];
    state.activeAgentId = "writer";
    state.loading = false;
  });

  it("hides teams unless showTeams is on", () => {
    const { rerender } = render(<AgentSelector />);
    const chips = () => within(screen.getByTestId("agent-selector-chips"));
    expect(chips().getByText("Writer")).toBeInTheDocument();
    expect(chips().queryByText("Research team")).not.toBeInTheDocument();
    expect(screen.getByText("Expert")).toBeInTheDocument();
    expect(chips().queryByText("Team")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
    expect(setActiveAgent).not.toHaveBeenCalled();

    rerender(<AgentSelector showTeams />);
    expect(chips().getByText("Writer")).toBeInTheDocument();
    expect(chips().getByText("Research team")).toBeInTheDocument();
    expect(chips().getByText("Expert")).toBeInTheDocument();
    expect(chips().getByText("Team")).toBeInTheDocument();
    expect(screen.queryByText("This page allows you to manage experts and teams")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps groups in one chip row, including remotes", () => {
    state.agents = [writer, crew, remoteWriter, remoteCrew];
    render(<AgentSelector showTeams />);
    const chips = within(screen.getByTestId("agent-selector-chips"));
    expect(chips.getByText("Expert")).toBeInTheDocument();
    expect(chips.getByText("Team")).toBeInTheDocument();
    expect(chips.getByText("Cloud·Expert")).toBeInTheDocument();
    expect(chips.getByText("Cloud·Team")).toBeInTheDocument();
    expect(chips.getByText("Peer writer")).toBeInTheDocument();
    expect(chips.getByText("Opposite end research team")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps a hidden team selection and asks the user to pick an expert", () => {
    state.activeAgentId = "crew";
    render(<AgentSelector />);
    expect(setActiveAgent).not.toHaveBeenCalled();
    expect(screen.queryByText("Research team")).not.toBeInTheDocument();
    expect(screen.getByText("Expert")).toBeInTheDocument();
    expect(
      screen.getByText("The current team is “Research Team”, please select an expert on this page"),
    ).toBeInTheDocument();
  });
});
