/**
 * Tyk Gateway 自定义 Refine Data Provider
 *
 * @description
 * 实现 Refine DataProvider 接口，通过 Tyk Gateway REST API 完成 CRUD 操作。
 * 支持 apis（API定义）和 keys（API密钥）两种资源。
 * 特色：可暂停自动 reload 策略，避免批量操作时重复中断 Tyk 服务。
 *
 * ## 双数据源架构
 * - Tyk API（直连，x-tyk-authorization 认证）：apis CRUD、keys CRUD、健康检查、重载
 * - Docker 管理服务（:3001 轻量桥接）：容器启停（由 GatewayPage 独立调用）
 *
 * ## 配置存储
 * - Gateway URL + Secret 默认从 localStorage 读取，设置页可覆盖
 * - 未配置时 Secret 默认使用 'foo'（docker-compose 内的 dev 环境值）
 *
 * ## Reload 策略
 * - 默认「自动 reload」：每次 CRUD 后自动调 /tyk/reload/
 * - 用户可切换「暂停 reload」：操作后仅标记 pending，顶部 banner 提示手动批量触发
 * - 仪表板展示 reload 次数和距上次 reload 时间
 *
 * @module tyk-data-provider
 * @see {@link https://tyk.io/docs/tyk-gateway-api/ Tyk Gateway API 文档}
 */

// @ts-nocheck — Tyk API 返回动态 JSON，Refine DataProvider 接口类型注解较宽泛
import type { DataProvider } from '@refinedev/core';
import {
  apiDefinitionsDb,
  apiDefinitionLogDb,
  apiKeysDb,
  usersDb,
} from './ichse-db';

// ─────────────────── 本地存储 Key 定义 ───────────────────

/** localStorage key：Tyk Gateway 监听地址 */
const STORAGE_KEY_GATEWAY = 'tyk_gateway_url';

/** localStorage key：Tyk API Secret（管理 API 认证头） */
const STORAGE_KEY_SECRET = 'tyk_secret';

/** localStorage key：是否启用自动 reload */
const STORAGE_KEY_AUTO_RELOAD = 'tyk_auto_reload';

// ─────────────────── 配置读取 ───────────────────

/**
 * 获取 Tyk Gateway 地址
 * @returns 配置的地址，默认空字符串（走 Vite proxy 相对路径）
 */
export function getGatewayUrl(): string {
  return localStorage.getItem(STORAGE_KEY_GATEWAY) || '';
}

/**
 * 获取 API Secret
 * @returns 配置的 Secret，默认 'foo'（dev 环境 docker-compose 内置值）
 */
export function getSecret(): string {
  return localStorage.getItem(STORAGE_KEY_SECRET) || 'foo';
}

/**
 * 构建 Tyk 管理 API 的认证请求头
 */
function authHeaders(): Record<string, string> {
  const secret = getSecret();
  if (!secret) return {};
  return { 'x-tyk-authorization': secret };
}

// ─────────────────── Reload 策略控制 ───────────────────

/**
 * 是否启用自动 reload（延迟初始化，避免模块顶层依赖 localStorage）
 */
let autoReload: boolean | null = null;

/** 待生效的更改计数（暂停 reload 模式时递增） */
let pendingChanges = 0;

/**
 * 初始化自动 reload 开关状态（首次调用时从 localStorage 读取）
 */
function initAutoReload(): boolean {
  if (autoReload === null) {
    autoReload = localStorage.getItem(STORAGE_KEY_AUTO_RELOAD) !== 'false';
  }
  return autoReload;
}

/** 待生效更改数变化时的 UI 回调列表 */
const changeListeners: Array<(count: number) => void> = [];

/** reload 完成时的 UI 回调列表 */
const reloadListeners: Array<(count: number, time: string) => void> = [];

/** 累计 reload 次数（兼容 node 环境避免直接依赖 localStorage） */
let reloadCount = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('tyk_reload_count') || 0 : 0);

/**
 * 设置自动 reload 开关
 * @param enabled - true 启用自动 reload，false 暂停
 */
export function setAutoReload(enabled: boolean) {
  autoReload = enabled;
  localStorage.setItem(STORAGE_KEY_AUTO_RELOAD, String(enabled));
}

/** @returns 当前是否启用自动 reload */
export function isAutoReload(): boolean {
  return initAutoReload();
}

/** @returns 当前待生效的更改数量 */
export function getPendingChanges(): number {
  return pendingChanges;
}

/** @returns 累计 reload 次数 */
export function getReloadCount(): number {
  return reloadCount;
}

/** 注册待生效更改的 UI 回调 */
export function onPendingChange(fn: (count: number) => void) {
  changeListeners.push(fn);
}

/** 注册 reload 完成的 UI 回调 */
export function onReload(fn: (count: number, time: string) => void) {
  reloadListeners.push(fn);
}

