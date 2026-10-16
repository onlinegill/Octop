import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import CaptchaField, { type CaptchaFieldHandle } from "./CaptchaField";
import { loginCaptchaBody } from "./captchaAdapters";

const labels = {
  slideHint: "Slide",
  slideVerifiedLabel: "OK",
  unsupportedLabel: "Use this captcha on a supported client",
};

describe("CaptchaField", () => {
  it("renders the slider for the default provider", () => {
    render(
      <CaptchaField
        config={{ provider: "slider" }}
        {...labels}
        onReadyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("slide-captcha-track")).toBeInTheDocument();
    expect(screen.queryByTestId("captcha-widget")).not.toBeInTheDocument();
  });

  it("renders a vendor host for checkbox providers", () => {
    render(
      <CaptchaField
        config={{ provider: "turnstile", site_key: "0xsite" }}
        {...labels}
        onReadyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("captcha-widget")).toBeInTheDocument();
    expect(screen.queryByTestId("slide-captcha-track")).not.toBeInTheDocument();
  });

  it("shows a static error when the slug has no adapter", () => {
    render(
      <CaptchaField
        config={{ provider: "unknown-vendor", site_key: "x" }}
        {...labels}
        onReadyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("captcha-unsupported")).toHaveTextContent(
      labels.unsupportedLabel,
    );
  });

  it("returns no token from the slider handle", async () => {
    const ref = createRef<CaptchaFieldHandle>();
    render(
      <CaptchaField
        ref={ref}
        config={{ provider: "slider" }}
        {...labels}
        onReadyChange={vi.fn()}
      />,
    );
    await expect(ref.current?.getToken()).resolves.toBeUndefined();
  });

});

describe("loginCaptchaBody", () => {
  it("omits captcha_token unless a strong token is present", () => {
    expect(loginCaptchaBody("a", "b")).toEqual({
      username: "a",
      password: "b",
    });
    expect(loginCaptchaBody("a", "b", "tok")).toEqual({
      username: "a",
      password: "b",
      captcha_token: "tok",
    });
  });
});
