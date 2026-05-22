/**
 * ichse 管理数据库服务层（PostgREST → PostgreSQL）
 *
 * @description
 * 通过 PostgREST 将 PostgreSQL 暴露为 REST API，
 * 浏览器端直接用 fetch 调 localhost:3001。
 *
 * @module providers/ichse-db
 */

// @ts-nocheck — 动态 JSON 响应类型较宽泛

// Vite proxy: /db/* → http://localhost:3001/*
import { getAuthHeader } from './jwt';

async function rest(method: string, path: string, body?: any, params?: Record<string, string>): Promise<any> {
  const url = new URL(`/db${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers: Record<string, string> = {
    ...getAuthHeader(),
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PostgREST ${method} ${path}: ${res.status} ${err.substring(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── 类型 ──

export interface ApiDefinition {
  id?: string;
  api_id: string;
  owner_id: string;
  name: string;
  listen_path?: string;
  target_url?: string;
  auth_mode: string;
  status: 'active' | 'inactive' | 'archived';
  sync_status: 'synced' | 'pending' | 'failed';
  last_sync_at?: string;
  sync_error?: string;
  definition: Record<string, unknown>;
  version: number;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

export interface ApiDefinitionLog {
  id?: string;
  api_id: string;
  definition: Record<string, unknown>;
  version: number;
  change_type: 'create' | 'update' | 'delete' | 'status_change' | 'rollback';
  change_summary?: string;
  updated_by?: string;
  updated_at?: string;
}

export interface ApiKey {
  id?: string;
  key_id: string;
  api_id: string;
  key_value?: string;
  access_rights?: Record<string, unknown>;
  rate?: number;
  per?: number;
  quota_max?: number;
  expires_at?: string;
  status: 'active' | 'revoked' | 'expired';
  created_at?: string;
  updated_at?: string;
  revoked_at?: string;
}

// ── api_definitions CRUD ──

export const apiDefinitionsDb = {
  async list(status?: string) {
    const params: Record<string, string> = { order: 'created_at.desc' };
    if (status) params.status = `eq.${status}`;
    return (await rest('GET', '/api_definitions', null, params)) as ApiDefinition[];
  },

  async getByApiId(apiId: string) {
    const rows = await rest('GET', '/api_definitions', null, { api_id: `eq.${apiId}` });
    return (rows?.[0] || null) as ApiDefinition | null;
  },

  async create(record: Omit<ApiDefinition, 'id' | 'created_at' | 'updated_at'>) {
    const now = new Date().toISOString();
    const rows = await rest('POST', '/api_definitions', {
      ...record,
      definition: typeof record.definition === 'string' ? record.definition : JSON.stringify(record.definition),
      created_at: now,
      updated_at: now,
    });
    return rows?.[0] as ApiDefinition;
  },

  async update(apiId: string, updates: Partial<ApiDefinition>) {
    const body: any = { ...updates, updated_at: new Date().toISOString() };
    if (body.definition && typeof body.definition !== 'string') {
      body.definition = JSON.stringify(body.definition);
    }
    if (body.access_rights && typeof body.access_rights !== 'string') {
      body.access_rights = JSON.stringify(body.access_rights);
    }
    const rows = await rest('PATCH', '/api_definitions', body, { api_id: `eq.${apiId}` });
    return rows?.[0] as ApiDefinition;
  },

  async delete(apiId: string) {
    await rest('DELETE', '/api_definitions', null, { api_id: `eq.${apiId}` });
  },

  async markSynced(apiId: string) {
    return apiDefinitionsDb.update(apiId, {
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      sync_error: undefined,
    } as any);
  },

  async markSyncFailed(apiId: string, errorMsg: string) {
    return apiDefinitionsDb.update(apiId, {
      sync_status: 'failed',
      sync_error: errorMsg,
    } as any);
  },
};

// ── api_definition_log ──

export const apiDefinitionLogDb = {
  async insert(log: Omit<ApiDefinitionLog, 'id' | 'updated_at'>) {
    const rows = await rest('POST', '/api_definition_log', {
      ...log,
      definition: typeof log.definition === 'string' ? log.definition : JSON.stringify(log.definition),
      updated_at: new Date().toISOString(),
    });
    return rows?.[0] as ApiDefinitionLog;
  },

  async listByApiId(apiId: string, limit = 20) {
    return (await rest('GET', '/api_definition_log', null, {
      api_id: `eq.${apiId}`,
      order: 'updated_at.desc',
      limit: String(limit),
    })) as ApiDefinitionLog[];
  },
};

// ── api_keys ──

export const apiKeysDb = {
  async list() {
    return (await rest('GET', '/api_keys', null, { order: 'created_at.desc' })) as ApiKey[];
  },

  async getByKeyId(keyId: string) {
    const rows = await rest('GET', '/api_keys', null, { key_id: `eq.${keyId}` });
    return (rows?.[0] || null) as ApiKey | null;
  },

  async create(record: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>) {
    const now = new Date().toISOString();
    const rows = await rest('POST', '/api_keys', {
      ...record,
      access_rights: record.access_rights ? JSON.stringify(record.access_rights) : '{}',
      created_at: now,
      updated_at: now,
    });
    return rows?.[0] as ApiKey;
  },

  async revoke(keyId: string) {
    const now = new Date().toISOString();
    const rows = await rest('PATCH', '/api_keys',
      { status: 'revoked', revoked_at: now, updated_at: now },
      { key_id: `eq.${keyId}` });
    return rows?.[0] as ApiKey;
  },
};

// ── users ──

export const usersDb = {
  async ensureUser(authUserId: string, email: string) {
    const rows = await rest('GET', '/users', null, { auth_user_id: `eq.${authUserId}` });
    if (rows?.length) return rows[0];

    const created = await rest('POST', '/users', {
      auth_user_id: authUserId,
      email,
      display_name: email,
      role: 'user',
      created_at: new Date().toISOString(),
    });
    return created?.[0];
  },

  async getSystemUserId() {
    const rows = await rest('GET', '/users', null, { display_name: 'eq.system' });
    return rows?.[0]?.id || null;
  },
};
