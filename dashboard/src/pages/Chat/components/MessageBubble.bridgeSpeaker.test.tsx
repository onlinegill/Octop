import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageBubble from "./MessageBubble";
import type { ChatMessage } from "../hooks/useChat";
import { ChatAgentProfileProvider } from "../ChatAgentProfileContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      key === "chat.teamHostHover" ? `[${opts?.name ?? ""}] Moderator` : key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "UTC",
}));

vi.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ username: "ada", display_name: "Ada" }),
}));

vi.mock("../../../context/VoiceOutputContext", () => ({
  useVoiceOutputContext: () => ({ speakingId: null, speak: vi.fn() }),
}));

vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({
    activeAgent: {
      agent_id: "bridge:cid:host",
      name: "Hosting team",
      kind: "team",
      icon_name: "bot",
    },
    agents: [
      {
        agent_id: "bridge:cid:host",
        name: "Hosting team",
        kind: "team",
        icon_name: "bot",
      },
      {
        agent_id: "bridge:cid:doctor",
        name: "Clinical assistant specialist",
        icon_name: "sparkles",
      },
    ],
  }),
}));

function assistant(extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: extra.id ?? "m1",
    role: "assistant",
    content: extra.content ?? "please rest",
    status: "done",
    timestamp: Date.now(),
    ...extra,
  };
}

describe("MessageBubble peer team speaker chrome", () => {
  it("uses the member shadow avatar instead of the host", () => {
    const onOpen = vi.fn();
    render(
      <ChatAgentProfileProvider canOpen onOpen={onOpen} isTeam>
        <MessageBubble
          message={assistant({ speakerAgentId: "doctor" })}
          agentId="bridge:cid:host"
          showAvatar
          groupPosition="only"
        />
      </ChatAgentProfileProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "[Hosting team] Moderator" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clinical assistant specialist" }));
    expect(onOpen).toHaveBeenCalledWith("bridge:cid:doctor");
  });
});
