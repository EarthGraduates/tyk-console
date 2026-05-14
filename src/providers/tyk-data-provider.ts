// @ts-nocheck — Tyk API calls return dynamic JSON; Refine DataProvider interface has broad annotations
import type { DataProvider } from "@refinedev/core";

// --- Config ---
const STORAGE_KEY_GATEWAY = "tyk_gateway_url";
const STORAGE_KEY_SECRET = "tyk_secret";
const STORAGE_KEY_AUTO_RELOAD = "tyk_auto_reload";

export function getGatewayUrl(): string {
  return localStorage.getItem(STORAGE_KEY_GATEWAY) || "http://localhost:8080";
}

export function getSecret(): string {
  return localStorage.getItem(STORAGE_KEY_SECRET) || "";
}

function authHeaders(): Record<string, string> {
  const secret = getSecret();
  if (!secret) return {};
  return { "x-tyk-authorization": secret };
}

// --- Reload Strategy ---
let autoReload: boolean | null = null; // lazy init from localStorage
let pendingChanges = 0;

function initAutoReload(): boolean {
  if (autoReload === null) {
    autoReload = localStorage.getItem(STORAGE_KEY_AUTO_RELOAD) !== "false";
  }
  return autoReload;
}

// notify callbacks for UI
const changeListeners: Array<(count: number) => void> = [];
let reloadListeners: Array<(count: number, time: string) => void> = [];
let reloadCount = Number(typeof localStorage !== "undefined" ? localStorage.getItem("tyk_reload_count") || 0 : 0);

export function setAutoReload(enabled: boolean) {
  autoReload = enabled;
  localStorage.setItem(STORAGE_KEY_AUTO_RELOAD, String(enabled));
}

export function isAutoReload(): boolean {
  return initAutoReload();
}

export function getPendingChanges(): number {
  return pendingChanges;
}

export function getReloadCount(): number {
  return reloadCount;
}

export function onPendingChange(fn: (count: number) => void) {
  changeListeners.push(fn);
}

export function onReload(fn: (count: number, time: string) => void) {
  reloadListeners.push(fn);
}

function notifyPendingChange() {
  changeListeners.forEach(fn => fn(pendingChanges));
}

function notifyReload() {
  const time = new Date().toLocaleTimeString();
  reloadListeners.forEach(fn => fn(reloadCount, time));
}

async function reloadGateway(): Promise<void> {
  try {
    await fetch(`${getGatewayUrl()}/tyk/reload/`, { headers: authHeaders() });
    pendingChanges = 0;
    reloadCount++;
    localStorage.setItem("tyk_reload_count", String(reloadCount));
    localStorage.setItem("tyk_reload_time", new Date().toLocaleTimeString());
    notifyPendingChange();
    notifyReload();
  } catch {
    // reload failure – pending changes remain
  }
}

async function afterMutation(): Promise<void> {
  if (initAutoReload()) {
    await reloadGateway();
  } else {
    pendingChanges++;
    notifyPendingChange();
  }
}

// --- Shared fetch wrapper ---
async function tykFetch(resource: string, init: RequestInit = {}): Promise<any> {
  const url = `${getGatewayUrl()}/tyk/${resource}`;
  const headers = { ...authHeaders(), ...init.headers };
  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tyk API error ${res.status}: ${err}`);
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// --- Data Provider ---
export const tykDataProvider: DataProvider = {
  getApiUrl: () => getGatewayUrl(),

  getList: async ({ resource }) => {
    if (resource === "apis") {
      const data = (await tykFetch("apis/")) || [];
      return { data: Array.isArray(data) ? data : [], total: data.length };
    }
    if (resource === "keys") {
      const raw = (await tykFetch("keys/")) || {};
      const keys = raw.keys || [];
      return { data: keys, total: keys.length };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  getOne: async ({ resource, id }) => {
    if (resource === "apis") {
      const data = await tykFetch(`apis/${id}`);
      return { data };
    }
    if (resource === "keys") {
      const data = await tykFetch(`keys/${id}`);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  create: async ({ resource, variables }) => {
    if (resource === "apis") {
      const data = await tykFetch("apis/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      return { data };
    }
    if (resource === "keys") {
      const data = await tykFetch("keys/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  update: async ({ resource, id, variables }) => {
    if (resource === "apis") {
      const data = await tykFetch(`apis/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      return { data };
    }
    if (resource === "keys") {
      const data = await tykFetch(`keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  deleteOne: async ({ resource, id }) => {
    if (resource === "apis") {
      await tykFetch(`apis/${id}`, { method: "DELETE" });
      await afterMutation();
      return { data: { id } };
    }
    if (resource === "keys") {
      await tykFetch(`keys/${id}?api_id=`, { method: "DELETE" });
      await afterMutation();
      return { data: { id } };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  createMany: async () => { throw new Error("createMany not implemented"); },
  deleteMany: async () => { throw new Error("deleteMany not implemented"); },
  updateMany: async () => { throw new Error("updateMany not implemented"); },
  custom: async () => { throw new Error("custom not implemented"); },
} as any;
