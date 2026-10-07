import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHANNEL_DISPLAY_CONFIG,
  partitionChannelKeys,
  CHANNEL_KEYS,
  CHANNEL_FIELDS,
  normalizeChannelFieldValue,
} from "./constants";

describe("Discord configuration", () => {
  it("exposes Discord in the catalogue with its credential schema", () => {
    expect(CHANNEL_KEYS).toContain("discord");
    expect(partitionChannelKeys(["discord"], new Set())).toEqual({
      featured: ["discord"],
      more: [],
    });
    expect(
      partitionChannelKeys(["discord"], new Set(["discord"])).featured,
    ).toEqual(["discord"]);
    expect(
      CHANNEL_FIELDS.discord?.find((f) => f.name === "bot_token"),
    ).toMatchObject({ required: true, type: "password" });
    expect(
      CHANNEL_FIELDS.discord?.find((f) => f.name === "http_proxy_auth"),
    ).toMatchObject({ type: "password" });
  });

  it("preserves snowflake IDs exactly and validates user input", () => {
    expect(
      normalizeChannelFieldValue(
        "allowed_channel_ids",
        "1234567890123456789, 2345678901234567890\n1234567890123456789",
      ),
    ).toEqual(["1234567890123456789", "2345678901234567890"]);
    expect(normalizeChannelFieldValue("allowed_user_ids", "")).toEqual([]);
    expect(normalizeChannelFieldValue("allowed_user_ids", ["123"])).toEqual([
      "123",
    ]);
    expect(() =>
      normalizeChannelFieldValue("allowed_channel_ids", "#general"),
    ).toThrow();
  });

  it("passes through unrelated field values unchanged", () => {
    expect(normalizeChannelFieldValue("bot_token", "secret")).toBe("secret");
  });
});

describe("partitionChannelKeys", () => {
  it("hides telegram until expanded unless already configured", () => {
    expect(
      partitionChannelKeys(["telegram", "discord", "mqtt"], new Set()),
    ).toEqual({
      featured: ["discord", "mqtt"],
      more: ["telegram"],
    });
    expect(
      partitionChannelKeys(
        ["telegram", "discord", "mqtt"],
        new Set(["telegram"]),
      ),
    ).toEqual({
      featured: ["telegram", "discord", "mqtt"],
      more: [],
    });
  });
});

describe("default display config", () => {
  it("streams responses and hides thinking/tool hints by default", () => {
    expect(DEFAULT_CHANNEL_DISPLAY_CONFIG).toEqual({
      response_mode: "stream",
      show_thinking: false,
      show_tool_hints: false,
    });
  });
});