/** 通知所有 pendingChange 监听器 */
function notifyPendingChange() {
  changeListeners.forEach((fn) => fn(pendingChanges));
}

/** 通知所有 reload 监听器 */
function notifyReload() {
  const time = new Date().toLocaleTimeString();
  reloadListeners.forEach((fn) => fn(reloadCount, time));
}

/**
 * 调用 Tyk Gateway 的 /tyk/reload/ 端点，使所有更改生效
 * - 成功后清空 pendingChanges，reloadCount +1，持久化计数器
 * - 失败时 pending changes 保持不变，等待下次重试
 */
async function reloadGateway(): Promise<void> {
  try {
    await fetch(`${getGatewayUrl()}/tyk/reload/`, { headers: authHeaders() });
    pendingChanges = 0;
    reloadCount++;
    localStorage.setItem('tyk_reload_count', String(reloadCount));
    localStorage.setItem('tyk_reload_time', new Date().toLocaleTimeString());
    notifyPendingChange();
    notifyReload();
  } catch {
    // reload 网络失败 — 保留 pending 状态，不重置计数器
  }
}

/**
 * CRUD 变更后的统一处理
 * - 自动 reload 模式：立即调 reloadGateway
 * - 暂停模式：pendingChanges +1，通知 UI
 */
async function afterMutation(): Promise<void> {
  if (initAutoReload()) {
    await reloadGateway();
  } else {
    pendingChanges++;
    notifyPendingChange();
  }
}

// ─────────────────── 通用请求封装 ───────────────────

/**
 * Tyk Gateway API 通用请求封装
 *
 * @param resource - API 路径片段（如 'apis/'、'keys/xxx'）
 * @param init - fetch 配置（method、body 等）
 * @returns 解析后的 JSON，空响应返回 null
 * @throws {Error} HTTP 非 2xx 时抛出含状态码和响应体的错误
 */
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

// ─────────────────── Data Provider 实现 ───────────────────

/**
 * DB 双写辅助：创建 API 定义记录
 * 失败不影响 Tyk 主流程（记 console.warn）
 */
