/**
 * Test utilities — wrapper components, mock providers, and testing-library re-exports.
 *
 * Two wrapper levels:
 * - `AntdOnlyWrapper` — for pages that only need Ant Design context (no Refine hooks)
 * - `TestWrapper` — full stack: AntdApp + BrowserRouter + Refine(mock providers)
 */

import React, { type ReactNode } from "react";
import { BrowserRouter } from "react-router";
import { App as AntdApp } from "antd";
import { Refine, type AuthProvider, type DataProvider } from "@refinedev/core";
import { MockJSONServer } from "./mocks";

// ── Wrappers ──

export interface TestWrapperOptions {
  authProvider?: AuthProvider;
  dataProvider?: DataProvider;
}

/**
 * Factory that returns a wrapper component for use with testing-library's `render`:
 *
 *   render(<MyPage />, { wrapper: TestWrapper({ authProvider: mockAuth }) });
 */
export function TestWrapper(options: TestWrapperOptions = {}) {
  const { authProvider, dataProvider } = options;

  return function Wrapper({ children }: { children?: ReactNode }) {
    return (
      <AntdApp>
        <BrowserRouter>
          <Refine
            dataProvider={dataProvider ?? MockJSONServer}
            authProvider={authProvider ?? createMockAuthProvider()}
            options={{
              disableTelemetry: true,
              reactQuery: {
                clientConfig: {
                  defaultOptions: {
                    queries: { gcTime: 0, staleTime: 0, networkMode: "always" },
                  },
                },
              },
            }}
          >
            {children}
          </Refine>
        </BrowserRouter>
      </AntdApp>
    );
  };
}

/**
 * Minimal wrapper for pages that use Ant Design's `App.useApp()` but not Refine hooks.
 *
 *   render(<AntdOnlyWrapper><SettingsPage /></AntdOnlyWrapper>);
 */
export function AntdOnlyWrapper({ children }: { children?: ReactNode }) {
  return <AntdApp>{children}</AntdApp>;
}

// ── Mock auth provider ──

/** An authenticated auth provider suitable for most page tests. */
export function createMockAuthProvider(): AuthProvider {
  return {
    login: async () => ({ success: true, redirectTo: "/" }),
    logout: async () => ({ success: true, redirectTo: "/login" }),
    check: async () => ({ authenticated: true }),
    onError: async (error) => ({ error }),
    getPermissions: async () => "system_admin",
    getIdentity: async () => ({
      id: "test-user-id",
      name: "Test User",
      email: "test@ichse.local",
      bizRole: "system_admin",
      secretLevel: "内部",
    }),
  };
}

// ── Re-exports ──

// Everything from testing-library/react so test files need only one import
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
