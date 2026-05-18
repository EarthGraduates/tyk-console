# Tyk API 接口清单 & 管理数据库设计（修订版 v1.4）

> 日期：2026-05-18 | 项目：ichse-asset-share-center v1
> 数据库：Supabase (PostgreSQL)，后期可平滑迁移到自建 PostgreSQL
> Schema：`ichse`（与项目名一致）
> 合规：阿里 PostgreSQL 开发规范

---

## 一、Tyk Gateway API 接口清单（不变）

### API Definitions

| 方法 | 端点 | 用途 |
|------|------|------|
| `GET` | `/tyk/apis/` | 获取所有 API 定义列表 |
| `GET` | `/tyk/apis/{id}` | 获取单个 API 完整定义 |
| `POST` | `/tyk/apis/` | 创建新 API 定义 |
| `PUT` | `/tyk/apis/{id}` | 更新 API 定义 |
| `DELETE` | `/tyk/apis/{id}` | 删除 API 定义 |

### API Keys

| 方法 | 端点 | 用途 |
|------|------|------|
| `GET` | `/tyk/keys/` | 获取所有 key_id 列表 |
| `GET` | `/tyk/keys/{id}` | 获取单个 key 详情 |
| `POST` | `/tyk/keys/create` | 创建新密钥 |
| `PUT` | `/tyk/keys/{id}` | 更新密钥 |
| `DELETE` | `/tyk/keys/{id}?api_id=` | 吊销密钥 |

### Gateway 运维

| 方法 | 端点 | 用途 |
|------|------|------|
| `GET` | `/hello` | 网关健康检查 |
| `GET` | `/tyk/health/?api_id={id}` | API 运行指标 |
| `GET` | `/tyk/reload/` | 热重载 |

---

## 二、数据库设计

### 2.1 ER 图

```
ichse.users ──(owner_id)──> ichse.api_definitions ──(api_id)──> ichse.api_definition_log
                                  │
                                  └──(api_id)──> ichse.api_keys
```

### 2.2 DDL

