import { describe, expect, it } from "vitest";
import {
  parseDashboardPushFrame,
  truncatePushText,
} from "./dashboardPushToast";

describe("parseDashboardPushFrame", () => {
  it("accepts a dashboard_push frame", () => {
    expect(
      parseDashboardPushFrame({
        type: "dashboard_push",
        agent_id: "a1",
        thread_id: "thr_1",
        text: "Remember to drink water",
        agent_name: "Assistant",
      }),
    ).toEqual({
      type: "dashboard_push",
      agent_id: "a1",
      thread_id: "thr_1",
      text: "Remember to drink water",
      agent_name: "Assistant",
    });
  });

  it("rejects other frame types and incomplete payloads", () => {
    expect(
      parseDashboardPushFrame({ type: "token", content: "hi" }),
    ).toBeNull();
    expect(
      parseDashboardPushFrame({
        type: "dashboard_push",
        agent_id: "a1",
        text: "x",
      }),
    ).toBeNull();
    expect(parseDashboardPushFrame(null)).toBeNull();
  });
});

describe("truncatePushText", () => {
  it("keeps short text intact", () => {
    expect(truncatePushText("Remember to drink water")).toBe("Remember to drink water");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "a".repeat(300);
    const out = truncatePushText(long, 80);
    expect(out.length).toBe(81);
    expect(out.endsWith("…")).toBe(true);
  });
});
