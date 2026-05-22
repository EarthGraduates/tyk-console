-- ============================================================
-- Migration 002: 用户权限与安全审计（Phase 1 — Schema 变更）
-- 日期: 2026-05-22
-- 数据库: PostgreSQL 17 (Docker)
-- Schema: ichse
-- 合规: 等保 2.0 三级 (GB/T 22239-2019)
-- ============================================================

-- 1. 扩展 ─────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. users 表改造 ─────────────────────────────────────────────

-- 2a. 删旧约束（auth_user_id 唯一的约束也要删）
ALTER TABLE ichse.users DROP CONSTRAINT IF EXISTS uq_users_auth_user_id;
ALTER TABLE ichse.users DROP CONSTRAINT IF EXISTS ck_users_role;

-- 2b. 删旧字段
ALTER TABLE ichse.users DROP COLUMN IF EXISTS auth_user_id;

-- 2c. 新增字段（先可空，填完数据再加 NOT NULL）
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS phone              TEXT;
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS password_hash       TEXT;
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active';
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS secret_level        TEXT NOT NULL DEFAULT '内部';
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS last_login_at       TIMESTAMPTZ;
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS failed_attempts     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ichse.users ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ;

-- 2d. 迁移现有角色值
-- system(is_system, admin) → business_user（默认 API 归属）
-- public(is_system, user)  → viewer
UPDATE ichse.users SET role = 'business_user' WHERE display_name = 'system' AND is_system;
UPDATE ichse.users SET role = 'viewer'        WHERE display_name = 'public'  AND is_system;

-- 2e. 重建唯一约束（email 唯一在原始 schema 已存在，先删再建保证幂等）
-- 系统用户 email 为 NULL，不参与唯一约束
ALTER TABLE ichse.users DROP CONSTRAINT IF EXISTS uq_users_email;
ALTER TABLE ichse.users ADD CONSTRAINT uq_users_email UNIQUE (email);
ALTER TABLE ichse.users ADD CONSTRAINT uq_users_phone UNIQUE (phone);

-- 2f. 新约束
ALTER TABLE ichse.users ADD CONSTRAINT ck_users_role CHECK (
    role IN ('system_admin', 'security_admin', 'audit_admin', 'business_user', 'viewer')
);
ALTER TABLE ichse.users ADD CONSTRAINT ck_users_status CHECK (
    status IN ('active', 'disabled', 'locked')
);
ALTER TABLE ichse.users ADD CONSTRAINT ck_users_secret_level CHECK (
    secret_level IN ('公开', '内部', '敏感', '机密')
);

-- 注释
COMMENT ON COLUMN ichse.users.phone IS '手机号，支持短信验证码登录，唯一';
COMMENT ON COLUMN ichse.users.password_hash IS 'bcrypt 哈希，pgcrypto crypt(password, gen_salt(''bf''))';
COMMENT ON COLUMN ichse.users.status IS '账户状态：active（正常）、disabled（禁用）、locked（锁定）';
COMMENT ON COLUMN ichse.users.secret_level IS '用户安全标记（等保 8.1.4.2g）：公开/内部/敏感/机密';
COMMENT ON COLUMN ichse.users.last_login_at IS '最近一次成功登录时间';
COMMENT ON COLUMN ichse.users.password_changed_at IS '最近一次修改密码时间，用于强制定期改密';
COMMENT ON COLUMN ichse.users.failed_attempts IS '连续登录失败次数';
COMMENT ON COLUMN ichse.users.locked_until IS '锁定到期时间，NULL 表示未锁定';

-- 2g. 开发环境种子：各角色测试账号（密码统一：Test1234!）
-- 生产部署前必须删除或修改这些账号
INSERT INTO ichse.users (email, phone, display_name, role, secret_level, password_hash, is_system)
VALUES
    ('dev_admin@ichse.local',    '13800000001', 'Dev系统管理员', 'system_admin',   '机密', crypt('Test1234!', gen_salt('bf')), FALSE),
    ('dev_sec@ichse.local',      '13800000002', 'Dev安全管理员', 'security_admin', '机密', crypt('Test1234!', gen_salt('bf')), FALSE),
    ('dev_audit@ichse.local',    '13800000003', 'Dev审计管理员', 'audit_admin',    '机密', crypt('Test1234!', gen_salt('bf')), FALSE),
    ('dev_biz@ichse.local',      '13800000004', 'Dev业务用户',   'business_user',  '内部', crypt('Test1234!', gen_salt('bf')), FALSE),
    ('dev_viewer@ichse.local',   '13800000005', 'Dev只读用户',   'viewer',         '内部', crypt('Test1234!', gen_salt('bf')), FALSE)
ON CONFLICT (email) DO NOTHING;

-- 3. api_definitions 加安全标记 ────────────────────────────────

