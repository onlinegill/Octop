import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsageStats, visibleStatCount, type UsageStatItem } from "./UsageStats";

const getComputedStyle = window.getComputedStyle;

beforeAll(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEMS: UsageStatItem[] = [
  { key: "total", label: "Total tokens", value: "2,788,473" },
  { key: "input", label: "Input", value: "2,764,158" },
  { key: "output", label: "Output", value: "24,315" },
  { key: "cacheRead", label: "Cache input", value: "2,097,826" },
  { key: "cacheHit", label: "Cache hit rate", value: "76.0%" },
  { key: "turns", label: "Dialogue turns", value: 15 },
  { key: "avg", label: "Mean/Wheel", value: "185,898" },
];

describe("visibleStatCount", () => {
  it("fits all seven cards on a wide row", () => {
    expect(visibleStatCount(1400, 7)).toBe(7);
  });

  it("keeps a single row and reserves the overflow control on a slightly narrow display", () => {
    const visible = visibleStatCount(900, 7);
    expect(visible).toBeGreaterThanOrEqual(1);
    expect(visible).toBeLessThan(7);
  });
});

describe("UsageStats", () => {
  it("shows every metric in one row on a wide display", () => {
    render(<UsageStats items={ITEMS} width={1400} />);

    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("Mean/Wheel")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common.viewMore" }),
    ).not.toBeInTheDocument();
  });

  it("stays on one row and opens leftover metrics from the overflow icon", async () => {
    const user = userEvent.setup();
    render(<UsageStats items={ITEMS} width={900} />);

    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.queryByText("Mean/Wheel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.viewMore" }));

    expect(await screen.findByText("Mean/Wheel")).toBeInTheDocument();
    expect(screen.getByText("185,898")).toBeInTheDocument();
  });

  it("does not hide metrics behind overflow on mobile", () => {
    render(<UsageStats items={ITEMS} width={900} overflowEnabled={false} />);

    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("Mean/Wheel")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common.viewMore" }),
    ).not.toBeInTheDocument();
  });
});
