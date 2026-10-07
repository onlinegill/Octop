import { describe, expect, it } from "vitest";
import {
  deleteSkillTokenAtCursor,
  insertSkillSlash,
  materializeSkillSlashes,
  parseLeadingSkillSlug,
  parseSkillSlugsInText,
  skillComposerToken,
} from "./skillSlash";

describe("skillComposerToken", () => {
  it("prefixes emoji before the friendly label", () => {
    expect(
      skillComposerToken({
        slug: "docker-management",
        label: "Docker Management",
        emoji: "📦",
      }),
    ).toBe("📦 Docker Management");
  });

  it("uses a default glyph when label exists without emoji", () => {
    expect(skillComposerToken({ slug: "pdf", label: "PDF Process" })).toBe(
      "✦ PDF Process",
    );
  });

  it("falls back to /slug when there is no friendly label", () => {
    expect(skillComposerToken({ slug: "web-search" })).toBe("/web-search");
  });
});

describe("insertSkillSlash", () => {
  it("inserts /slug into empty composer when no label", () => {
    expect(insertSkillSlash("", "web-search")).toBe("/web-search ");
  });

  it("inserts emoji + friendly label when provided", () => {
    expect(
      insertSkillSlash("", {
        slug: "docker-management",
        label: "Docker Management",
        emoji: "📦",
      }),
    ).toBe("📦 Docker Management ");
  });

  it("appends after existing text without replacing a prior skill", () => {
    expect(insertSkillSlash("please", "web-search")).toBe(
      "please /web-search ",
    );
    expect(
      insertSkillSlash("/old look this up", {
        slug: "web-search",
        label: "Web Search",
        emoji: "🔎",
      }),
    ).toBe("/old look this up 🔎 Web Search ");
  });

  it("does not duplicate an already-present skill token", () => {
    expect(insertSkillSlash("/web-search look", "web-search")).toBe(
      "/web-search look",
    );
    expect(
      insertSkillSlash("📦 Docker Management Take a look", {
        slug: "docker-management",
        label: "Docker Management",
        emoji: "📦",
      }),
    ).toBe("📦 Docker Management Take a look");
  });

  it("does not treat paths as a skill token when appending", () => {
    expect(insertSkillSlash("/root/ddd", "web-search")).toBe(
      "/root/ddd /web-search ",
    );
  });
});

describe("parseSkillSlugsInText", () => {
  const skills = [
    { slug: "docker-management", label: "Docker Management", emoji: "📦" },
    { slug: "pdf", label: "PDF Process", emoji: "📄" },
  ];

  it("collects unique slash tokens", () => {
    expect(parseSkillSlugsInText("/web-search then /pdf")).toEqual([
      "web-search",
      "pdf",
    ]);
    expect(parseLeadingSkillSlug("  /Web-Search look up")).toBe("web-search");
  });

  it("collects emoji + label tokens via skill refs", () => {
    expect(parseSkillSlugsInText("📦 Docker Management Check container", skills)).toEqual([
      "docker-management",
    ]);
    expect(
      parseSkillSlugsInText("📦 Docker Management And 📄 PDF Process", skills),
    ).toEqual(["docker-management", "pdf"]);
  });

  it("ignores paths and mid-word tokens", () => {
    expect(parseSkillSlugsInText("/root/ddd")).toEqual([]);
    expect(parseSkillSlugsInText("see/web-search")).toEqual([]);
    expect(parseLeadingSkillSlug("hello")).toBeNull();
  });
});

describe("materializeSkillSlashes", () => {
  it("rewrites emoji + label to /slug", () => {
    expect(
      materializeSkillSlashes("📦 Docker Management Check container", [
        { slug: "docker-management", label: "Docker Management", emoji: "📦" },
      ]),
    ).toBe("/docker-management Check container");
  });

  it("leaves existing /slug tokens alone", () => {
    expect(
      materializeSkillSlashes("/pdf Read this", [
        { slug: "pdf", label: "PDF Process", emoji: "📄" },
      ]),
    ).toBe("/pdf Read this");
  });
});

describe("deleteSkillTokenAtCursor", () => {
  it("deletes the whole /slug when Backspace sits after the token", () => {
    const text = "/web-search ";
    expect(deleteSkillTokenAtCursor(text, text.length)).toEqual({
      text: "",
      cursor: 0,
    });
  });

  it("deletes emoji + label as one unit", () => {
    const text = "please 📦 Docker Management ";
    expect(
      deleteSkillTokenAtCursor(text, text.length, [
        { slug: "docker-management", label: "Docker Management", emoji: "📦" },
      ]),
    ).toEqual({
      text: "please ",
      cursor: "please ".length,
    });
  });

  it("returns null when Backspace should behave normally", () => {
    expect(deleteSkillTokenAtCursor("hello", 5)).toBeNull();
    expect(deleteSkillTokenAtCursor("/root/ddd ", 10)).toBeNull();
  });
});
