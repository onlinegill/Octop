import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { summarizeHitlAction, type HitlTranslate } from "./summarizeHitlAction";

function lookup(bundle: unknown, key: string): string | undefined {
  let node: unknown = bundle;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

/** Mimic i18next: missing keys return the fallback; `{{name}}` is interpolated. */
function tFrom(bundle: unknown): HitlTranslate {
  return (key, options) => {
    const vars =
      options && typeof options === "object"
        ? (options as Record<string, unknown>)
        : {};
    const fallback = typeof options === "string" ? options : undefined;
    const found = lookup(bundle, key);
    if (found === undefined) return fallback ?? key;
    return interpolate(found, vars);
  };
}

const t = tFrom(en);

describe("summarizeHitlAction", () => {
  it("explains browser_use dom_tree instead of dumping JSON", () => {
    const view = summarizeHitlAction(
      "browser_use",
      { action: "dom_tree", level: "interactive" },
      t,
      "Use browser",
    );

    expect(view.toolLabel).toBe("Use browser");
    expect(view.summary).toBe(
      "Read the interactive structure of the current page",
    );
    expect(view.rows).toEqual([
      { label: "Action", value: "Read the page structure" },
      { label: "Detail", value: "Interactive elements only" },
    ]);
    const blob = [view.summary, ...view.rows.map((row) => row.value)].join(" ");
    expect(blob).not.toContain('"action"');
    expect(blob).not.toContain("{");
  });

  it("puts the target URL into the navigate summary", () => {
    const view = summarizeHitlAction(
      "browser_use",
      { action: "navigate", url: "https://news.example.com" },
      t,
      "Use browser",
    );

    expect(view.summary).toBe("Open https://news.example.com");
    expect(view.rows).toEqual([
      { label: "Action", value: "Open a page" },
      { label: "URL", value: "https://news.example.com", mono: true },
    ]);
  });

  it("explains a shell command instead of wrapping it in JSON", () => {
    const view = summarizeHitlAction(
      "execute",
      { command: "ls -la inbound" },
      t,
      "Run command",
    );

    expect(view.summary).toBe("Run command: ls -la inbound");
    expect(view.rows).toEqual([
      { label: "Command", value: "ls -la inbound", mono: true },
    ]);
  });

  it("prefers the action description when the model already explained it", () => {
    const view = summarizeHitlAction(
      "custom_plugin_tool",
      { foo_bar: "secret.txt" },
      t,
      "custom_plugin_tool",
      "Read the key file in the workspace",
    );

    expect(view.summary).toBe("Read the key file in the workspace");
    expect(view.rows).toEqual([{ label: "Foo bar", value: "secret.txt" }]);
  });

  it("ignores the machine HITL template and explains write_file", () => {
    const view = summarizeHitlAction(
      "write_file",
      {
        file_path: "/.octop/workspaces/J7Y3TW/test.txt",
        content: "Hello, this is a test file!\nCreated at: 2025-01-25\n",
      },
      t,
      "Write file",
      "Tool execution requires approval Tool: write_file Args: {'file_path': '/.octop/workspaces/J7Y3TW/test.txt', 'content': 'Hello, this is a test file!\\nCreated at: 2025-01-25\\n'}",
    );

    expect(view.summary).toBe("Write file /.octop/workspaces/J7Y3TW/test.txt");
    expect(view.summary).not.toContain("Tool execution");
    expect(view.rows).toEqual([
      {
        label: "File path",
        value: "/.octop/workspaces/J7Y3TW/test.txt",
        mono: true,
      },
      {
        label: "Content",
        value: "Hello, this is a test file!\nCreated at: 2025-01-25\n",
      },
    ]);
  });

  it("omits server-owned profile and skips empty args", () => {
    const view = summarizeHitlAction(
      "browser_use",
      { action: "screenshot", profile: "user-7" },
      t,
      "Use browser",
    );

    expect(view.summary).toBe("Take a screenshot of the current page");
    expect(view.rows.map((row) => row.label)).toEqual(["Action"]);
    expect(view.rows.some((row) => row.value === "user-7")).toBe(false);
  });
});