async function dbCreateApi(apiId: string, definition: Record<string, unknown>, createdBy?: string) {
  try {
    const systemId = await usersDb.getSystemUserId();
    const ownerId = createdBy || systemId || '00000000-0000-0000-0000-000000000000';
    await apiDefinitionsDb.create({
      api_id: apiId,
      owner_id: ownerId,
      name: (definition as any).name || apiId,
      listen_path: (definition as any).proxy?.listen_path || '',
      target_url: (definition as any).proxy?.target_url || '',
      auth_mode: (definition as any).use_keyless ? 'keyless' : 'standard',
      status: 'active',
      sync_status: 'synced',
      definition,
      version: 1,
      created_by: createdBy,
      updated_by: createdBy,
    });
    await apiDefinitionLogDb.insert({
      api_id: apiId,
      definition,
      version: 1,
      change_type: 'create',
      change_summary: `创建 API: ${(definition as any).name || apiId}`,
      updated_by: createdBy,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[ichse-db] api create log failed:', e.message);
  }
}

/** DB 双写辅助：更新 API */
async function dbUpdateApi(apiId: string, definition: Record<string, unknown>, updatedBy?: string) {
  try {
    const existing = await apiDefinitionsDb.getByApiId(apiId);
    if (!existing) return;
    const newVersion = existing.version + 1;
    await apiDefinitionsDb.update(apiId, {
      definition,
      version: newVersion,
      updated_by: updatedBy,
      name: (definition as any).name || existing.name,
      listen_path: (definition as any).proxy?.listen_path || existing.listen_path,
      target_url: (definition as any).proxy?.target_url || existing.target_url,
      auth_mode: (definition as any).use_keyless ? 'keyless' : 'standard',
    });
    await apiDefinitionLogDb.insert({
      api_id: apiId,
      definition,
      version: newVersion,
      change_type: 'update',
      change_summary: `更新 API: ${(definition as any).name || apiId}`,
      updated_by: updatedBy,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[ichse-db] api update log failed:', e.message);
  }
}

/** DB 双写辅助：删除 API（标记为 inactive） */
async function dbDeleteApi(apiId: string, updatedBy?: string) {
  try {
    const existing = await apiDefinitionsDb.getByApiId(apiId);
    if (!existing) return;
    await apiDefinitionsDb.update(apiId, { status: 'inactive', updated_by: updatedBy });
    await apiDefinitionLogDb.insert({
      api_id: apiId,
      definition: existing.definition,
      version: existing.version,
      change_type: 'status_change',
      change_summary: '停用 API（从 Tyk 删除）',
      updated_by: updatedBy,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[ichse-db] api delete log failed:', e.message);
  }
}

/** DB 双写辅助：创建密钥 */
async function dbCreateKey(keyId: string, apiId: string, keyData: any) {
  try {
    await apiKeysDb.create({
      key_id: keyId,
      api_id: apiId,
      key_value: keyData.key || undefined,
      access_rights: keyData.access_rights || {},
      rate: keyData.rate,
      per: keyData.per,
      quota_max: keyData.quota_max,
      expires_at: keyData.expires ? new Date(keyData.expires * 1000).toISOString() : undefined,
      status: 'active',
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[ichse-db] key create log failed:', e.message);
  }
}

/** DB 双写辅助：吊销密钥 */
async function dbRevokeKey(keyId: string) {
  try {
    await apiKeysDb.revoke(keyId);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[ichse-db] key revoke log failed:', e.message);
  }
}

/**
 * Tyk Gateway 专用 Refine DataProvider
 *
 * ## 资源映射
 * - apis：对应 Tyk API Definitions（/tyk/apis/）
 * - keys：对应 Tyk API Keys（/tyk/keys/）
 *
 * ## 设计约束
 * - Tyk 不是标准 REST API（创建返回 key 而非完整对象，列表返回 ID 数组）
 * - keys 列表需要逐条查询详情（Tyk 列表接口不返回元数据）
 * - create/update/deleteOne 后自动触发 afterMutation（reload 策略）
 */
export const tykDataProvider: DataProvider = {
  getApiUrl: () => getGatewayUrl(),

  // ── 列表查询 ──

  getList: async ({ resource }) => {
    if (resource === 'apis') {
      // Tyk 直接返回 API 定义数组
      const data = (await tykFetch('apis/')) || [];
      return { data: Array.isArray(data) ? data : [], total: data.length };
    }
    if (resource === 'keys') {
      try {
        // 1) 取 key_id 列表
        const raw = (await tykFetch('keys/')) || {};
        const keyIds = raw.keys || [];
        // 2) 逐条查询详情（Tyk 列表不返回配额/速率/过期等元数据）
        const keys = await Promise.all(keyIds.map(async (kid: string) => {
          try {
            const detail = await tykFetch(`keys/${kid}`);
            return { key_id: kid, ...detail };
          } catch {
            return { key_id: kid };
          }
        }));
        return { data: keys, total: keys.length };
      } catch (e: any) {
        // Tyk OSS 默认禁止密钥列表 — 优雅降级为空列表
        // eslint-disable-next-line no-console
        console.warn('Key listing unavailable:', e.message);
        return { data: [], total: 0 };
      }
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 单条查询 ──
  getOne: async ({ resource, id }) => {
    if (resource === 'apis') {
      const data = await tykFetch(`apis/${id}`);
      return { data };
    }
    if (resource === 'keys') {
      const data = await tykFetch(`keys/${id}`);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 创建（自动 reload） ──
  create: async ({ resource, variables }) => {
    if (resource === 'apis') {
      const data = await tykFetch('apis/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      // 双写：DB 记录
      const apiId = data?.api_id || variables?.api_id || data?.key;
      if (apiId) dbCreateApi(apiId, variables as Record<string, unknown>);
      return { data };
    }
    if (resource === 'keys') {
      const data = await tykFetch('keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      // 双写：DB 记录
      const keyId = data?.key_id || data?.key_hash;
      const apiId = variables?.access_rights ? Object.keys(variables.access_rights)[0] : '';
      if (keyId) dbCreateKey(keyId, apiId, data);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 更新（自动 reload） ──
  update: async ({ resource, id, variables }) => {
    if (resource === 'apis') {
      const data = await tykFetch(`apis/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      // 双写：DB 记录
      dbUpdateApi(id, variables as Record<string, unknown>);
      return { data };
    }
    if (resource === 'keys') {
      const data = await tykFetch(`keys/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      });
      await afterMutation();
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 删除（自动 reload） ──
  deleteOne: async ({ resource, id }) => {
    if (resource === 'apis') {
      await tykFetch(`apis/${id}`, { method: 'DELETE' });
      await afterMutation();
      // 双写：DB 标记为 inactive
      dbDeleteApi(id);
      return { data: { id } };
    }
    if (resource === 'keys') {
      // Tyk 删除密钥需指定 api_id 参数（传空表示全局删除）
      await tykFetch(`keys/${id}?api_id=`, { method: 'DELETE' });
      await afterMutation();
      // 双写：DB 标记吊销
      dbRevokeKey(id);
      return { data: { id } };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // ── 未实现的批量/自定义操作（v2 规划） ──
  createMany: async () => { throw new Error('createMany not implemented'); },
  deleteMany: async () => { throw new Error('deleteMany not implemented'); },
  updateMany: async () => { throw new Error('updateMany not implemented'); },
  custom: async () => { throw new Error('custom not implemented'); },
} as any;
