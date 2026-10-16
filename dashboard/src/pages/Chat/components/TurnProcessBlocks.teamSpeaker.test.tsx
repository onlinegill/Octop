import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../hooks/useChat";
import { ChatAgentProfileProvider } from "../ChatAgentProfileContext";
import { TurnProcessBlocks } from "./TurnProcessBlocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      key === "chat.teamHostHover" ? `[${opts?.name ?? ""}] Moderator` : key,
  }),
}));

vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({
    activeAgent: {
      agent_id: "host",
      name: "Hosting team",
      kind: "team",
      icon_name: "bot",
    },
    agents: [
      {
        agent_id: "host",
        name: "Hosting team",
        kind: "team",
        icon_name: "bot",
      },
      {
        agent_id: "doctor",
        name: "Clinical assistant specialist",
        icon_name: "sparkles",
      },
    ],
  }),
}));

function toolMessage(speaker?: string): ChatMessage {
  return {
    id: "tool-1",
    role: "assistant",
    content: "",
    status: "done",
    timestamp: Date.now(),
    speakerAgentId: speaker,
    toolData: { name: "ask_agent", arguments: "{}" },
  };
}

function splitWithTool(speaker?: string) {
  const tool = toolMessage(speaker);
  return {
    tools: [tool],
    thinkings: [],
    processSteps: [{ kind: "tool" as const, message: tool }],
    answerMessage: null,
  };
}

describe("TurnProcessBlocks team speaker chrome", () => {
  it("labels the host process avatar as team host", () => {
    render(
      <ChatAgentProfileProvider canOpen onOpen={vi.fn()} isTeam>
        <TurnProcessBlocks
          split={splitWithTool("host")}
          isStreaming={false}
          hideToolMedia
          agentId="host"
          showAvatar
        />
      </ChatAgentProfileProvider>,
    );
    expect(
      screen.getByRole("button", { name: "[Hosting team] Moderator" }),
    ).toBeInTheDocument();
  });

  it("opens the member profile from the process-row avatar", () => {
    const onOpen = vi.fn();
    render(
      <ChatAgentProfileProvider canOpen onOpen={onOpen} isTeam>
        <TurnProcessBlocks
          split={splitWithTool("doctor")}
          isStreaming={false}
          hideToolMedia
          agentId="doctor"
          showAvatar
        />
      </ChatAgentProfileProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clinical assistant specialist" }));
    expect(onOpen).toHaveBeenCalledWith("doctor");
  });
});
