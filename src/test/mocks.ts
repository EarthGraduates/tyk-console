/**
 * Reusable mocks for Refine data providers, fetch calls, and JWT tokens.
 */

import type { DataProvider } from "@refinedev/core";
import { vi } from "vitest";

// ── Mock Refine DataProvider ──

/** A no-op DataProvider that returns empty/default data for every method. */
export const MockJSONServer: DataProvider = {
  create: async () => ({ data: { id: "1" } }),
  createMany: async () => ({ data: [] }),
  deleteOne: async () => ({ data: { id: "1" } }),
  deleteMany: async () => ({ data: [] }),
  getList: async () => ({ data: [], total: 0 }),
  getMany: async () => ({ data: [] }),
  getOne: async () => ({ data: { id: "1" } }),
  update: async () => ({ data: { id: "1" } }),
  updateMany: async () => ({ data: [] }),
  getApiUrl: () => "",
  custom: async () => ({ data: {} }),
};

// ── Mock fetch ──

/** Shape of a mock fetch response (simplified Response). */
interface MockFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: Headers;
}

/**
 * Creates a `vi.fn()` that resolves to a mock fetch Response.
 * Use `vi.spyOn(global, 'fetch').mockImplementation(mock)` to install.
 */
export function createMockFetch(
  responseData: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(responseData),
    text: () => Promise.resolve(JSON.stringify(responseData)),
    headers: new Headers(headers),
  } as MockFetchResponse);
}

/**
 * URL-conditional fetch mock. Routes to different responses based on regex patterns.
 * Throws for unmatched URLs so tests fail fast on unexpected calls.
 */
export function createRoutedFetch(
  routes: Array<{ pattern: RegExp; data: unknown; status?: number }>,
) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const route of routes) {
      if (route.pattern.test(urlStr)) {
        const data = route.data;
        return Promise.resolve({
          ok: (route.status ?? 200) >= 200 && (route.status ?? 200) < 300,
          status: route.status ?? 200,
          json: () => Promise.resolve(data),
          text: () => Promise.resolve(JSON.stringify(data)),
          headers: new Headers(),
        });
      }
    }
    return Promise.reject(new Error(`Unmocked fetch URL: ${urlStr}`));
  });
}

// ── Fake JWT ──

export const FAKE_JWT_PAYLOAD = {
  role: "authenticated",
  sub: "test-user-uuid",
  biz_role: "system_admin",
  email: "test@ichse.local",
  phone: "13800000000",
  display_name: "Test User",
  secret_level: "内部",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 86400,
};

/**
 * Creates a JWT-shaped string from the fake payload.
 * The signature portion is a dummy — only the payload matters for decodeToken.
 */
export function createFakeJwt(): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify(FAKE_JWT_PAYLOAD));
  return `${header}.${payload}.fake-signature`;
}
