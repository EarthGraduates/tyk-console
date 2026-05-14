// @ts-nocheck — test code
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tykDataProvider,
  setAutoReload,
  isAutoReload,
  getPendingChanges,
} from "../src/providers/tyk-data-provider";

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  Object.keys(store).forEach(k => delete store[k]);
  store["tyk_secret"] = "test-secret";
  store["tyk_gateway_url"] = "http://localhost:8080";
  setAutoReload(false); // default to manual to avoid real reload calls in tests
});

function mockResponse(body: any, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

describe("Tyk Data Provider", () => {
  describe("getList – apis", () => {
    it("returns an empty list", async () => {
      mockResponse([]);
      const result = await tykDataProvider.getList({ resource: "apis" });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("returns API definitions", async () => {
      mockResponse([{ api_id: "1", name: "Test API" }]);
      const result = await tykDataProvider.getList({ resource: "apis" });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Test API");
    });

    it("sends x-tyk-authorization header", async () => {
      mockResponse([]);
      await tykDataProvider.getList({ resource: "apis" });
      const [url, init] = mockFetch.mock.calls[0];
      expect(init.headers["x-tyk-authorization"]).toBe("test-secret");
      expect(url).toContain("/tyk/apis/");
    });
  });

  describe("getList – keys", () => {
    it("returns key list", async () => {
      mockResponse({ keys: [{ key_id: "k1", quota: 100 }] });
      const result = await tykDataProvider.getList({ resource: "keys" });
      expect(result.data).toHaveLength(1);
    });
  });

  describe("create & delete – apis", () => {
    it("creates an API and increments pending when autoReload is off", async () => {
      setAutoReload(false);
      mockResponse({ Status: "OK" });
      await tykDataProvider.create({ resource: "apis", variables: { name: "New API", api_id: "new1", proxy: { listen_path: "/new/", target_url: "http://upstream" } } });
      expect(getPendingChanges()).toBe(1);
    });

    it("creates and auto-reloads when autoReload is on", async () => {
      setAutoReload(true);
      mockResponse({ Status: "OK" });  // create
      mockResponse({ status: "ok" });  // reload
      await tykDataProvider.create({ resource: "apis", variables: { name: "A" } });
      expect(getPendingChanges()).toBe(0);
      expect(mockFetch.mock.calls.length).toBe(2); // create + reload
    });

    it("deletes an API", async () => {
      mockResponse({ Status: "OK" });
      const result = await tykDataProvider.deleteOne({ resource: "apis", id: "test-api" });
      expect(result.data).toBeDefined();
      expect(mockFetch.mock.calls[0][0]).toContain("test-api");
    });
  });

  describe("reload control", () => {
    it("starts with autoReload on", () => {
      setAutoReload(true);
      expect(isAutoReload()).toBe(true);
    });

    it("toggle AutoReload updates flag", () => {
      setAutoReload(false);
      expect(isAutoReload()).toBe(false);
    });
  });
});
