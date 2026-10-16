import { describe, expect, it } from "vitest";
import {
  hasInFlightTool,
  hasStreamingThinking,
  resolveLiveSpeakerNames,
} from "./liveSpeakerLabel";

describe("resolveLiveSpeakerNames", () => {
  const agents = [
    { agent_id: "host", name: "Host" },
    { agent_id: "doctor", name: "Clinical assistant" },
    { agent_id: "nurse", name: "Nursing assistant" },
  ];

  it("maps member ids to display names", () => {
    expect(
      resolveLiveSpeakerNames(["doctor", "nurse"], agents, {
        hostId: "host",
        hostName: "Host",
      }),
    ).toEqual(["Clinical assistant", "Nursing assistant"]);
  });

  it("treats empty and host id as the host", () => {
    expect(
      resolveLiveSpeakerNames(["", "host"], agents, {
        hostId: "host",
        hostName: "Team hosting",
      }),
    ).toEqual(["Team hosting"]);
  });

  it("falls back to the raw id when the agent is unknown", () => {
    expect(resolveLiveSpeakerNames(["mystery"], agents)).toEqual(["mystery"]);
  });

  it("caps the list", () => {
    expect(
      resolveLiveSpeakerNames(["doctor", "nurse", "mystery"], agents, {
        limit: 2,
      }),
    ).toEqual(["Clinical assistant", "Nursing assistant"]);
  });
});

describe("hasInFlightTool", () => {
  it("detects a streaming tool without output", () => {
    expect(
      hasInFlightTool([
        { status: "streaming", toolData: { name: "read_file" } },
      ]),
    ).toBe(true);
  });

  it("ignores completed tools", () => {
    expect(
      hasInFlightTool([
        {
          status: "done",
          toolData: { name: "read_file", output: "ok" },
        },
      ]),
    ).toBe(false);
  });

  it("ignores a paused ask_user_question tool", () => {
    expect(
      hasInFlightTool([
        {
          status: "streaming",
          toolData: { name: "ask_user_question" },
        },
      ]),
    ).toBe(false);
  });
});

describe("hasStreamingThinking", () => {
  it("detects streaming reasoning bubbles", () => {
    expect(
      hasStreamingThinking([{ status: "streaming", type: "reasoning" }]),
    ).toBe(true);
  });

  it("detects thinking content blocks", () => {
    expect(
      hasStreamingThinking([
        {
          status: "streaming",
          contentBlocks: [{ type: "thinking" }],
        },
      ]),
    ).toBe(true);
  });
});
