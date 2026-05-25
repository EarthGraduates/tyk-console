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
import { getBizRole } from './permissions';

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

export interface UserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  is_system: boolean;
  role?: string;
  secret_level?: string;
  status: string;
  last_login_at?: string;
  failed_attempts?: number;
  locked_until?: string;
  password_changed_at?: string;
  created_at: string;
}

function userView(): string {
  const role = getBizRole();
  return role === 'security_admin' ? '/users_secadmin_view' : '/users_sysadmin_view';
}

export const usersDb = {
  async list(): Promise<UserRecord[]> {
    return (await rest('GET', userView(), null, { order: 'created_at.desc' })) as UserRecord[];
  },

  async getById(id: string): Promise<UserRecord | null> {
    const rows = await rest('GET', userView(), null, { id: `eq.${id}` });
    return rows?.[0] ?? null;
  },

  /** 所有写操作通过 ichse.manage_user RPC（SECURITY DEFINER） */
  async create(params: {
    email: string;
    password: string;
    display_name: string;
    phone?: string;
    role?: string;
    secret_level?: string;
  }) {
    return await rest('POST', '/rpc/manage_user', {
      p_action: 'create',
      p_email: params.email,
      p_password: params.password,
      p_display_name: params.display_name,
      p_phone: params.phone ?? null,
      p_role: params.role ?? 'business_user',
      p_secret_level: params.secret_level ?? '内部',
    });
  },

  async update(id: string, params: {
    email?: string;
    phone?: string;
    display_name?: string;
    role?: string;
    secret_level?: string;
    status?: string;
  }) {
    return await rest('POST', '/rpc/manage_user', {
      p_action: 'update',
      p_user_id: id,
      ...params,
    });
  },

  async disable(id: string) {
    return await rest('POST', '/rpc/manage_user', { p_action: 'disable', p_user_id: id });
  },

  async enable(id: string) {
    return await rest('POST', '/rpc/manage_user', { p_action: 'enable', p_user_id: id });
  },

  async resetPassword(id: string, password: string) {
    return await rest('POST', '/rpc/manage_user', { p_action: 'reset_password', p_user_id: id, p_password: password });
  },

  async delete(id: string) {
    return await rest('POST', '/rpc/manage_user', { p_action: 'delete', p_user_id: id });
  },

  // legacy compat
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

// ── audit_log ──

export interface AuditLogRecord {
  id: number;
  event_time: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  event_type: string;
  event_success: boolean;
  target_type: string | null;
  target_id: string | null;
  target_detail: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  client_ip: string | null;
  user_agent: string | null;
  error_message: string | null;
}

export const auditLogDb = {
  async list(params?: {
    limit?: number;
    offset?: number;
    event_type?: string;
    user_id?: string;
    from?: string;
    to?: string;
  }): Promise<AuditLogRecord[]> {
    const q: Record<string, string> = { order: 'event_time.desc' };
    if (params?.limit) q.limit = String(params.limit);
    if (params?.offset) q.offset = String(params.offset);
    if (params?.event_type) q.event_type = `eq.${params.event_type}`;
    if (params?.user_id) q.user_id = `eq.${params.user_id}`;

    // date range uses PostgREST range syntax
    let path = '/audit_log';
    const andParams: string[] = [];
    if (params?.from) andParams.push(`event_time=gte.${encodeURIComponent(params.from)}`);
    if (params?.to) andParams.push(`event_time=lte.${encodeURIComponent(params.to)}`);
    if (andParams.length > 0) {
      // Use Prefer: params=single-object or build URL manually
      const url = new URL(`/db/audit_log?order=event_time.desc`, window.location.origin);
      if (params?.limit) url.searchParams.set('limit', String(params.limit));
      if (params?.offset) url.searchParams.set('offset', String(params.offset));
      if (params?.event_type) url.searchParams.set('event_type', `eq.${params.event_type}`);
      if (params?.user_id) url.searchParams.set('user_id', `eq.${params.user_id}`);
      andParams.forEach(p => {
        const [k, v] = p.split('=');
        url.searchParams.set(k, v);
      });
      const headers: Record<string, string> = { ...getAuthHeader() };
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`PostgREST GET /audit_log: ${res.status} ${err.substring(0, 200)}`);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : [];
    }

    return (await rest('GET', path, null, q)) as AuditLogRecord[];
  },

  async eventTypes(): Promise<string[]> {
    // Return distinct event types
    const rows = await rest('GET', '/audit_log', null, {
      select: 'event_type',
      order: 'event_type',
    });
    // Deduplicate manually since PostgreSQL distinct needs special handling
    const types = new Set<string>();
    for (const row of rows) {
      if (row.event_type) types.add(row.event_type);
    }
    return Array.from(types).sort();
  },
};
