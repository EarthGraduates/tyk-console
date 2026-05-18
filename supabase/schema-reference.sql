-- ============================================================
-- ichse-asset-share-center Schema v1.0
-- 日期: 2026-05-18 | 版本: V1.1
-- 数据库: PostgreSQL 17 (Docker)
-- Schema: ichse
-- 合规: 阿里 PostgreSQL 开发规范
-- 表: users, api_definitions, api_definition_log, api_keys
-- ============================================================
-- ============================================================

CREATE SCHEMA IF NOT EXISTS ichse;
COMMENT ON SCHEMA ichse IS 'ichse-asset-share-center 管理数据库';

-- ============================================================
-- 表 1：users — 业务用户
-- ============================================================
CREATE TABLE IF NOT EXISTS ichse.users (
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

COMMENT ON TABLE ichse.users IS '业务用户表，存储系统用户和普通用户，与 Supabase auth.users 分离';
COMMENT ON COLUMN ichse.users.id IS '主键，UUID';
COMMENT ON COLUMN ichse.users.email IS '邮箱，system/public 等系统用户可为空';
COMMENT ON COLUMN ichse.users.display_name IS '显示名称，必填';
COMMENT ON COLUMN ichse.users.role IS '角色：admin（管理员）、user（普通用户）、viewer（只读）';
COMMENT ON COLUMN ichse.users.is_system IS '是否系统内置用户（system、public），系统用户不可删除、不可修改角色';
COMMENT ON COLUMN ichse.users.auth_user_id IS '映射到 Supabase auth.users(id)，非登录用户为 NULL';
COMMENT ON COLUMN ichse.users.created_at IS '创建时间';

-- 预置系统用户（幂等）
INSERT INTO ichse.users (display_name, role, is_system) VALUES
  ('system', 'admin', TRUE),
  ('public', 'user',  TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 表 2：api_definitions — API 定义主表
-- ============================================================
CREATE TABLE IF NOT EXISTS ichse.api_definitions (
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
  CONSTRAINT fk_ad_owner FOREIGN KEY (owner_id) REFERENCES ichse.users(id) ON DELETE RESTRICT
);

COMMENT ON TABLE ichse.api_definitions IS 'API 定义主表，存储 Tyk API 的完整配置，独立于 Tyk Redis 生命周期';
COMMENT ON COLUMN ichse.api_definitions.id IS '主键，UUID';
COMMENT ON COLUMN ichse.api_definitions.api_id IS 'Tyk Gateway 中的 API 标识符，唯一';
COMMENT ON COLUMN ichse.api_definitions.owner_id IS 'API 归属的业务用户 ID，外键引用 users(id)，必填';
COMMENT ON COLUMN ichse.api_definitions.name IS 'API 名称，人类可读';
COMMENT ON COLUMN ichse.api_definitions.listen_path IS 'Tyk 代理监听路径，如 /tyk-api-test/';
COMMENT ON COLUMN ichse.api_definitions.target_url IS '上游目标地址，如 http://httpbin.org';
COMMENT ON COLUMN ichse.api_definitions.auth_mode IS '认证模式：keyless（无认证）、standard（标准密钥）、jwt、oauth';
COMMENT ON COLUMN ichse.api_definitions.status IS '自管状态：active（已推送到 Tyk 并路由）、inactive（从 Tyk 移除但 DB 保留配置）、archived（已归档）';
COMMENT ON COLUMN ichse.api_definitions.sync_status IS 'DB 与 Tyk 的同步状态：synced（一致）、pending（待同步）、failed（同步失败）';
COMMENT ON COLUMN ichse.api_definitions.last_sync_at IS '最后一次成功同步到 Tyk 的时间';
COMMENT ON COLUMN ichse.api_definitions.sync_error IS '最近一次同步失败的错误信息';
COMMENT ON COLUMN ichse.api_definitions.definition IS '完整的 Tyk API Definition JSON，包含所有配置字段';
COMMENT ON COLUMN ichse.api_definitions.version IS '配置版本号，每次更新递增';
COMMENT ON COLUMN ichse.api_definitions.created_at IS '创建时间';
COMMENT ON COLUMN ichse.api_definitions.updated_at IS '最后更新时间';
COMMENT ON COLUMN ichse.api_definitions.created_by IS '创建者标识';
COMMENT ON COLUMN ichse.api_definitions.updated_by IS '最后更新者标识';

CREATE INDEX IF NOT EXISTS idx_ad_status ON ichse.api_definitions(status);
CREATE INDEX IF NOT EXISTS idx_ad_sync_status ON ichse.api_definitions(sync_status);
CREATE INDEX IF NOT EXISTS idx_ad_owner_id ON ichse.api_definitions(owner_id);
CREATE INDEX IF NOT EXISTS idx_ad_created_at ON ichse.api_definitions(created_at);

-- ============================================================
-- 表 3：api_definition_log — 配置变更日志
-- ============================================================
CREATE TABLE IF NOT EXISTS ichse.api_definition_log (
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

COMMENT ON TABLE ichse.api_definition_log IS 'API 配置变更日志，记录每次创建、修改、删除、状态变更、回滚的快照';
COMMENT ON COLUMN ichse.api_definition_log.id IS '主键，UUID';
COMMENT ON COLUMN ichse.api_definition_log.api_id IS '关联的 api_definitions.api_id';
COMMENT ON COLUMN ichse.api_definition_log.definition IS '变更时的完整 API Definition JSON 快照';
COMMENT ON COLUMN ichse.api_definition_log.version IS '快照版本号，等于当时 api_definitions.version 的值';
COMMENT ON COLUMN ichse.api_definition_log.change_type IS '变更类型：create（创建）、update（修改）、delete（删除）、status_change（状态变更）、rollback（版本回滚）';
COMMENT ON COLUMN ichse.api_definition_log.change_summary IS '人类可读的变更摘要，如"修改 target_url: A → B"';
COMMENT ON COLUMN ichse.api_definition_log.updated_by IS '变更操作者标识';
COMMENT ON COLUMN ichse.api_definition_log.updated_at IS '变更时间';

CREATE INDEX IF NOT EXISTS idx_adl_api_id ON ichse.api_definition_log(api_id);
CREATE INDEX IF NOT EXISTS idx_adl_api_version ON ichse.api_definition_log(api_id, version);
CREATE INDEX IF NOT EXISTS idx_adl_updated_at ON ichse.api_definition_log(updated_at);

-- ============================================================
-- 表 4：api_keys — 密钥管理
-- ============================================================
CREATE TABLE IF NOT EXISTS ichse.api_keys (
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

COMMENT ON TABLE ichse.api_keys IS 'API 密钥管理表，存储 Tyk API Key 的元数据';
COMMENT ON COLUMN ichse.api_keys.id IS '主键，UUID';
COMMENT ON COLUMN ichse.api_keys.key_id IS 'Tyk 生成的 key_id（哈希值），唯一';
COMMENT ON COLUMN ichse.api_keys.api_id IS '关联的 api_definitions.api_id，密钥归属的 API';
COMMENT ON COLUMN ichse.api_keys.key_value IS '密钥原始值，Tyk 仅在创建时返回一次；开发阶段明文存储，正式上线前必须改为加密存储';
COMMENT ON COLUMN ichse.api_keys.access_rights IS '密钥授权的 API 及版本信息，JSON 格式';
COMMENT ON COLUMN ichse.api_keys.rate IS '速率限制：每秒允许的请求数，NULL 或 0 表示不限制';
COMMENT ON COLUMN ichse.api_keys.per IS '速率计算的时间窗口（秒），默认 1 秒';
COMMENT ON COLUMN ichse.api_keys.quota_max IS '密钥生命周期内允许的总请求数，-1 表示无限制';
COMMENT ON COLUMN ichse.api_keys.expires_at IS '密钥过期时间，NULL 表示永不过期';
COMMENT ON COLUMN ichse.api_keys.status IS '密钥状态：active（有效）、revoked（已吊销）、expired（已过期）';
COMMENT ON COLUMN ichse.api_keys.created_at IS '创建时间';
COMMENT ON COLUMN ichse.api_keys.updated_at IS '最后更新时间（包括吊销操作）';
COMMENT ON COLUMN ichse.api_keys.revoked_at IS '吊销时间，NULL 表示未被吊销';

CREATE INDEX IF NOT EXISTS idx_ak_api_id ON ichse.api_keys(api_id);
CREATE INDEX IF NOT EXISTS idx_ak_status ON ichse.api_keys(status);
CREATE INDEX IF NOT EXISTS idx_ak_expires_at ON ichse.api_keys(expires_at);
