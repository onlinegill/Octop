import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../api/modules/memoryDashboard", () => ({
  memoryDashboardApi: {
    getExtractConfig: vi.fn(),
    putExtractConfig: vi.fn(),
  },
}));

vi.mock("../../../api/modules/provider", () => ({
  providerApi: {
    listResolvedModels: vi.fn(),
  },
}));

import { memoryDashboardApi } from "../../../api/modules/memoryDashboard";
import { providerApi } from "../../../api/modules/provider";
import MemorySettings from "./MemorySettings";

const api = vi.mocked(memoryDashboardApi, true);
const providers = vi.mocked(providerApi, true);

const idleConfig = {
  memory_enabled: true,
  extract_on_session_end: true,
  extract_trigger_mode: "idle" as const,
  extract_idle_seconds: 300,
  extract_interval_seconds: 21600,
};

beforeEach(() => {
  vi.clearAllMocks();
  providers.listResolvedModels.mockResolvedValue([]);
});

describe("<MemorySettings />", () => {
  it("loads the memory switch and distillation timing", async () => {
    api.getExtractConfig.mockResolvedValue(idleConfig);
    render(<MemorySettings agentId="ZYWZTD" />);

<<<<<<< HEAD
    await screen.findByText("Store memory");
    expect(screen.getByText("Already turned on")).toBeInTheDocument();
    expect(screen.getByText("Conversation refined after free time")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue("5");
=======
    await screen.findByText("存储记忆");
    expect(screen.getByText("已开启")).toBeInTheDocument();
    expect(screen.getByText("对话空闲后提炼")).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue("5");
>>>>>>> upstream/main
  });

  it("explains exactly what happens when memory is disabled", async () => {
    api.getExtractConfig.mockResolvedValue(idleConfig);
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);
    await screen.findByText("Store memory");

    await user.click(screen.getByRole("switch"));
    expect(screen.getByText("After closing Agent Memory will no longer be used")).toBeInTheDocument();
    expect(
      screen.getByText(/Existing memories and conversation records will not be deleted/),
    ).toBeInTheDocument();
  });

  it("saves the real memory switch and converted timing values", async () => {
    api.getExtractConfig.mockResolvedValue(idleConfig);
    api.putExtractConfig.mockResolvedValue(idleConfig);
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);
    await screen.findByText("Store memory");

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      expect(api.putExtractConfig).toHaveBeenCalledWith("ZYWZTD", {
        memory_enabled: true,
        extract_on_session_end: true,
        extract_trigger_mode: "idle",
        extract_idle_seconds: 300,
        extract_interval_seconds: 21600,
        aux_model: "",
        extract_max_tokens: 0,
        extract_light_timeout_s: 0,
        extract_heavy_timeout_s: 0,
      });
    });
  });

  it("saves a pinned extraction model", async () => {
    api.getExtractConfig.mockResolvedValue(idleConfig);
    api.putExtractConfig.mockResolvedValue({
      ...idleConfig,
      aux_model: "hai/mini",
    });
    providers.listResolvedModels.mockResolvedValue([
      { provider_name: "hai", model: "mini", name: "Mini" },
    ] as never);
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);
    await screen.findByText("Memory retrieval model");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("hai / Mini"));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(api.putExtractConfig).toHaveBeenCalledWith(
        "ZYWZTD",
        expect.objectContaining({ aux_model: "hai/mini" }),
      ),
    );
  });

  it("normalizes an invalid zero idle time to one minute", async () => {
    api.getExtractConfig.mockResolvedValue({
      ...idleConfig,
      extract_idle_seconds: 0,
    });
    api.putExtractConfig.mockResolvedValue({
      ...idleConfig,
      extract_idle_seconds: 60,
    });
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);

<<<<<<< HEAD
    await screen.findByText("Store memory");
    expect(screen.getByRole("spinbutton")).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
=======
    await screen.findByText("存储记忆");
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
>>>>>>> upstream/main
    await waitFor(() =>
      expect(api.putExtractConfig).toHaveBeenCalledWith(
        "ZYWZTD",
        expect.objectContaining({ extract_idle_seconds: 60 }),
      ),
    );
  });

  it("loads and saves the advanced distillation call limits", async () => {
    api.getExtractConfig.mockResolvedValue({
      ...idleConfig,
      extract_max_tokens: 1024,
      extract_light_timeout_s: 45,
      extract_heavy_timeout_s: null,
    });
    api.putExtractConfig.mockResolvedValue(idleConfig);
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);

    await screen.findByText("提炼调用参数");
    const spinbuttons = screen.getAllByRole("spinbutton");
    expect(spinbuttons).toHaveLength(4);
    // Stored values render as-is; null renders as the automatic sentinel.
    expect(spinbuttons[1]).toHaveValue("1024");
    expect(spinbuttons[2]).toHaveValue("45");
    expect(spinbuttons[3]).toHaveValue("0");
    expect(screen.getByText(/最多等多久/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(api.putExtractConfig).toHaveBeenCalledWith(
        "ZYWZTD",
        expect.objectContaining({
          extract_max_tokens: 1024,
          extract_light_timeout_s: 45,
          extract_heavy_timeout_s: 0,
        }),
      ),
    );
  });

  it("shows the interval caveat", async () => {
    api.getExtractConfig.mockResolvedValue(idleConfig);
    const user = userEvent.setup();
    render(<MemorySettings agentId="ZYWZTD" />);
    await screen.findByText("Fixed interval extraction");
    await user.click(screen.getByText("Fixed interval extraction"));
    expect(await screen.findByText(/Runs while the session has not yet ended/)).toBeInTheDocument();
  });
});
