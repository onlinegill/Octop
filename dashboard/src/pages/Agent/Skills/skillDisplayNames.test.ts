import { describe, expect, it } from "vitest";
import { resolveSkillDisplayName } from "./skillDisplayNames";

describe("resolveSkillDisplayName", () => {
  it("prefers metadata.octop.label for the UI locale", () => {
    expect(
      resolveSkillDisplayName(
        {
          slug: "tcapi",
          name: "tcapi",
          label: { zh: "Example Cloud API", en: "Example Cloud API" },
        },
        "zh",
      ),
    ).toBe("Example Cloud API");
    expect(
      resolveSkillDisplayName(
        {
          slug: "tcapi",
          name: "tcapi",
          label: { zh: "Example Cloud API", en: "Example Cloud API" },
        },
        "en",
      ),
    ).toBe("Example Cloud API");
  });

  it("falls back to display_name then presentation name", () => {
    expect(
      resolveSkillDisplayName(
        { slug: "tcapi", name: "tcapi", display_name: "Example Cloud API Assistant" },
        "zh",
      ),
    ).toBe("Example Cloud API Assistant");
    expect(
      resolveSkillDisplayName({ slug: "pdf", name: "PDF Read and edit" }, "zh"),
    ).toBe("PDF Read and edit");
  });

  it("uses the slug when only the identity name is present", () => {
    expect(resolveSkillDisplayName({ slug: "pdf", name: "pdf" }, "zh")).toBe(
      "pdf",
    );
  });
});
