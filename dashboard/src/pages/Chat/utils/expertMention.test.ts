import { describe, expect, it } from "vitest";
import {
  ensureExpertMentions,
  expertMentionToken,
  mentionedExpertIds,
  mentionedSubagentSlugs,
  replaceMentionQuery,
  textHasExpertMention,
  toggleExpertMention,
  withExpertMention,
} from "./expertMention";

describe("expertMentionToken", () => {
  it("prefixes the name and collapses whitespace", () => {
    expect(expertMentionToken("Analyst")).toBe("@Analyst");
    expect(expertMentionToken(" analyst ")).toBe("@analyst");
  });
});

describe("withExpertMention", () => {
  it("puts @Name in front of the prompt", () => {
    expect(
      withExpertMention("Please make a differential diagnosis", "Clinician"),
    ).toBe("@Clinician Please make a differential diagnosis");
  });

  it("does not duplicate an existing mention", () => {
    expect(
      withExpertMention(
        "@Clinician Please make a differential diagnosis",
        "Clinician",
      ),
    ).toBe("@Clinician Please make a differential diagnosis");
  });
});

describe("toggleExpertMention", () => {
  it("inserts @Name into an empty composer with a trailing space", () => {
    expect(toggleExpertMention("", "Analyst")).toEqual({
      text: "@Analyst ",
      cursor: 9,
    });
  });

  it("appends @Name after existing text", () => {
    expect(toggleExpertMention("Help me see", "Analyst").text).toBe(
      "Help me see @Analyst ",
    );
  });

  it("removes an existing mention", () => {
    expect(toggleExpertMention("@Analyst Help me see", "Analyst").text).toBe(
      "Help me see",
    );
    expect(toggleExpertMention("Please @Analyst Help me", "Analyst").text).toBe(
      "Please Help me",
    );
  });

  it("does not treat a longer name as the shorter one", () => {
    expect(textHasExpertMention("@Analyst Take a look", "Analysis")).toBe(false);
    expect(textHasExpertMention("@Analyst Take a look", "Analyst")).toBe(true);
  });
});

describe("replaceMentionQuery", () => {
  it("replaces the typed @query with @Name", () => {
    expect(replaceMentionQuery("@Ana", 0, "Ana", "Analyst")).toEqual({
      text: "@Analyst ",
      cursor: 9,
    });
  });

  it("keeps surrounding text", () => {
    expect(
      replaceMentionQuery("Look @fen here", 5, "fen", "Analyst").text,
    ).toBe("Look @Analyst here");
  });
});

describe("mentionedExpertIds / ensureExpertMentions", () => {
  const experts = [
    { agent_id: "a1", name: "Analyst" },
    { agent_id: "a2", name: "Researcher" },
  ];

  it("lists experts already mentioned in the draft", () => {
    expect(mentionedExpertIds("Please @Analyst Take a look", experts)).toEqual([
      "a1",
    ]);
  });

  it("injects missing mentions when reclaiming a queued turn", () => {
    expect(ensureExpertMentions("Help me see", ["a2"], experts)).toBe(
      "Help me see @Researcher ",
    );
    expect(ensureExpertMentions("@Researcher Already", ["a2"], experts)).toBe(
      "@Researcher Already",
    );
  });
});

describe("mentionedSubagentSlugs", () => {
  it("matches @slug tokens used by the task tool", () => {
    expect(
      mentionedSubagentSlugs("Please @researcher Process", [
        { slug: "researcher" },
        { slug: "writer" },
      ]),
    ).toEqual(["researcher"]);
  });
});