```sql
-- ============================================================
-- Schema
-- ============================================================
CREATE SCHEMA IF NOT EXISTS ichse;
COMMENT ON SCHEMA ichse IS 'ichse-asset-share-center 管理数据库';
SET search_path TO ichse;

-- ============================================================
-- 表 1：users — 业务用户
-- ============================================================
CREATE TABLE users (
  id            UUID DEFAULT gen_random_uuid(),
  email         TEXT,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CONSTRAINT ck_users_role CHECK (role IN ('admin', 'user', 'viewer')),
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  auth_user_id  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_auth_user_id UNIQUE (auth_user_id)
);

COMMENT ON TABLE users IS '业务用户表，存储系统用户和普通用户，与 Supabase auth.users 分离';
COMMENT ON COLUMN users.id IS '主键，UUID';
COMMENT ON COLUMN users.email IS '邮箱，system/public 等系统用户可为空';
COMMENT ON COLUMN users.display_name IS '显示名称，必填';
COMMENT ON COLUMN users.role IS '角色：admin（管理员）、user（普通用户）、viewer（只读）';
COMMENT ON COLUMN users.is_system IS '是否系统内置用户（system、public），系统用户不可删除、不可修改角色';
COMMENT ON COLUMN users.auth_user_id IS '映射到 Supabase auth.users(id)，非登录用户为 NULL';
COMMENT ON COLUMN users.created_at IS '创建时间';

-- 预置系统用户
INSERT INTO users (display_name, role, is_system) VALUES
  ('system', 'admin', TRUE),
  ('public', 'user',  TRUE);

-- ============================================================
-- 表 2：api_definitions — API 定义主表
-- ============================================================
CREATE TABLE api_definitions (
  id            UUID DEFAULT gen_random_uuid(),
  api_id        TEXT NOT NULL,
  owner_id      UUID NOT NULL,
  name          TEXT NOT NULL,
  listen_path   TEXT,
  target_url    TEXT,
  auth_mode     TEXT NOT NULL DEFAULT 'standard'
                CONSTRAINT ck_ad_auth_mode CHECK (auth_mode IN ('keyless', 'standard', 'jwt', 'oauth')),
  status        TEXT NOT NULL DEFAULT 'active'
                CONSTRAINT ck_ad_status CHECK (status IN ('active', 'inactive', 'archived')),
  sync_status   TEXT NOT NULL DEFAULT 'synced'
                CONSTRAINT ck_ad_sync_status CHECK (sync_status IN ('synced', 'pending', 'failed')),
  last_sync_at  TIMESTAMPTZ,
  sync_error    TEXT,
  definition    JSONB NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_by    TEXT,

  CONSTRAINT pk_api_definitions PRIMARY KEY (id),
  CONSTRAINT uq_ad_api_id UNIQUE (api_id),
  CONSTRAINT fk_ad_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
);

COMMENT ON TABLE api_definitions IS 'API 定义主表，存储 Tyk API 的完整配置，独立于 Tyk Redis 生命周期';
COMMENT ON COLUMN api_definitions.id IS '主键，UUID';
COMMENT ON COLUMN api_definitions.api_id IS 'Tyk Gateway 中的 API 标识符，唯一';
COMMENT ON COLUMN api_definitions.owner_id IS 'API 归属的业务用户 ID，外键引用 users(id)，必填';
COMMENT ON COLUMN api_definitions.name IS 'API 名称，人类可读';
COMMENT ON COLUMN api_definitions.listen_path IS 'Tyk 代理监听路径，如 /tyk-api-test/';
COMMENT ON COLUMN api_definitions.target_url IS '上游目标地址，如 http://httpbin.org';
COMMENT ON COLUMN api_definitions.auth_mode IS '认证模式：keyless（无认证）、standard（标准密钥）、jwt、oauth';
COMMENT ON COLUMN api_definitions.status IS '自管状态：active（已推送到 Tyk 并路由）、inactive（从 Tyk 移除但 DB 保留配置）、archived（已归档）';
COMMENT ON COLUMN api_definitions.sync_status IS 'DB 与 Tyk 的同步状态：synced（一致）、pending（待同步）、failed（同步失败）';
COMMENT ON COLUMN api_definitions.last_sync_at IS '最后一次成功同步到 Tyk 的时间';
COMMENT ON COLUMN api_definitions.sync_error IS '最近一次同步失败的错误信息';
COMMENT ON COLUMN api_definitions.definition IS '完整的 Tyk API Definition JSON，包含所有配置字段';
COMMENT ON COLUMN api_definitions.version IS '配置版本号，每次更新递增';
COMMENT ON COLUMN api_definitions.created_at IS '创建时间';
COMMENT ON COLUMN api_definitions.updated_at IS '最后更新时间';
COMMENT ON COLUMN api_definitions.created_by IS '创建者标识';
COMMENT ON COLUMN api_definitions.updated_by IS '最后更新者标识';

CREATE INDEX idx_ad_status ON api_definitions(status);
CREATE INDEX idx_ad_sync_status ON api_definitions(sync_status);
CREATE INDEX idx_ad_owner_id ON api_definitions(owner_id);
CREATE INDEX idx_ad_created_at ON api_definitions(created_at);

-- ============================================================
-- 表 3：api_definition_log — 配置变更日志
-- ============================================================
CREATE TABLE api_definition_log (
  id            UUID DEFAULT gen_random_uuid(),
  api_id        TEXT NOT NULL,
  definition    JSONB NOT NULL,
  version       INTEGER NOT NULL,
  change_type   TEXT NOT NULL
                CONSTRAINT ck_adl_change_type CHECK (change_type IN ('create', 'update', 'delete', 'status_change', 'rollback')),
  change_summary TEXT,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_api_definition_log PRIMARY KEY (id)
);

COMMENT ON TABLE api_definition_log IS 'API 配置变更日志，记录每次创建、修改、删除、状态变更、回滚的快照';
COMMENT ON COLUMN api_definition_log.id IS '主键，UUID';
COMMENT ON COLUMN api_definition_log.api_id IS '关联的 api_definitions.api_id';
COMMENT ON COLUMN api_definition_log.definition IS '变更时的完整 API Definition JSON 快照';
COMMENT ON COLUMN api_definition_log.version IS '快照版本号，等于当时 api_definitions.version 的值';
COMMENT ON COLUMN api_definition_log.change_type IS '变更类型：create（创建）、update（修改）、delete（删除）、status_change（状态变更）、rollback（版本回滚）';
COMMENT ON COLUMN api_definition_log.change_summary IS '人类可读的变更摘要，如"修改 target_url: A → B"';
COMMENT ON COLUMN api_definition_log.updated_by IS '变更操作者标识';
COMMENT ON COLUMN api_definition_log.updated_at IS '变更时间';

CREATE INDEX idx_adl_api_id ON api_definition_log(api_id);
CREATE INDEX idx_adl_api_version ON api_definition_log(api_id, version);
CREATE INDEX idx_adl_updated_at ON api_definition_log(updated_at);

-- ============================================================
-- 表 4：api_keys — 密钥管理
-- ============================================================
CREATE TABLE api_keys (
  id            UUID DEFAULT gen_random_uuid(),
  key_id        TEXT NOT NULL,
  api_id        TEXT NOT NULL,
  key_value     TEXT,
  access_rights JSONB,
  rate          INTEGER,
  per           INTEGER,
  quota_max     INTEGER,
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active'
                CONSTRAINT ck_ak_status CHECK (status IN ('active', 'revoked', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,

  CONSTRAINT pk_api_keys PRIMARY KEY (id),
  CONSTRAINT uq_ak_key_id UNIQUE (key_id)
);

COMMENT ON TABLE api_keys IS 'API 密钥管理表，存储 Tyk API Key 的元数据';
COMMENT ON COLUMN api_keys.id IS '主键，UUID';
COMMENT ON COLUMN api_keys.key_id IS 'Tyk 生成的 key_id（哈希值），唯一';
COMMENT ON COLUMN api_keys.api_id IS '关联的 api_definitions.api_id，密钥归属的 API';
COMMENT ON COLUMN api_keys.key_value IS '密钥原始值，Tyk 仅在创建时返回一次；开发阶段明文存储，正式上线前必须改为加密存储';
COMMENT ON COLUMN api_keys.access_rights IS '密钥授权的 API 及版本信息，JSON 格式';
COMMENT ON COLUMN api_keys.rate IS '速率限制：每秒允许的请求数，NULL 或 0 表示不限制';
COMMENT ON COLUMN api_keys.per IS '速率计算的时间窗口（秒），默认 1 秒';
COMMENT ON COLUMN api_keys.quota_max IS '密钥生命周期内允许的总请求数，-1 表示无限制';
COMMENT ON COLUMN api_keys.expires_at IS '密钥过期时间，NULL 表示永不过期';
COMMENT ON COLUMN api_keys.status IS '密钥状态：active（有效）、revoked（已吊销）、expired（已过期）';
COMMENT ON COLUMN api_keys.created_at IS '创建时间';
COMMENT ON COLUMN api_keys.updated_at IS '最后更新时间（包括吊销操作）';
COMMENT ON COLUMN api_keys.revoked_at IS '吊销时间，NULL 表示未被吊销';

CREATE INDEX idx_ak_api_id ON api_keys(api_id);
CREATE INDEX idx_ak_status ON api_keys(status);
CREATE INDEX idx_ak_expires_at ON api_keys(expires_at);
```