ALTER TABLE ichse.api_definitions ADD COLUMN IF NOT EXISTS secret_level TEXT NOT NULL DEFAULT '内部';
ALTER TABLE ichse.api_definitions ADD CONSTRAINT ck_ad_secret_level CHECK (
    secret_level IN ('公开', '内部', '敏感', '机密')
);
COMMENT ON COLUMN ichse.api_definitions.secret_level IS '数据安全标记（等保 8.1.4.2g）：公开/内部/敏感/机密';

-- 4. api_keys 加安全标记 ──────────────────────────────────────

ALTER TABLE ichse.api_keys ADD COLUMN IF NOT EXISTS secret_level TEXT NOT NULL DEFAULT '内部';
ALTER TABLE ichse.api_keys ADD CONSTRAINT ck_ak_secret_level CHECK (
    secret_level IN ('公开', '内部', '敏感', '机密')
);
COMMENT ON COLUMN ichse.api_keys.secret_level IS '数据安全标记（等保 8.1.4.2g）：公开/内部/敏感/机密';

-- 5. 审计日志表（append-only）─────────────────────────────────

CREATE TABLE IF NOT EXISTS ichse.audit_log (
    id              BIGSERIAL PRIMARY KEY,
    event_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID,
    user_email      TEXT,
    user_role       TEXT,
    event_type      TEXT NOT NULL,
    event_success   BOOLEAN NOT NULL,
    target_type     TEXT,
    target_id       TEXT,
    target_detail   JSONB,
    changes         JSONB,
    client_ip       TEXT,
    user_agent      TEXT,
    error_message   TEXT,
    record_hmac     TEXT
);

COMMENT ON TABLE ichse.audit_log IS '安全审计日志（等保 8.1.4.3），append-only，不可修改/删除，留存 ≥ 6 年';
COMMENT ON COLUMN ichse.audit_log.event_time IS '事件发生时间';
COMMENT ON COLUMN ichse.audit_log.user_id IS '操作者用户 ID';
COMMENT ON COLUMN ichse.audit_log.user_email IS '操作者邮箱（冗余，方便查询）';
COMMENT ON COLUMN ichse.audit_log.user_role IS '操作时的角色快照';
COMMENT ON COLUMN ichse.audit_log.event_type IS '事件类型：login/logout/login_failed/password_change/user_create/user_disable/user_enable/user_delete/user_role_change/permission_change/role_config_change/api_create/api_update/api_delete/api_sync/api_status_change/key_create/key_revoke/key_expire/config_change/gateway_restart/gateway_stop/audit_view/audit_export';
COMMENT ON COLUMN ichse.audit_log.event_success IS '操作是否成功';
COMMENT ON COLUMN ichse.audit_log.target_type IS '操作对象类型：user/api_definition/api_key/config/gateway';
COMMENT ON COLUMN ichse.audit_log.target_id IS '操作对象标识';
COMMENT ON COLUMN ichse.audit_log.target_detail IS '操作对象描述（名称等，可含脱敏业务信息）';
COMMENT ON COLUMN ichse.audit_log.changes IS '变更内容（before/after diff，JSONB）';
COMMENT ON COLUMN ichse.audit_log.client_ip IS '客户端 IP 地址';
COMMENT ON COLUMN ichse.audit_log.user_agent IS '客户端 User-Agent';
COMMENT ON COLUMN ichse.audit_log.error_message IS '操作失败时的错误信息';
COMMENT ON COLUMN ichse.audit_log.record_hmac IS '本行数据的 HMAC-SHA256 校验值，防篡改';

CREATE INDEX IF NOT EXISTS idx_audit_log_time   ON ichse.audit_log (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user   ON ichse.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_type   ON ichse.audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON ichse.audit_log (target_type, target_id);

-- 6. 列级安全视图 ──────────────────────────────────────────────

-- system_admin 视图：可见账号状态、登录信息，不可见密码哈希、业务角色
CREATE OR REPLACE VIEW ichse.users_sysadmin_view AS
SELECT id, email, phone, display_name, is_system,
       status, last_login_at, failed_attempts, locked_until,
       password_changed_at, created_at
FROM ichse.users;

-- security_admin 视图：可见角色、安全标记，不可见密码哈希、登录信息
CREATE OR REPLACE VIEW ichse.users_secadmin_view AS
SELECT id, email, phone, display_name, is_system,
       role, secret_level, status, created_at
FROM ichse.users;

-- business_user 视图：业务用户只能看到自己的基本信息和同组织的业务用户
-- 不可见密码哈希、三员的用户
CREATE OR REPLACE VIEW ichse.users_biz_view AS
SELECT id, email, phone, display_name, is_system, status, created_at
FROM ichse.users
WHERE role IN ('business_user', 'viewer');
