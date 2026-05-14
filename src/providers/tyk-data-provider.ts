// @ts-nocheck — Tyk API calls return dynamic JSON; Refine DataProvider interface has broad annotations
import type { DataProvider } from "@refinedev/core";

// --- Config ---
const STORAGE_KEY_GATEWAY = "tyk_gateway_url";
const STORAGE_KEY_SECRET = "tyk_secret";

function getGatewayUrl(): string {
  return localStorage.getItem(STORAGE_KEY_GATEWAY) || "http://localhost:8080";
}

function getSecret(): string {
  return localStorage.getItem(STORAGE_KEY_SECRET) || "";
}

function authHeaders(): Record<string, string> {
  const secret = getSecret();
  if (!secret) return {};
  return { "x-tyk-authorization": secret };
}

// --- Reload Strategy ---
let autoReload = true; // default: auto reload after each mutation
let pendingChanges = 0;

export function setAutoReload(enabled: boolean) {
  autoReload = enabled;
}

export function isAutoReload(): boolean {
  return autoReload;
}

export function getPendingChanges(): number {
  return pendingChanges;
}

/** Call /tyk/reload/ and reset pending counter */
async function reloadGateway(): Promise<void> {
  try {
    await fetch(`${getGatewayUrl()}/tyk/reload/`, {
      headers: authHeaders(),
    });
    pendingChanges = 0;
  } catch {
    // reload failure – pending changes remain
  }
}

/** After a mutation, either auto-reload or increment pending */
async function afterMutation(): Promise<void> {
  if (autoReload) {
    await reloadGateway();
  } else {
    pendingChanges++;
  }
}

// --- Shared fetch wrapper ---
async function tykFetch(
  resource: string,
  init: RequestInit = {}
): Promise<any> {
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

  // ====== APIs ======
  getList: async ({ resource }) => {
    if (resource === "apis") {
      const data = (await tykFetch("apis/")) || [];
      return { data: Array.isArray(data) ? data : [], total: data.length };
    }
    if (resource === "keys") {
      // Tyk's keys endpoint returns an object { keys: [...] }
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
      // Tyk OSS key detail: GET /tyk/keys/{keyId}
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
      const data = await tykFetch(`apis/${id}`, {
        method: "DELETE",
      });
      await afterMutation();
      return { data };
    }
    if (resource === "keys") {
      // Tyk OSS key deletion uses different endpoint
      await tykFetch(`keys/${id}?api_id=`, {
        method: "DELETE",
      });
      await afterMutation();
      return { data: { id } };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ====== Required stubs ======
  createMany: async () => {
    throw new Error("createMany not implemented");
  },
  deleteMany: async () => {
    throw new Error("deleteMany not implemented");
  },
  updateMany: async () => {
    throw new Error("updateMany not implemented");
  },
  custom: async () => {
    throw new Error("custom not implemented");
  },

  // ====== Reload (for manual trigger) ======
  getReloadStatus: async () => {
    return { data: { pendingChanges, autoReload } };
  },
  reload: async () => {
    await reloadGateway();
    return { data: { success: true } };
  },
  toggleAutoReload: async (vars: { enabled: boolean }) => {
    autoReload = vars.enabled;
    if (autoReload && pendingChanges > 0) {
      await reloadGateway();
    }
    return { data: { autoReload, pendingChanges } };
  },
} as any; // getReloadStatus/reload are custom methods
