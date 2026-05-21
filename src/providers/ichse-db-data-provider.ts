/**
 * ichse 管理数据库 Refine Data Provider（PostgREST → PostgreSQL）
 *
 * @description
 * DB 优先策略：所有 CRUD 操作以 PostgreSQL 为权威源。
 * 创建/编辑仅写 DB（sync_status='pending'），Tyk 推送由页面手动触发。
 *
 * @module providers/ichse-db-data-provider
 * @see ADR-0002: PostgreSQL 作为数据权威源
 */

// @ts-nocheck — Refine v5 DataProvider 类型定义较宽泛，PostgREST 返回动态 JSON
import type { DataProvider } from '@refinedev/core';
import { apiDefinitionsDb } from './ichse-db';

export const ichseDbDataProvider: DataProvider = {
  getApiUrl: () => '',

  // ── 列表查询（从 DB 读，默认按 created_at 倒序）──
  getList: async ({ resource }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.list();
      return { data, total: data.length };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 单条查询（按 api_id）──
  getOne: async ({ resource, id }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.getByApiId(String(id));
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 创建（仅写 DB，不推送 Tyk）──
  create: async ({ resource, variables }) => {
    if (resource === 'api-records') {
      const apiId = variables.api_id || `api-${Date.now()}`;
      const record = {
        api_id: apiId,
        owner_id: 'ff212277-d32c-489a-b6c2-06f4f1e0925f', // system user UUID
        name: variables.name || apiId,
        listen_path: variables.proxy?.listen_path || '',
        target_url: variables.proxy?.target_url || '',
        auth_mode: variables.use_keyless ? 'keyless' : 'standard',
        status: 'active' as const,
        sync_status: 'pending' as const,
        definition: variables,
        version: 1,
        created_by: 'system',
        updated_by: 'system',
      };
      const data = await apiDefinitionsDb.create(record);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 更新（仅写 DB，sync_status='pending'）──
  update: async ({ resource, id, variables }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.update(String(id), {
        ...variables,
        sync_status: 'pending',
      } as any);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 删除（DB 永久删除）──
  deleteOne: async ({ resource, id }) => {
    if (resource === 'api-records') {
      await apiDefinitionsDb.delete(String(id));
      return { data: { id } };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 未实现 ──
  createMany: async () => { throw new Error('createMany not implemented'); },
  deleteMany: async () => { throw new Error('deleteMany not implemented'); },
  updateMany: async () => { throw new Error('updateMany not implemented'); },
  custom: async () => { throw new Error('custom not implemented'); },
} as any;
