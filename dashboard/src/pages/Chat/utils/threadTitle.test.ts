import { describe, expect, it } from "vitest";
import {
  clipThreadTitle,
  formatThreadTitle,
  THREAD_TITLE_MAX,
} from "./threadTitle";

describe("clipThreadTitle", () => {
  it("returns empty for blank", () => {
    expect(clipThreadTitle(null)).toBe("");
    expect(clipThreadTitle("  ")).toBe("");
  });

  it("keeps short titles and collapses whitespace", () => {
    expect(clipThreadTitle("Hello")).toBe("Hello");
    expect(clipThreadTitle("a  \n  b")).toBe("a b");
  });

  it("clips with ellipsis when over max", () => {
    const long = "x".repeat(THREAD_TITLE_MAX + 5);
    const out = clipThreadTitle(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(THREAD_TITLE_MAX);
  });

  it("keeps exact-max titles without forcing ellipsis", () => {
    const exact = "a".repeat(THREAD_TITLE_MAX);
    expect(exact.length).toBe(THREAD_TITLE_MAX);
    expect(clipThreadTitle(exact)).toBe(exact);
    expect(clipThreadTitle(exact).endsWith("…")).toBe(false);
  });
});

describe("formatThreadTitle", () => {
  it("returns empty for blank", () => {
    expect(formatThreadTitle(null)).toBe("");
    expect(formatThreadTitle("  ")).toBe("");
  });

  it("keeps short titles", () => {
    expect(formatThreadTitle("Hello")).toBe("Hello");
  });

  it("does not append ellipsis to exact-max titles", () => {
    // Legitimate full-length titles (and legacy hard-cuts repaired by migration).
    const exact = "Search the web for news".padEnd(
      THREAD_TITLE_MAX,
      "!",
    );
    expect(exact.length).toBe(THREAD_TITLE_MAX);
    expect(formatThreadTitle(exact)).toBe(exact);
  });

  it("preserves titles that already end with ellipsis within max", () => {
    const body = "a".repeat(THREAD_TITLE_MAX - 1);
    const t = `${body}…`;
    expect(t.length).toBe(THREAD_TITLE_MAX);
    expect(formatThreadTitle(t)).toBe(t);
  });
});
