/**
 * API 生命周期管理 — Tyk Gateway 与 PostgreSQL 的协同操作
 *
 * @description
 * 封装跨 Tyk（运行时引擎）和 PostgreSQL（数据权威源）的复合操作。
 * 停用/启用/同步都需要同时操作两个 seam（Tyk API + PostgREST），
 * 此模块集中管理，避免页面组件混入双源逻辑。
 *
 * @module providers/api-lifecycle
 * @see ADR-0002: PostgreSQL 作为数据权威源
 * @see CONTEXT.md: 停用/重新启用/同步 术语定义
 */

import { tykFetch } from './tyk-data-provider';
import { apiDefinitionsDb, apiKeysDb } from './ichse-db';

// ── 类型 ──

export interface LifecycleResult {
  success: boolean;
  error?: string;
}

// ── 共用：Tyk 热重载 ──

export async function reloadTyk(): Promise<LifecycleResult> {
  try {
    await tykFetch('reload/', { method: 'GET' });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: `reload 失败: ${e.message}` };
  }
}

// ── 停用：Tyk DELETE + DB inactive + reload ──

export async function deactivateApi(record: {
  api_id: string;
  name: string;
}): Promise<LifecycleResult> {
  // 1. Tyk DELETE（失败不阻断——API 可能已不存在）
  try {
    await tykFetch(`apis/${record.api_id}`, { method: 'DELETE' });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[api-lifecycle] Tyk DELETE ${record.api_id} failed:`, e.message);
  }

  // 2. DB 标记 inactive + synced
  try {
    await apiDefinitionsDb.update(record.api_id, {
      status: 'inactive',
      sync_status: 'synced',
    });
  } catch (e: any) {
    return { success: false, error: `DB 更新失败: ${e.message}` };
  }

  // 3. Tyk 热重载
  return reloadTyk();
}

// ── 重新启用：Tyk POST + DB active + reload ──

export async function reactivateApi(record: {
  api_id: string;
  name: string;
  definition: any;
}): Promise<LifecycleResult> {
  let def = record.definition;
  if (typeof def === 'string') def = JSON.parse(def);
  def = { ...def, api_id: record.api_id, active: true };

  // 1. Tyk POST
  try {
    await tykFetch('apis/', { method: 'POST', body: JSON.stringify(def) });
  } catch (e: any) {
    return { success: false, error: `Tyk 推送失败: ${e.message}` };
  }

  // 2. DB 标记 active + synced
  try {
    await apiDefinitionsDb.update(record.api_id, {
      status: 'active',
      sync_status: 'synced',
    });
  } catch (e: any) {
    return { success: false, error: `DB 更新失败: ${e.message}` };
  }

  // 3. Tyk 热重载
  return reloadTyk();
}

// ── 手动同步：Tyk POST/PUT + DB markSynced/Failed + reload ──

export async function syncApiToTyk(record: {
  api_id: string;
  name: string;
  definition: any;
}): Promise<LifecycleResult> {
  let def = record.definition;
  if (typeof def === 'string') def = JSON.parse(def);
  def = { ...def, api_id: record.api_id, active: true };

  // 1. 判断 Tyk 中是否已存在 → POST 或 PUT
  try {
    let exists = false;
    try {
      await tykFetch(`apis/${record.api_id}`);
      exists = true;
    } catch {
      /* 不存在则 POST */
    }

    if (exists) {
      await tykFetch(`apis/${record.api_id}`, {
        method: 'PUT',
        body: JSON.stringify(def),
      });
    } else {
      await tykFetch('apis/', {
        method: 'POST',
        body: JSON.stringify(def),
      });
    }
  } catch (e: any) {
    await apiDefinitionsDb.markSyncFailed(record.api_id, e.message);
    return { success: false, error: `Tyk 同步失败: ${e.message}` };
  }

  // 2. DB 标记 synced
  try {
    await apiDefinitionsDb.markSynced(record.api_id);
  } catch (e: any) {
    return { success: false, error: `DB 标记失败: ${e.message}` };
  }

  // 3. Tyk 热重载
  return reloadTyk();
}

// ── 删除：清理密钥 + Tyk DELETE + DB DELETE + reload ──
// @see ADR-0003: 删除 API 时清理关联密钥

export async function deleteApiWithKeyCleanup(record: {
  api_id: string;
  name: string;
}): Promise<LifecycleResult> {
  const apiId = record.api_id;

  // 1. 获取所有密钥，清理关联此 API 的密钥
  try {
    const keyList = await tykFetch('keys/');
    const keyIds: string[] = keyList?.keys || keyList || [];

    for (const keyId of keyIds) {
      try {
        const keyDetail = await tykFetch(`keys/${keyId}`);
        const rights = keyDetail?.access_rights || {};
        const boundApiIds = Object.keys(rights);

        if (!boundApiIds.includes(apiId)) continue;

        if (boundApiIds.length === 1) {
          // 独占密钥 → DELETE Tyk + DB revoke
          await tykFetch(`keys/${keyId}?api_id=${apiId}`, { method: 'DELETE' });
          try { await apiKeysDb.revoke(keyId); } catch { /* DB 清理失败不阻断 */ }
        } else {
          // 共享密钥 → PUT 移除目标 API
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rights)) {
            if (k !== apiId) cleaned[k] = v;
          }
          await tykFetch(`keys/${keyId}`, {
            method: 'PUT',
            body: JSON.stringify({ ...keyDetail, access_rights: cleaned }),
          });
        }
      } catch {
        // 单个 key 处理失败不阻断整体流程
      }
    }
  } catch (e: any) {
    return { success: false, error: `密钥清理失败: ${e.message}` };
  }

  // 2. Tyk DELETE API
  try {
    await tykFetch(`apis/${apiId}`, { method: 'DELETE' });
  } catch {
    // API 可能已不存在——继续
  }

  // 3. DB DELETE
  try {
    await apiDefinitionsDb.delete(apiId);
  } catch (e: any) {
    return { success: false, error: `DB 删除失败: ${e.message}` };
  }

  // 4. Tyk 热重载
  return reloadTyk();
}
