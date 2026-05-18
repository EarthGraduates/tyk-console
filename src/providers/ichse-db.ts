/**
 * ichse 管理数据库服务层（SQLite 浏览器端）
 *
 * @description
 * 使用 sql.js（SQLite 编译为 WASM）在浏览器内运行，
 * 数据持久化到 localStorage。零网络依赖、零安装。
 *
 * 后期迁移 PostgreSQL 只需换实现，接口不变。
 *
 * @module providers/ichse-db
 */

// @ts-nocheck — sql.js 类型定义较宽泛
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

// ── 数据库初始化 ──

const DB_STORAGE_KEY = 'ichse_db_v1';

let db: Database | null = null;
let SQL: SqlJsStatic | null = null;

/** 初始化 SQLite（加载 WASM + 建表 + 恢复数据） */
async function initDb(): Promise<Database> {
  if (db) return db;

  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });

  // 尝试从 localStorage 恢复
  const saved = localStorage.getItem(DB_STORAGE_KEY);
  if (saved) {
    try {
      const arr = Uint8Array.from(JSON.parse(saved));
      db = new SQL.Database(arr);
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // 建表（幂等）
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')),
      is_system INTEGER NOT NULL DEFAULT 0,
      auth_user_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_definitions (
      id TEXT PRIMARY KEY,
      api_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      listen_path TEXT,
      target_url TEXT,
      auth_mode TEXT NOT NULL DEFAULT 'standard' CHECK(auth_mode IN ('keyless','standard','jwt','oauth')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('synced','pending','failed')),
      last_sync_at TEXT,
      sync_error TEXT,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_definition_log (
      id TEXT PRIMARY KEY,
      api_id TEXT NOT NULL,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL,
      change_type TEXT NOT NULL CHECK(change_type IN ('create','update','delete','status_change','rollback')),
      change_summary TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_id TEXT NOT NULL UNIQUE,
      api_id TEXT NOT NULL,
      key_value TEXT,
      access_rights TEXT,
      rate INTEGER,
      per INTEGER,
      quota_max INTEGER,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    )
  `);

  // 索引
  db.run('CREATE INDEX IF NOT EXISTS idx_ad_status ON api_definitions(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ad_owner_id ON api_definitions(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_adl_api_id ON api_definition_log(api_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ak_api_id ON api_keys(api_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ak_status ON api_keys(status)');

  // 预置系统用户
  db.run(`
    INSERT OR IGNORE INTO users (id, display_name, role, is_system)
    VALUES ('system', 'system', 'admin', 1)
  `);
  db.run(`
    INSERT OR IGNORE INTO users (id, display_name, role, is_system)
    VALUES ('public', 'public', 'user', 1)
  `);

  return db;
}

/** 持久化到 localStorage */
function persist() {
  if (!db) return;
  const arr = Array.from(db.export());
  localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(arr));
}

/** 生成 UUID v4（简易实现） */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 行对象 → 展开 JSON 字段 */
function expandJson(row: any, ...jsonFields: string[]): any {
  if (!row) return row;
  const result = { ...row };
  for (const f of jsonFields) {
    if (result[f] && typeof result[f] === 'string') {
      try { result[f] = JSON.parse(result[f]); } catch { /* keep string */ }
    }
  }
  return result;
}

/** 对象 → 压缩 JSON 字段 */
function packJson(obj: any, ...jsonFields: string[]): any {
  const result = { ...obj };
  for (const f of jsonFields) {
    if (result[f] !== undefined && typeof result[f] !== 'string') {
      result[f] = JSON.stringify(result[f]);
    }
  }
  return result;
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

// ── 通用查询辅助 ──

async function queryAll(sql: string, params?: any[]): Promise<any[]> {
  const d = await initDb();
  const stmt = d.prepare(sql);
  if (params) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function queryOne(sql: string, params?: any[]): Promise<any | null> {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function exec(sql: string, params?: any[]): Promise<void> {
  const d = await initDb();
  d.run(sql, params);
  persist();
}

// ── api_definitions CRUD ──

export const apiDefinitionsDb = {
  async list(status?: string) {
    let sql = 'SELECT * FROM api_definitions ORDER BY created_at DESC';
    if (status) sql = 'SELECT * FROM api_definitions WHERE status = ? ORDER BY created_at DESC';
    const rows = await queryAll(sql, status ? [status] : undefined);
    return rows.map((r) => expandJson(r, 'definition')) as ApiDefinition[];
  },

  async getByApiId(apiId: string) {
    const row = await queryOne('SELECT * FROM api_definitions WHERE api_id = ?', [apiId]);
    return expandJson(row, 'definition') as ApiDefinition | null;
  },

  async create(record: Omit<ApiDefinition, 'id' | 'created_at' | 'updated_at'>) {
    const packed = packJson(record, 'definition', 'access_rights');
    const id = uuid();
    const now = new Date().toISOString();
    await exec(
      `INSERT INTO api_definitions (id, api_id, owner_id, name, listen_path, target_url, auth_mode, status, sync_status, definition, version, created_at, updated_at, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, packed.api_id, packed.owner_id, packed.name, packed.listen_path || '', packed.target_url || '',
        packed.auth_mode, packed.status, packed.sync_status || 'synced',
        packed.definition, packed.version || 1, now, now, packed.created_by || '', packed.updated_by || ''],
    );
    return (await apiDefinitionsDb.getByApiId(record.api_id))!;
  },

  async update(apiId: string, updates: Partial<ApiDefinition>) {
    const existing = await apiDefinitionsDb.getByApiId(apiId);
    if (!existing) throw new Error(`API not found: ${apiId}`);
    const packed = packJson(updates, 'definition', 'access_rights');
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(packed)) {
      if (v !== undefined && k !== 'api_id' && k !== 'id') {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(apiId);
    await exec(`UPDATE api_definitions SET ${sets.join(', ')} WHERE api_id = ?`, vals);
    return (await apiDefinitionsDb.getByApiId(apiId))!;
  },

  async delete(apiId: string) {
    await exec('DELETE FROM api_definitions WHERE api_id = ?', [apiId]);
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
    const packed = packJson(log, 'definition');
    const id = uuid();
    await exec(
      `INSERT INTO api_definition_log (id, api_id, definition, version, change_type, change_summary, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, packed.api_id, packed.definition, packed.version, packed.change_type,
        packed.change_summary || '', packed.updated_by || '', new Date().toISOString()],
    );
    const result: ApiDefinitionLog = { id, ...log, updated_at: new Date().toISOString() };
    return result;
  },

  async listByApiId(apiId: string, limit = 20) {
    const rows = await queryAll(
      'SELECT * FROM api_definition_log WHERE api_id = ? ORDER BY updated_at DESC LIMIT ?',
      [apiId, limit],
    );
    return rows.map((r) => expandJson(r, 'definition')) as ApiDefinitionLog[];
  },
};

// ── api_keys ──

export const apiKeysDb = {
  async list() {
    const rows = await queryAll('SELECT * FROM api_keys ORDER BY created_at DESC');
    return rows.map((r) => expandJson(r, 'access_rights')) as ApiKey[];
  },

  async getByKeyId(keyId: string) {
    const row = await queryOne('SELECT * FROM api_keys WHERE key_id = ?', [keyId]);
    return expandJson(row, 'access_rights') as ApiKey | null;
  },

  async create(record: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>) {
    const packed = packJson(record, 'access_rights');
    const id = uuid();
    const now = new Date().toISOString();
    await exec(
      `INSERT INTO api_keys (id, key_id, api_id, key_value, access_rights, rate, per, quota_max, expires_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, packed.key_id, packed.api_id, packed.key_value || '', packed.access_rights || '{}',
        packed.rate ?? null, packed.per ?? null, packed.quota_max ?? null,
        packed.expires_at || null, packed.status, now, now],
    );
    return (await apiKeysDb.getByKeyId(record.key_id))!;
  },

  async revoke(keyId: string) {
    const now = new Date().toISOString();
    await exec(
      'UPDATE api_keys SET status = ?, revoked_at = ?, updated_at = ? WHERE key_id = ?',
      ['revoked', now, now, keyId],
    );
    return apiKeysDb.getByKeyId(keyId);
  },
};

// ── users ──

export const usersDb = {
  async ensureUser(authUserId: string, email: string) {
    const existing = await queryOne('SELECT * FROM users WHERE auth_user_id = ?', [authUserId]);
    if (existing) return existing;

    const id = uuid();
    await exec(
      'INSERT INTO users (id, auth_user_id, email, display_name, role) VALUES (?,?,?,?,?)',
      [id, authUserId, email, email, 'user'],
    );
    return queryOne('SELECT * FROM users WHERE id = ?', [id]);
  },

  async getSystemUserId() {
    const row = await queryOne("SELECT id FROM users WHERE display_name = 'system'");
    return row?.id || null;
  },
};
