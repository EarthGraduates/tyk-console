/**
 * Settings page tests — pure Ant Design + localStorage + fetch, no Refine hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, AntdOnlyWrapper } from "../../test/testUtils";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./index";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tyk_gateway_url", "http://localhost:8080");
  localStorage.setItem("tyk_secret", "test-secret-123");
  localStorage.setItem("tyk_docker_url", "http://localhost:3001");
  localStorage.setItem("tyk_refresh_interval", "10");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("renders form with initial values from localStorage", () => {
    render(
      <AntdOnlyWrapper>
        <SettingsPage />
      </AntdOnlyWrapper>,
    );

    expect(screen.getByDisplayValue("http://localhost:8080")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-secret-123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("http://localhost:3001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });

  it("saves configuration to localStorage on form submit", async () => {
    const user = userEvent.setup();
    render(
      <AntdOnlyWrapper>
        <SettingsPage />
      </AntdOnlyWrapper>,
    );

    const gatewayInput = screen.getByDisplayValue("http://localhost:8080");
    await user.clear(gatewayInput);
    await user.type(gatewayInput, "http://new-gateway:8080");

    await user.click(screen.getByRole("button", { name: /保存配置/ }));

    expect(localStorage.getItem("tyk_gateway_url")).toBe("http://new-gateway:8080");
  });

  it("shows success message when test connection succeeds", async () => {
    const mock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: "pass", version: "5.3.2" }),
    } as Response);

    const user = userEvent.setup();
    render(
      <AntdOnlyWrapper>
        <SettingsPage />
      </AntdOnlyWrapper>,
    );

    await user.click(screen.getByRole("button", { name: /测试连接/ }));

    await waitFor(() => {
      expect(screen.getByText(/连接成功/)).toBeInTheDocument();
    });

    mock.mockRestore();
  });

  it("shows error message when test connection fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    render(
      <AntdOnlyWrapper>
        <SettingsPage />
      </AntdOnlyWrapper>,
    );

    await user.click(screen.getByRole("button", { name: /测试连接/ }));

    await waitFor(() => {
      expect(screen.getByText(/无法连接到 Tyk Gateway/)).toBeInTheDocument();
    });
  });

  it("toggles API Secret visibility", async () => {
    const user = userEvent.setup();
    render(
      <AntdOnlyWrapper>
        <SettingsPage />
      </AntdOnlyWrapper>,
    );

    const secretInput = screen.getByDisplayValue("test-secret-123");
    expect(secretInput).toHaveAttribute("type", "password");

    // Click the eye icon button in the suffix
    const eyeButton = screen.getByRole("button", { name: /eye/i });
    await user.click(eyeButton);

    expect(secretInput).toHaveAttribute("type", "text");
  });
});
