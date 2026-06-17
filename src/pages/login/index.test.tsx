/**
 * Login page tests — uses useLogin from Refine, tests auth integration path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, TestWrapper } from "../../test/testUtils";
import userEvent from "@testing-library/user-event";
import LoginPage from "./index";
import type { AuthProvider } from "@refinedev/core";

const mockLogin = vi.fn();

function mockAuthProvider(): AuthProvider {
  return {
    login: mockLogin,
    logout: async () => ({ success: true, redirectTo: "/login" }),
    check: async () => ({ authenticated: false }),
    onError: async (error) => ({ error }),
    getPermissions: async () => null,
    getIdentity: async () => null,
  };
}

beforeEach(() => {
  mockLogin.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginPage", () => {
  it("renders title and default password login form", () => {
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    expect(screen.getByText(/ichse 管理中心/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/手机号或邮箱/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/密码/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("dev_biz@ichse.local")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登\s*录/ })).toBeInTheDocument();
  });

  it("switches to code login tab and shows placeholder", async () => {
    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    await user.click(screen.getByText(/验证码/));

    expect(screen.getByText(/验证码登录功能开发中/)).toBeInTheDocument();
  });

  it("switches to QR code tab and shows placeholder", async () => {
    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    await user.click(screen.getByText(/扫码/));

    expect(screen.getByText(/扫码登录功能开发中/)).toBeInTheDocument();
  });

  it("shows forgot password alert when clicked", async () => {
    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    await user.click(screen.getByText(/忘记密码/));

    expect(screen.getByText(/请联系管理员重置密码/)).toBeInTheDocument();
  });

  it("calls login on form submit with correct values", async () => {
    mockLogin.mockResolvedValue({ success: true, redirectTo: "/" });

    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    await user.clear(screen.getByPlaceholderText(/手机号或邮箱/));
    await user.type(screen.getByPlaceholderText(/手机号或邮箱/), "test@ichse.local");
    await user.clear(screen.getByPlaceholderText(/密码/));
    await user.type(screen.getByPlaceholderText(/密码/), "password123");
    await user.click(screen.getByRole("button", { name: /登\s*录/ }));

    expect(mockLogin).toHaveBeenCalledWith({
      email: "test@ichse.local",
      password: "password123",
    });
  });

  it("stays on login page when login returns failure", async () => {
    mockLogin.mockResolvedValue({ success: false, error: new Error("Invalid credentials") });

    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: TestWrapper({ authProvider: mockAuthProvider() }) });

    await user.clear(screen.getByPlaceholderText(/手机号或邮箱/));
    await user.type(screen.getByPlaceholderText(/手机号或邮箱/), "bad@user.com");
    await user.clear(screen.getByPlaceholderText(/密码/));
    await user.type(screen.getByPlaceholderText(/密码/), "wrong");
    await user.click(screen.getByRole("button", { name: /登\s*录/ }));

    // auth provider was called with the form values
    expect(mockLogin).toHaveBeenCalledWith({
      email: "bad@user.com",
      password: "wrong",
    });

    // User stays on login page — login form is still present
    expect(screen.getByRole("button", { name: /登\s*录/ })).toBeInTheDocument();
  });
});
