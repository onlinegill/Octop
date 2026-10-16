import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageSender, { ExpertMessageAvatar } from "./MessageSender";
import { ChatAgentProfileProvider } from "../ChatAgentProfileContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("MessageSender", () => {
  it("renders a plain avatar without a visible name", () => {
    render(<MessageSender name="Ada" avatar={<span>A</span>} />);
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ada")).toBeInTheDocument();
  });

  it("shows the expert name as a tooltip target and opens the profile", () => {
    const onOpen = vi.fn();
    render(
      <ChatAgentProfileProvider canOpen onOpen={onOpen}>
        <ExpertMessageAvatar
          name="Data analyst"
          color="#6366f1"
          iconName="sparkles"
        />
      </ChatAgentProfileProvider>,
    );

    const btn = screen.getByRole("button", { name: "Data analyst" });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(undefined);
  });

  it("opens the member profile id and shows a host tooltip", () => {
    const onOpen = vi.fn();
    render(
      <ChatAgentProfileProvider canOpen onOpen={onOpen} isTeam>
        <ExpertMessageAvatar
          name="Clinical assistant"
          tooltip="[Heart team] Moderator"
          profileAgentId="doctor"
          iconName="sparkles"
        />
      </ChatAgentProfileProvider>,
    );

    const btn = screen.getByRole("button", { name: "[Heart team] Moderator" });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("doctor");
  });
});
