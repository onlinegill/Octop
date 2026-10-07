import { describe, expect, it } from "vitest";
import {
  collectWriteTodosFromMessages,
  isWriteTodosToolName,
  parsePartialTodoPayload,
  parseWriteTodosToolData,
  sortTodoItems,
} from "./parseWriteTodos";

describe("parseWriteTodosToolData", () => {
  it("parses todos from tool arguments", () => {
    const items = parseWriteTodosToolData(
      JSON.stringify({
        todos: [
          { id: "1", content: "Plan", status: "completed" },
          { id: "2", content: "Implement", status: "in_progress" },
        ],
      }),
      undefined,
    );
    expect(items).toEqual([
      { id: "1", content: "Plan", status: "completed" },
      { id: "2", content: "Implement", status: "in_progress" },
    ]);
  });

  it("matches namespaced write_todos tool", () => {
    expect(isWriteTodosToolName("deepagents/write_todos")).toBe(true);
  });

  it("parses partial streamed JSON arguments", () => {
    const partial =
      '{"todos":[{"id":"1","content":"Plan","status":"completed"},{"id":"2","content":"Implement","status":"in_progress"';
    const items = parseWriteTodosToolData(partial, undefined, true);
    expect(items).toEqual([{ id: "1", content: "Plan", status: "completed" }]);
  });
});

describe("parsePartialTodoPayload", () => {
  it("extracts complete todo objects from truncated payload", () => {
    const items = parsePartialTodoPayload(
      '{"todos":[{"id":"1","content":"A","status":"pending"},{"id":"2","content":"B","status":"in_progress"',
    );
    expect(items).toEqual([{ id: "1", content: "A", status: "pending" }]);
  });
});

describe("collectWriteTodosFromMessages", () => {
  it("merges later write_todos updates by id", () => {
    const items = collectWriteTodosFromMessages([
      {
        toolData: {
          name: "write_todos",
          arguments: JSON.stringify({
            todos: [{ id: "1", content: "Plan", status: "pending" }],
          }),
        },
      },
      {
        toolData: {
          name: "write_todos",
          arguments: JSON.stringify({
            todos: [{ id: "1", content: "Plan", status: "completed" }],
          }),
        },
      },
    ]);
    expect(items).toEqual([{ id: "1", content: "Plan", status: "completed" }]);
  });

  it("uses partial parse while tool message is streaming", () => {
    const items = collectWriteTodosFromMessages([
      {
        status: "streaming",
        toolData: {
          name: "write_todos",
          arguments:
            '{"todos":[{"id":"1","content":"Plan","status":"in_progress"},{"id":"2","content":"Test","status":"pending"',
        },
      },
    ]);
    expect(items).toEqual([
      { id: "1", content: "Plan", status: "in_progress" },
    ]);
  });

  it("keeps original id order instead of grouping by status", () => {
    const items = collectWriteTodosFromMessages([
      {
        toolData: {
          name: "write_todos",
          arguments: JSON.stringify({
            todos: [
              { id: "1", content: "Research", status: "completed" },
              { id: "2", content: "Realize", status: "in_progress" },
              { id: "3", content: "Test", status: "pending" },
            ],
          }),
        },
      },
    ]);
    expect(items.map((item) => item.content)).toEqual(["Research", "Realize", "Test"]);
  });
});

describe("sortTodoItems", () => {
  it("orders numeric ids naturally so 10 follows 2", () => {
    const items = sortTodoItems([
      { id: "10", content: "Steps10", status: "pending" },
      { id: "2", content: "Steps2", status: "completed" },
      { id: "1", content: "Steps1", status: "in_progress" },
    ]);
    expect(items.map((item) => item.id)).toEqual(["1", "2", "10"]);
  });
});
