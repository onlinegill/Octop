import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSnapshot,
  ingestHarnessChunk,
  removeSession,
  sendTurn,
  setSessionTeamRoom,
} from "./chatStore";

const SESSION = "test-team-stream";

describe("team member live stream", () => {
  afterEach(() => {
    removeSession(SESSION);
  });

  beforeEach(() => {
    setSessionTeamRoom(SESSION, true);
  });

  it("keeps member thinking and tools off the host bubble", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      node: "agent",
      content: "I will ask the doctor.",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_call_chunk",
      id: "host-ask",
      name: "ask_agent",
      args: "{}",
    });
    ingestHarnessChunk(SESSION, {
      type: "reasoning",
      content: "review the labs",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_call_chunk",
      id: "doc-read",
      name: "read_file",
      args: "{}",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "token",
      node: "agent",
      content: "please rest",
      agent_id: "doctor",
    });

    const { messages } = getSnapshot(SESSION);
    const hostText = messages.find(
      (item) => item.content.includes("I will ask") && !item.speakerAgentId,
    );
    const hostTool = messages.find(
      (item) => item.toolData?.name === "ask_agent",
    );
    const memberThink = messages.find(
      (item) =>
        item.speakerAgentId === "doctor" &&
        item.contentBlocks?.some((block) => block.type === "thinking"),
    );
    const memberTool = messages.find(
      (item) =>
        item.speakerAgentId === "doctor" && item.toolData?.name === "read_file",
    );
    const memberText = messages.find(
      (item) =>
        item.speakerAgentId === "doctor" &&
        item.content.includes("please rest"),
    );

    expect(hostText?.content).toContain("I will ask");
    expect(hostTool?.toolData?.name).toBe("ask_agent");
    expect(memberThink?.contentBlocks?.[0]).toMatchObject({
      type: "thinking",
      content: "review the labs",
    });
    expect(memberTool?.toolData?.name).toBe("read_file");
    expect(memberText?.content).toBe("please rest");
    expect(
      hostText?.contentBlocks?.some((block) => block.type === "thinking"),
    ).not.toBe(true);
  });

  it("keeps host text on one bubble across ask_agent", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Health management experts have been arranged to answer your questions, please wait a moment.",
      agent_id: "host",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_call_chunk",
      id: "host-ask",
      name: "ask_agent",
      args: "{}",
      agent_id: "host",
    });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Let health management experts answer this question.",
      agent_id: "host",
    });

    const { messages } = getSnapshot(SESSION);
    const host = messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(1);
    expect(host[0]?.content).toContain("Health management experts have been arranged");
    expect(host[0]?.content).toContain("Let health management experts answer this question");
  });

  it("does not seal the host when a member done arrives", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      node: "agent",
      content: "host still talking",
    });
    ingestHarnessChunk(SESSION, {
      type: "token",
      node: "agent",
      content: "member answer",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });

    const { messages, isStreaming } = getSnapshot(SESSION);
    const host = messages.find((item) =>
      item.content.includes("host still talking"),
    );
    const member = messages.find((item) => item.speakerAgentId === "doctor");
    expect(host?.status).toBe("streaming");
    expect(member?.status).toBe("done");
    expect(isStreaming).toBe(false);
  });

  it("does not lock the composer on member-only chunks", () => {
    ingestHarnessChunk(SESSION, { type: "done" });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "please rest",
      agent_id: "doctor",
    });
    const { isStreaming, messages } = getSnapshot(SESSION);
    expect(isStreaming).toBe(false);
    expect(
      messages.some(
        (item) =>
          item.speakerAgentId === "doctor" &&
          item.content.includes("please rest"),
      ),
    ).toBe(true);
  });

  it("releases the composer on host done while a member is still streaming", async () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      readyState = 0;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        FakeWebSocket.instances.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    const RealWS = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const first = sendTurn(
        SESSION,
        "hi",
        "agent-1",
        "",
        undefined,
        undefined,
        null,
        SESSION,
      );
      await Promise.resolve();
      const ws1 = FakeWebSocket.instances[0];
      expect(ws1).toBeDefined();
      ws1.onmessage?.({
        data: JSON.stringify({ type: "token", content: "host talking" }),
      });
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "token",
          content: "member talking",
          agent_id: "doctor",
        }),
      });
      ws1.onmessage?.({ data: JSON.stringify({ type: "done" }) });

      const afterHost = getSnapshot(SESSION);
      expect(afterHost.isStreaming).toBe(false);
      expect(
        afterHost.messages.find((item) => item.speakerAgentId === "doctor")
          ?.status,
      ).toBe("streaming");

      const second = sendTurn(
        SESSION,
        "again",
        "agent-1",
        "",
        undefined,
        undefined,
        null,
        SESSION,
      );
      await Promise.resolve();
      expect(ws1.sent.some((row) => row.includes('"cancel"'))).toBe(false);
      expect(getSnapshot(SESSION).isStreaming).toBe(true);
      expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

      FakeWebSocket.instances[1]?.close();
      ws1.close();
      await Promise.allSettled([first, second]);
    } finally {
      globalThis.WebSocket = RealWS;
    }
  });

  it("keeps member tokens on one bubble after that member is marked done", () => {
    ingestHarnessChunk(SESSION, { type: "token", content: "I will ask." });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "please ",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "rest",
      agent_id: "doctor",
    });
    const member = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "doctor",
    );
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("please rest");
  });

  it("keeps concurrent host and member tokens on separate bubbles", () => {
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "Arranged", agent_id: "host" },
      "host",
    );
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "This is a medical",
      agent_id: "doctor",
    });
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Clinical assistant experts will answer your questions, please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Knowledge questions, I can answer them directly",
      agent_id: "doctor",
    });
    const { messages } = getSnapshot(SESSION);
    const host = messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    const member = messages.filter((item) => item.speakerAgentId === "doctor");
    expect(host.map((item) => item.content).join("")).toBe(
      "ArrangedClinical assistant experts will answer your questions, please wait a moment.",
    );
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("This is a medicalKnowledge questions, I can answer them directly");
    expect(host.some((item) => item.content.includes("Medical knowledge"))).toBe(false);
    expect(member[0]?.content.includes("Arranged")).toBe(false);
  });

  it("does not merge unlabeled tokens onto a stamped host bubble", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "A clinical assistant expert has been arranged to answer your question, please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "This is a medical knowledge question and I can answer it directly",
    });
    const { messages } = getSnapshot(SESSION);
    const assistants = messages.filter((item) => item.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(
      assistants.find((item) => item.speakerAgentId === "host")?.content,
    ).toBe("A clinical assistant expert has been arranged to answer your question, please wait a moment.");
    expect(assistants.find((item) => !item.speakerAgentId)?.content).toBe(
      "This is a medical knowledge question and I can answer it directly",
    );
  });

  it("keeps unlabeled solo-chat tokens on one bubble", () => {
    setSessionTeamRoom(SESSION, false);
    ingestHarnessChunk(SESSION, { type: "token", content: "Hel" });
    ingestHarnessChunk(SESSION, { type: "token", content: "lo" });
    ingestHarnessChunk(SESSION, { type: "token", content: "!" });
    const assistants = getSnapshot(SESSION).messages.filter(
      (item) => item.role === "assistant",
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.content).toBe("Hello!");
    expect(assistants[0]?.speakerAgentId).toBeUndefined();
  });

  it("opens a new host bubble after a member has spoken", () => {
    ingestHarnessChunk(SESSION, { type: "token", content: "A" });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "1",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "token", content: "B" });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "2",
      agent: "doctor",
    });
    const { messages } = getSnapshot(SESSION);
    const host = messages.filter((item) => !item.speakerAgentId);
    const member = messages.filter((item) => item.speakerAgentId === "doctor");
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toBe("A");
    expect(host[1]?.content).toBe("B");
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("12");
  });

  it("seals a stamped host bubble when the unlabeled host done arrives", () => {
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "host talking", agent_id: "host" },
      "host",
    );
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "member talking",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done" });

    const { messages, isStreaming } = getSnapshot(SESSION);
    const host = messages.find((item) => item.speakerAgentId === "host");
    const member = messages.find((item) => item.speakerAgentId === "doctor");
    expect(host?.status).toBe("done");
    expect(member?.status).toBe("streaming");
    expect(isStreaming).toBe(false);
  });

  it("opens a new stamped host bubble after a member has spoken", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "A",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "1",
        agent_id: "doctor",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "B", agent: "host" },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "2", agent: "doctor" },
      "host",
    );
    const { messages } = getSnapshot(SESSION);
    const host = messages.filter((item) => item.speakerAgentId === "host");
    const member = messages.filter((item) => item.speakerAgentId === "doctor");
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toBe("A");
    expect(host[1]?.content).toBe("B");
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("12");
  });

  it("keeps wrap-up off the dispatch bubble even while the host is still streaming", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "A clinical assistant specialist has been dispatched. Please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "You can call it a day.",
        agent_id: "host",
        team_wrapup: true,
      },
      "host",
    );
    const host = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toBe("A clinical assistant specialist has been dispatched. Please wait a moment.");
    expect(host[1]?.content).toBe("You can call it a day.");
    expect(host[1]?.teamWrapup).toBe(true);
  });

  it("opens a new host bubble for the wrap-up after the assignment is sealed", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Health management experts have been arranged to answer your questions, please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, { type: "done" }, "host");
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "The sleep advice has been given and it’s time to call it a day.",
        agent_id: "host",
        team_snapshot: true,
      },
      "host",
    );

    const { messages } = getSnapshot(SESSION);
    const host = messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toContain("Health management experts have been arranged");
    expect(host[1]?.content).toBe("The sleep advice has been given and it’s time to call it a day.");
    expect(host[1]?.status).toBe("done");
  });

  it("does not duplicate a full-message replay onto the host bubble", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "A clinical assistant has been arranged to sort out the treatment plan for your heart disease. Please wait a moment.",
      agent_id: "host",
    });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "A clinical assistant has been arranged to sort out the treatment plan for your heart disease. Please wait a moment.",
      agent_id: "host",
    });
    const host = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(1);
    expect(host[0]?.content).toBe(
      "A clinical assistant has been arranged to sort out the treatment plan for your heart disease. Please wait a moment.",
    );
  });

  it("opens a new host bubble after members even without team_wrapup", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Health management experts have been arranged to answer your questions, please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "tool_call_chunk",
        id: "host-ask",
        name: "ask_agent",
        args: "{}",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "tool_result",
        messages: [{ tool_call_id: "host-ask", content: "queued" }],
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, { type: "done" }, "host");
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Please start with a regular schedule.",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "The sleep advice has been given and it’s time to call it a day.",
        agent_id: "host",
      },
      "host",
    );

    const { messages } = getSnapshot(SESSION);
    const host = messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toContain("Health management experts have been arranged");
    expect(host[1]?.content).toBe("The sleep advice has been given and it’s time to call it a day.");
    expect(host[1]?.status).toBe("streaming");
  });

  it("does not reopen a sealed host bubble after ask_agent completes", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "A clinical assistant specialist has been dispatched. Please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "tool_call_chunk",
        id: "host-ask",
        name: "ask_agent",
        args: "{}",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "tool_result",
        messages: [{ tool_call_id: "host-ask", content: "queued" }],
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, { type: "done" }, "host");
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "You can call it a day.", agent_id: "host" },
      "host",
    );
    const host = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toBe("A clinical assistant specialist has been dispatched. Please wait a moment.");
    expect(host[1]?.content).toBe("You can call it a day.");
  });

  it("does not seal dispatch when a wrap-up done arrives", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "A clinical assistant specialist has been dispatched. Please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "OK",
        agent_id: "host",
        team_wrapup: true,
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      { type: "done", agent_id: "host", team_wrapup: true },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      { type: "token", content: "Still scheduling.", agent_id: "host" },
      "host",
    );
    const host = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toBe("A clinical assistant specialist has been dispatched. Please wait a moment.Still scheduling.");
    expect(host[0]?.status).toBe("streaming");
    expect(host[1]?.content).toBe("OK");
    expect(host[1]?.status).toBe("done");
  });

  it("streams wrap-up tokens onto a new host bubble", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Health management experts have been arranged to answer your questions, please wait a moment.",
        agent_id: "host",
      },
      "host",
    );
    ingestHarnessChunk(SESSION, { type: "done" }, "host");
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Sleep",
        agent_id: "host",
        team_wrapup: true,
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Advice has been given.",
        agent_id: "host",
        team_wrapup: true,
      },
      "host",
    );

    const { messages } = getSnapshot(SESSION);
    const host = messages.filter(
      (item) => item.speakerAgentId === "host" && !item.toolData,
    );
    expect(host).toHaveLength(2);
    expect(host[0]?.content).toContain("Health management experts have been arranged");
    expect(host[1]?.content).toBe("SleepAdvice has been given.");
    expect(host[1]?.status).toBe("streaming");
  });

  it("merges a member snapshot onto the live bubble", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "please ",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "please rest",
      agent_id: "doctor",
      team_snapshot: true,
    });
    const { messages, liveSpeakers } = getSnapshot(SESSION);
    const member = messages.filter((item) => item.speakerAgentId === "doctor");
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("please rest");
    expect(member[0]?.status).toBe("done");
    expect(liveSpeakers).not.toContain("doctor");
  });

  it("keeps a member answer on one bubble across completed tools", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Let me check first.",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_call_chunk",
      index: 0,
      id: "read-1",
      name: "read_file",
      args: "{}",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_result",
      messages: [{ tool_call_id: "read-1", content: "labs ok" }],
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "The conclusion is as follows.",
      agent_id: "doctor",
    });
    const member = getSnapshot(SESSION).messages.filter(
      (item) => item.speakerAgentId === "doctor" && !item.toolData,
    );
    expect(member).toHaveLength(1);
    expect(member[0]?.content).toBe("Let me check first.The conclusion is as follows.");
  });

  it("clears stale member live state when host wrap-up finishes", () => {
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "done work",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });
    // Snapshot must not re-light a finished speaker.
    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "done work",
      agent_id: "doctor",
      team_snapshot: true,
    });
    expect(getSnapshot(SESSION).liveSpeakers).not.toContain("doctor");

    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "Summary completed",
        agent_id: "host",
        team_wrapup: true,
      },
      "host",
    );
    ingestHarnessChunk(
      SESSION,
      { type: "done", agent_id: "host", team_wrapup: true },
      "host",
    );
    expect(getSnapshot(SESSION).liveSpeakers).toEqual([]);
  });

  it("keeps a member live across tool gaps after the host unlocks the composer", () => {
    ingestHarnessChunk(SESSION, { type: "token", content: "dispatch" });
    ingestHarnessChunk(SESSION, { type: "done" });
    expect(getSnapshot(SESSION).isStreaming).toBe(false);

    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "Let me check first",
      agent_id: "doctor",
    });
    expect(getSnapshot(SESSION).liveSpeakers).toContain("doctor");

    ingestHarnessChunk(SESSION, {
      type: "tool_call_chunk",
      index: 0,
      id: "read-1",
      name: "read_file",
      args: "{}",
      agent_id: "doctor",
    });
    ingestHarnessChunk(SESSION, {
      type: "tool_result",
      messages: [{ tool_call_id: "read-1", content: "labs ok" }],
      agent_id: "doctor",
    });

    const afterTool = getSnapshot(SESSION);
    expect(afterTool.isStreaming).toBe(false);
    expect(afterTool.liveSpeakers).toContain("doctor");
    expect(
      afterTool.messages.some(
        (item) =>
          item.speakerAgentId === "doctor" && item.status === "streaming",
      ),
    ).toBe(false);

    ingestHarnessChunk(SESSION, {
      type: "token",
      content: "The conclusion is as follows",
      agent_id: "doctor",
    });
    expect(getSnapshot(SESSION).liveSpeakers).toContain("doctor");

    ingestHarnessChunk(SESSION, { type: "done", agent_id: "doctor" });
    expect(getSnapshot(SESSION).liveSpeakers).not.toContain("doctor");
  });

  it("rewrites peer-local member speakers onto Bridge shadow ids", () => {
    ingestHarnessChunk(
      SESSION,
      {
        type: "token",
        content: "please rest",
        agent_id: "doctor",
      },
      "bridge:cid:host",
    );
    const { messages } = getSnapshot(SESSION);
    expect(
      messages.find((item) => item.content.includes("please rest"))
        ?.speakerAgentId,
    ).toBe("bridge:cid:doctor");
  });
});
