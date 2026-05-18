/**
 * ichse Schema 数据库服务层
 *
 * @description
 * 封装对 ichse schema 下 4 张表的 CRUD 操作。
 * 使用独立的 Supabase 客户端（非 Refine dataProvider），
 * 提供类型化的数据库读写接口。
 *
 * ## 表映射
 * - api_definitions  → ichse.api_definitions
 * - api_definition_log → ichse.api_definition_log
 * - api_keys          → ichse.api_keys
 * - users             → ichse.users
 *
 * @module providers/ichse-db
 */

// @ts-nocheck — Supabase client schema generic 过于严格
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './constants';

// ── 客户端（单例） ──

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: 'ichse' },
      auth: { persistSession: false },
    });
  }
  return _client;
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
  /** 查询所有（可按状态筛选） */
  async list(status?: string) {
    const client = getClient();
    let query = client.from('api_definitions').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(`api_definitions.list: ${error.message}`);
    return (data || []) as ApiDefinition[];
  },

  /** 按 api_id 查询单条 */
  async getByApiId(apiId: string) {
    const { data, error } = await getClient()
      .from('api_definitions')
      .select('*')
      .eq('api_id', apiId)
      .maybeSingle();
    if (error) throw new Error(`api_definitions.getByApiId: ${error.message}`);
    return (data || null) as ApiDefinition | null;
  },

  /** 创建 */
  async create(record: Omit<ApiDefinition, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await getClient()
      .from('api_definitions')
      .insert(record)
      .select()
      .single();
    if (error) throw new Error(`api_definitions.create: ${error.message}`);
    return data as ApiDefinition;
  },

  /** 更新（按 api_id） */
  async update(apiId: string, updates: Partial<ApiDefinition>) {
    const { data, error } = await getClient()
      .from('api_definitions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('api_id', apiId)
      .select()
      .single();
    if (error) throw new Error(`api_definitions.update: ${error.message}`);
    return data as ApiDefinition;
  },

  /** 删除（按 api_id） */
  async delete(apiId: string) {
    const { error } = await getClient()
      .from('api_definitions')
      .delete()
      .eq('api_id', apiId);
    if (error) throw new Error(`api_definitions.delete: ${error.message}`);
  },

  /** 同步状态标记 */
  async markSynced(apiId: string) {
    return apiDefinitionsDb.update(apiId, {
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      sync_error: undefined,
    });
  },

  async markSyncFailed(apiId: string, errorMsg: string) {
    return apiDefinitionsDb.update(apiId, {
      sync_status: 'failed',
      sync_error: errorMsg,
    });
  },
};

// ── api_definition_log ──

export const apiDefinitionLogDb = {
  /** 插入变更日志 */
  async insert(log: Omit<ApiDefinitionLog, 'id' | 'updated_at'>) {
    const { data, error } = await getClient()
      .from('api_definition_log')
      .insert(log)
      .select()
      .single();
    if (error) throw new Error(`api_definition_log.insert: ${error.message}`);
    return data as ApiDefinitionLog;
  },

  /** 查询某 API 的变更历史 */
  async listByApiId(apiId: string, limit = 20) {
    const { data, error } = await getClient()
      .from('api_definition_log')
      .select('*')
      .eq('api_id', apiId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`api_definition_log.listByApiId: ${error.message}`);
    return (data || []) as ApiDefinitionLog[];
  },
};

// ── api_keys ──

export const apiKeysDb = {
  /** 查询所有 */
  async list() {
    const { data, error } = await getClient()
      .from('api_keys')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`api_keys.list: ${error.message}`);
    return (data || []) as ApiKey[];
  },

  /** 按 key_id 查询 */
  async getByKeyId(keyId: string) {
    const { data, error } = await getClient()
      .from('api_keys')
      .select('*')
      .eq('key_id', keyId)
      .maybeSingle();
    if (error) throw new Error(`api_keys.getByKeyId: ${error.message}`);
    return (data || null) as ApiKey | null;
  },

  /** 创建 */
  async create(record: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await getClient()
      .from('api_keys')
      .insert(record)
      .select()
      .single();
    if (error) throw new Error(`api_keys.create: ${error.message}`);
    return data as ApiKey;
  },

  /** 吊销（更新状态） */
  async revoke(keyId: string) {
    const now = new Date().toISOString();
    const { data, error } = await getClient()
      .from('api_keys')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('key_id', keyId)
      .select()
      .single();
    if (error) throw new Error(`api_keys.revoke: ${error.message}`);
    return data as ApiKey;
  },
};

// ── users ──

export const usersDb = {
  /** 获取或创建 auth user 对应的 business user */
  async ensureUser(authUserId: string, email: string) {
    const client = getClient();
    // 先查
    const { data: existing } = await client
      .from('users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (existing) return existing;

    // 不存在则创建
    const { data: created, error } = await client
      .from('users')
      .insert({ auth_user_id: authUserId, email, display_name: email, role: 'user' })
      .select()
      .single();
    if (error) throw new Error(`users.ensureUser: ${error.message}`);
    return created;
  },

  /** 获取 system 用户的 id */
  async getSystemUserId() {
    const { data } = await getClient()
      .from('users')
      .select('id')
      .eq('display_name', 'system')
      .maybeSingle();
    return data?.id || null;
  },
};
