import { describe, expect, it } from "vitest";

import {
  filterQuickPrompts,
  mergeWelcomeIntoManifest,
  normalizeQuickPrompts,
  parseManifestObject,
  serializeQuickPrompts,
  shouldWriteWelcomeManifest,
} from "./welcomeManifest";
import type { QuickPrompt } from "./welcomeManifest";

const prompt = (over: Partial<QuickPrompt> = {}): QuickPrompt => ({
  title: { zh: "Title", en: "Title" },
  description: { zh: "Description", en: "Desc" },
  prompt: { zh: "Tips", en: "Prompt" },
  color: "#e8f4ff",
  icon_name: "sparkles",
  ...over,
});

describe("shouldWriteWelcomeManifest", () => {
  it("writes only after a successful load when the editor is dirty", () => {
    expect(shouldWriteWelcomeManifest("ready", true)).toBe(true);
    expect(shouldWriteWelcomeManifest("ready", false)).toBe(false);
    expect(shouldWriteWelcomeManifest("loading", true)).toBe(false);
    expect(shouldWriteWelcomeManifest("error", true)).toBe(false);
  });
});

describe("parseManifestObject", () => {
  it("accepts empty content as a new object", () => {
    expect(parseManifestObject("")).toEqual({ ok: true, value: {} });
    expect(parseManifestObject("   ")).toEqual({ ok: true, value: {} });
  });

  it("parses a JSON object", () => {
    expect(parseManifestObject('{"id":"demo","label":{"zh":"A"}}')).toEqual({
      ok: true,
      value: { id: "demo", label: { zh: "A" } },
    });
  });

  it("rejects arrays, scalars, and invalid JSON", () => {
    expect(parseManifestObject("[]")).toEqual({ ok: false });
    expect(parseManifestObject('"x"')).toEqual({ ok: false });
    expect(parseManifestObject("{")).toEqual({ ok: false });
  });
});

describe("mergeWelcomeIntoManifest", () => {
  it("keeps unrelated keys and updates only welcome fields", () => {
    const merged = mergeWelcomeIntoManifest(
      {
        id: "demo",
        label: { zh: "Demo", en: "Demo" },
        source: { type: "custom" },
        welcome_message: { zh: "Old chinese", en: "Old English" },
        quick_prompts: [],
      },
      {
        welcome_message: { zh: "New Chinese", en: "Old English" },
        quick_prompts: [prompt({ title: { zh: "Card", en: "" } })],
      },
    );
    expect(merged.id).toBe("demo");
    expect(merged.label).toEqual({ zh: "Demo", en: "Demo" });
    expect(merged.source).toEqual({ type: "custom" });
    expect(merged.welcome_message).toEqual({ zh: "New Chinese", en: "Old English" });
    expect(merged.quick_prompts).toEqual([
      prompt({ title: { zh: "Card", en: "" } }),
    ]);
  });

  it("drops empty welcome copy and empty prompt cards", () => {
    const merged = mergeWelcomeIntoManifest(
      { id: "demo", welcome_message: { zh: "hi", en: "hi" } },
      {
        welcome_message: { zh: "  ", en: "" },
        quick_prompts: [
          prompt({ title: { zh: "", en: "" }, prompt: { zh: "", en: "" } }),
        ],
      },
    );
    expect(merged).toEqual({ id: "demo", quick_prompts: [] });
  });

  it("leaves welcome copy unchanged when the patch omits it", () => {
    const merged = mergeWelcomeIntoManifest(
      {
        id: "demo",
        welcome_message: { zh: "Hello", en: "Hi" },
      },
      { quick_prompts: [prompt()] },
    );
    expect(merged.welcome_message).toEqual({ zh: "Hello", en: "Hi" });
    expect(merged.quick_prompts).toEqual([prompt()]);
  });
});

describe("filterQuickPrompts", () => {
  it("keeps a card that has either title or prompt text", () => {
    expect(
      filterQuickPrompts([
        prompt({ title: { zh: "", en: "" }, prompt: { zh: "x", en: "" } }),
        prompt({ title: { zh: "", en: "" }, prompt: { zh: "", en: "" } }),
      ]),
    ).toHaveLength(1);
  });
});

describe("normalizeQuickPrompts / serializeQuickPrompts", () => {
  it("fills missing locale fields and drops empty cards on serialize", () => {
    const normalized = normalizeQuickPrompts([
      { title: { zh: "Card" }, color: "", icon_name: undefined },
      { title: { zh: "", en: "" }, prompt: { zh: "", en: "" } },
    ]);
    expect(normalized[0]).toEqual({
      title: { zh: "Card", en: "" },
      description: { zh: "", en: "" },
      prompt: { zh: "", en: "" },
      color: "#e8f4ff",
      icon_name: null,
    });
    expect(serializeQuickPrompts(normalized)).toHaveLength(1);
  });
});