### 2.3 字段说明

#### `owner_id` — 权限基础

| owner | 场景 |
|-------|------|
| `system` | 系统自动创建的 API |
| `public` | 公开 API，无需登录 |
| 具体用户 | 某开发者/团队拥有，后续权限：只能管理自己的 API |

#### FK ON DELETE 策略

| FK | 策略 | 原因 |
|----|------|------|
| `api_definitions.owner_id → users.id` | `RESTRICT` | 有 API 的 user 禁止删除，防止孤儿数据 |
| `api_keys.api_id → api_definitions.api_id` | 暂不加 CASCADE | 密钥可独立吊销，API 删除由应用层处理 |

#### 时间字段统一

| 表 | 创建时间 | 更新时间 | 特殊时间 |
|----|---------|---------|---------|
| `users` | `created_at` | — | — |
| `api_definitions` | `created_at` | `updated_at` | `last_sync_at` |
| `api_definition_log` | — | `updated_at` | — |
| `api_keys` | `created_at` | `updated_at` | `revoked_at`（吊销时刻） |

#### 索引命名（阿里规范）

| 前缀 | 含义 |
|------|------|
| `pk_` | 主键（Primary Key） |
| `uq_` | 唯一索引（Unique Key） |
| `idx_` | 普通索引（Index） |
| `ck_` | CHECK 约束（Check） |
| `fk_` | 外键约束（Foreign Key，PG 自动生成） |

### 2.4 阿里规范合规清单

| 规范 | 状态 |
|------|:--:|
| 【强制】对象名只使用小写字母、下划线、数字 | ✅ |
| 【强制】不以 pg 开头、不以数字开头 | ✅ |
| 【强制】FK 手动建索引 | ✅ |
| 【强制】FK 设置 ON DELETE action | ✅ |
| 【推荐】主键索引 pk_ 开头 | ✅ |
| 【推荐】唯一索引 uk_ → uq_ 开头 | ✅ |
| 【推荐】普通索引 idx_ 开头 | ✅ |
| 【推荐】不为每个应用用 public schema | ✅ `ichse` schema |
| 【推荐】表名长度 ≤ 63 | ✅ |
| 【推荐】多表相同列名、类型一致 | ✅ `created_at`/`updated_at` 统一 |

### 2.5 版本修订记录

| 版本 | 变更 |
|------|------|
| v1.0 | 初稿：3 表设计 + SQLite |
| v1.1 | +索引 + CHECK + sync_status + 加密存储 + PostgreSQL |
| v1.2 | +users 表 + owner_id 必填 + 密钥开发阶段明文 |
| v1.3 | +ichse schema + FK ON DELETE + 索引命名规范 + 时间字段统一 + 阿里规范合规 |
| v1.4 | +所有字段中文 COMMENT + CONSTRAINT 独立声明（去重） |
