import { describe, expect, it } from "vitest";
import { chunkTextForSpeech } from "./browserSpeech";
import {
  detectSpeechLocale,
  hasBrowserVoiceForText,
  plainTextForSpeech,
  prepareSpeechText,
} from "./plainTextForSpeech";

describe("plainTextForSpeech", () => {
  it("strips code blocks and thinking tags", () => {
    const raw = [
      "<think>hidden thought</think>",
      "Hello, this is the text.",
      "```python",
      "print('x')",
      "```",
    ].join("\n");
    expect(plainTextForSpeech(raw)).toBe("Hello, this is the text.");
  });

  it("returns empty when only code remains", () => {
    expect(prepareSpeechText("```bash\nls\n```")).toBe("");
  });
});

describe("detectSpeechLocale", () => {
  it("defaults to the browser language for non-CJK text", () => {
    expect(detectSpeechLocale("Hello world")).toBe("en-US");
  });
});

describe("hasBrowserVoiceForText", () => {
  it("requires a matching voice language", () => {
    const nonEnglish = [
      { lang: "fr-FR", name: "French", localService: true },
    ] as SpeechSynthesisVoice[];
    const english = [
      { lang: "en-US", name: "English", localService: true },
    ] as SpeechSynthesisVoice[];
    expect(hasBrowserVoiceForText("Hello", nonEnglish)).toBe(false);
    expect(hasBrowserVoiceForText("hello", english)).toBe(true);
  });
});

describe("chunkTextForSpeech", () => {
  it("keeps short text as one chunk", () => {
    expect(chunkTextForSpeech("Short sentences.")).toEqual(["Short sentences."]);
  });

  it("splits long text into multiple chunks", () => {
    const long = "The first sentence is very long.".repeat(20);
    const chunks = chunkTextForSpeech(long, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("The first sentence is very long");
  });
});
