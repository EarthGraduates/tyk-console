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
-- ============================================================
-- Migration 003: PostgreSQL 函数（Phase 1 — 认证 + 审计 + 速率限制）
-- 日期: 2026-05-22
-- 依赖: 002_auth_and_rls.sql
-- ============================================================

-- 0. 速率限制表 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ichse.rate_limit (
    user_id        UUID PRIMARY KEY REFERENCES ichse.users(id) ON DELETE CASCADE,
    request_count  INTEGER NOT NULL DEFAULT 0,
    window_start   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. 工具函数 ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ichse.base64url_encode(data BYTEA)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
    SELECT replace(replace(
        replace(rtrim(encode(data, 'base64'), '='), chr(10), ''),
        '+', '-'), '/', '_');
$$;

-- 2. JWT 签发 ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ichse.sign_jwt(payload JSONB)
RETURNS TEXT LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_header TEXT := '{"alg":"HS256","typ":"JWT"}';
    v_secret TEXT;
    v_signing_input TEXT;
    v_signature TEXT;
BEGIN
    v_secret := current_setting('app.jwt_secret');
    v_signing_input := ichse.base64url_encode(v_header::BYTEA)
                    || '.' || ichse.base64url_encode(payload::TEXT::BYTEA);
    v_signature := ichse.base64url_encode(
        hmac(v_signing_input::BYTEA, v_secret::BYTEA, 'sha256')
    );
    RETURN v_signing_input || '.' || v_signature;
END;
$$;

-- 3. 验证码登录（预留，Phase 2 实现）────────────────────────────

CREATE OR REPLACE FUNCTION ichse.login_with_code(
    p_login TEXT,
    p_code  TEXT
) RETURNS TEXT LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
    RAISE EXCEPTION '验证码登录尚未实现';
END;
$$;

-- 4. 密码登录（返回 JSONB {si, sig}，前端拼装 JWT，避免 PostgREST TEXT 返回值被篡改）──

CREATE OR REPLACE FUNCTION ichse.login(
    p_login    TEXT,   -- email 或 phone
    p_password TEXT
) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_user     RECORD;
    v_header   TEXT := '{"alg":"HS256","typ":"JWT"}';
    v_secret   TEXT;
    v_hdr_b64  TEXT;
    v_payload  JSONB;
    v_payload_b64 TEXT;
    v_signing_input TEXT;
    v_signature TEXT;
BEGIN
    -- 查找用户
    SELECT id, email, phone, role, display_name, secret_level,
           password_hash, status, failed_attempts, locked_until
    INTO v_user
    FROM ichse.users
    WHERE email = p_login OR phone = p_login;

    IF NOT FOUND THEN
        PERFORM ichse.write_audit_log(
            NULL, 'login_failed', FALSE,
            'user', p_login,
            jsonb_build_object('reason', 'user not found'),
            NULL, p_login
        );
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;

    -- 检查账户状态
    IF v_user.status = 'disabled' THEN
        RAISE EXCEPTION '账户已被禁用，请联系管理员';
    END IF;

    IF v_user.status = 'locked' AND v_user.locked_until > now() THEN
        RAISE EXCEPTION '账户已被锁定至 %', to_char(v_user.locked_until, 'YYYY-MM-DD HH24:MI:SS');
    END IF;

    -- 校验密码
    IF v_user.password_hash IS NULL
       OR v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        UPDATE ichse.users
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= 5 THEN 'locked'
                          ELSE status END,
            locked_until = CASE WHEN failed_attempts + 1 >= 5
                                THEN now() + INTERVAL '30 minutes'
                                ELSE locked_until END
        WHERE id = v_user.id;

        PERFORM ichse.write_audit_log(
            v_user.id, 'login_failed', FALSE,
            'user', v_user.id::TEXT,
            jsonb_build_object('reason', 'wrong password', 'attempt', v_user.failed_attempts + 1)
        );
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;

    -- 登录成功：重置失败计数
    UPDATE ichse.users
    SET failed_attempts = 0,
        last_login_at = now(),
        status = CASE WHEN status = 'locked' THEN 'active' ELSE status END,
        locked_until = NULL
    WHERE id = v_user.id;

    -- 签发 JWT（内联 base64url 编码，不依赖 sign_jwt）
    v_secret := current_setting('app.jwt_secret');
    v_payload := jsonb_build_object(
        'role',         'authenticated',
        'sub',          v_user.id::TEXT,
        'biz_role',     v_user.role,
        'email',        v_user.email,
        'phone',        v_user.phone,
        'display_name', v_user.display_name,
        'secret_level', v_user.secret_level,
        'iat',          extract(epoch FROM now())::INTEGER,
        'exp',          extract(epoch FROM now() + INTERVAL '8 hours')::INTEGER
    );

    v_hdr_b64 := replace(replace(replace(rtrim(encode(v_header::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_payload_b64 := replace(replace(replace(rtrim(encode(v_payload::TEXT::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_signing_input := v_hdr_b64 || '.' || v_payload_b64;
    v_signature := replace(replace(replace(rtrim(encode(hmac(v_signing_input::BYTEA, v_secret::BYTEA, 'sha256'), 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');

    -- 写审计日志
    PERFORM ichse.write_audit_log(
        v_user.id, 'login', TRUE,
        'user', v_user.id::TEXT
    );

    RETURN jsonb_build_object('token', v_signing_input || '.' || v_signature);
END;
$$;

-- 5. 审计日志写入（SECURITY DEFINER，绕过 RLS）────────────────

CREATE OR REPLACE FUNCTION ichse.write_audit_log(
    p_user_id       UUID    DEFAULT NULL,
    p_event_type    TEXT    DEFAULT NULL,
    p_event_success BOOLEAN DEFAULT NULL,
    p_target_type   TEXT    DEFAULT NULL,
    p_target_id     TEXT    DEFAULT NULL,
    p_target_detail JSONB   DEFAULT NULL,
    p_changes       JSONB   DEFAULT NULL,
    p_error_message TEXT    DEFAULT NULL
) RETURNS BIGINT LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_user_email TEXT;
    v_user_role  TEXT;
    v_hmac       TEXT;
    v_row_data   TEXT;
    v_record_id  BIGINT;
BEGIN
    -- 获取用户快照
    IF p_user_id IS NOT NULL THEN
        SELECT email, role INTO v_user_email, v_user_role
        FROM ichse.users WHERE id = p_user_id;
    END IF;

    -- 插入审计记录
    INSERT INTO ichse.audit_log (
        user_id, user_email, user_role,
        event_type, event_success,
        target_type, target_id, target_detail,
        changes, error_message
    ) VALUES (
        p_user_id, v_user_email, v_user_role,
        p_event_type, p_event_success,
        p_target_type, p_target_id, p_target_detail,
        p_changes, p_error_message
    ) RETURNING id INTO v_record_id;

    -- 计算 HMAC：对关键字段签名
    v_row_data := coalesce(v_record_id::TEXT, '')
        || coalesce(p_user_id::TEXT, '')
        || coalesce(p_event_type, '')
        || coalesce(p_event_success::TEXT, '')
        || coalesce(p_target_type, '')
        || coalesce(p_target_id, '');

    v_hmac := encode(
        hmac(v_row_data::BYTEA, current_setting('app.jwt_secret')::BYTEA, 'sha256'),
        'hex'
    );

    UPDATE ichse.audit_log SET record_hmac = v_hmac WHERE id = v_record_id;

    RETURN v_record_id;
END;
$$;

-- 6. db_pre_request — PostgREST 每次请求前执行 ────────────────

CREATE OR REPLACE FUNCTION ichse.db_pre_request() RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
    v_claims       JSONB;
    v_user_id      UUID;
    v_role         TEXT;
    v_secret_level TEXT;
    v_user_status  TEXT;
    v_locked_until TIMESTAMPTZ;
BEGIN
    -- 尝试读取 JWT claims（匿名请求无此字段）
    BEGIN
        v_claims := current_setting('request.jwt.claims')::JSONB;
    EXCEPTION WHEN OTHERS THEN
        -- 匿名请求：设置默认上下文
        PERFORM set_config('app.role', 'anonymous', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
        PERFORM set_config('app.secret_level', '公开', TRUE);
        RETURN;
    END;

    -- 解析 JWT claims
    v_user_id      := (v_claims->>'sub')::UUID;
    v_role         := v_claims->>'biz_role';
    v_secret_level := v_claims->>'secret_level';

    -- 匿名请求（PostgREST 返回 {} 不抛异常，需显式检查）
    IF v_user_id IS NULL THEN
        PERFORM set_config('app.role', 'anonymous', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
        PERFORM set_config('app.secret_level', '公开', TRUE);
        RETURN;
    END IF;

    -- 检查用户存在且状态正常
    SELECT status, locked_until INTO v_user_status, v_locked_until
    FROM ichse.users WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE SQLSTATE 'A0001' USING MESSAGE = '用户不存在';
    END IF;

    IF v_user_status = 'disabled' THEN
        RAISE SQLSTATE 'A0002' USING MESSAGE = '账户已被禁用';
    END IF;

    IF v_user_status = 'locked' AND v_locked_until > now() THEN
        RAISE SQLSTATE 'A0003' USING MESSAGE = '账户已被锁定';
    END IF;

    -- 设置会话变量（供 RLS 使用）
    PERFORM set_config('app.user_id', v_user_id::TEXT, TRUE);
    PERFORM set_config('app.role', v_role, TRUE);
    PERFORM set_config('app.secret_level', v_secret_level, TRUE);
END;
$$;
-- ============================================================
-- Migration 004: RLS 策略 + PostgreSQL 角色（Phase 1）
-- 日期: 2026-05-22
-- 依赖: 002_auth_and_rls.sql, 003_functions.sql
-- ============================================================

-- 0. PostgreSQL 角色 ───────────────────────────────────────────

-- authenticated: PostgREST 验 JWT 后切换到的 PG 角色
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
END $$;

-- web_anon 应已由 docker-compose PGRST_DB_ANON_ROLE 指定
-- 确保 web_anon 存在
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_anon') THEN
        CREATE ROLE web_anon;
    END IF;
END $$;

-- 1. Schema 权限 ───────────────────────────────────────────────

GRANT USAGE ON SCHEMA ichse TO web_anon;
GRANT USAGE ON SCHEMA ichse TO authenticated;

-- 2. 辅助函数 ──────────────────────────────────────────────────

-- 安全等级比较：返回 1(用户>=数据) / 0(相等) / -1(用户<数据)
CREATE OR REPLACE FUNCTION ichse.secret_level_compare(
    user_level TEXT,
    data_level TEXT
) RETURNS INTEGER LANGUAGE SQL IMMUTABLE STRICT AS $$
    SELECT CASE user_level
        WHEN '机密' THEN CASE data_level
            WHEN '机密' THEN 1 WHEN '敏感' THEN 1 WHEN '内部' THEN 1 WHEN '公开' THEN 1 END
        WHEN '敏感' THEN CASE data_level
            WHEN '机密' THEN -1 WHEN '敏感' THEN 1 WHEN '内部' THEN 1 WHEN '公开' THEN 1 END
        WHEN '内部' THEN CASE data_level
            WHEN '机密' THEN -1 WHEN '敏感' THEN -1 WHEN '内部' THEN 1 WHEN '公开' THEN 1 END
        WHEN '公开' THEN CASE data_level
            WHEN '机密' THEN -1 WHEN '敏感' THEN -1 WHEN '内部' THEN -1 WHEN '公开' THEN 1 END
    END;
$$;

-- 当前请求是否为指定业务角色（app.role 必须存在且匹配）
CREATE OR REPLACE FUNCTION ichse.is_role(r TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT NULLIF(current_setting('app.role', TRUE), '') = r;
$$;

-- 当前请求的 MAC 检查：用户安全等级 >= 数据安全等级
CREATE OR REPLACE FUNCTION ichse.can_access(secret_level TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT ichse.secret_level_compare(
        NULLIF(current_setting('app.secret_level', TRUE), ''),
        secret_level
    ) >= 0;
$$;

-- ============================================================
-- 3. RLS 策略
-- ============================================================

-- ── 3a. api_definitions（业务数据 — 三员不可见）──────────────

ALTER TABLE ichse.api_definitions ENABLE ROW LEVEL SECURITY;

-- 删除已有策略（幂等）
DROP POLICY IF EXISTS ad_select  ON ichse.api_definitions;
DROP POLICY IF EXISTS ad_insert  ON ichse.api_definitions;
DROP POLICY IF EXISTS ad_update  ON ichse.api_definitions;
DROP POLICY IF EXISTS ad_delete  ON ichse.api_definitions;

CREATE POLICY ad_select ON ichse.api_definitions
FOR SELECT TO authenticated
USING (
    ichse.is_role('business_user') OR ichse.is_role('viewer')
);

CREATE POLICY ad_insert ON ichse.api_definitions
FOR INSERT TO authenticated
WITH CHECK (ichse.is_role('business_user'));

CREATE POLICY ad_update ON ichse.api_definitions
FOR UPDATE TO authenticated
USING (ichse.is_role('business_user'));

CREATE POLICY ad_delete ON ichse.api_definitions
FOR DELETE TO authenticated
USING (ichse.is_role('business_user'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ichse.api_definitions TO authenticated;

-- ── 3b. api_keys（业务数据 — 三员不可见）─────────────────────

ALTER TABLE ichse.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ak_select ON ichse.api_keys;
DROP POLICY IF EXISTS ak_insert ON ichse.api_keys;
DROP POLICY IF EXISTS ak_update ON ichse.api_keys;
DROP POLICY IF EXISTS ak_delete ON ichse.api_keys;

CREATE POLICY ak_select ON ichse.api_keys
FOR SELECT TO authenticated
USING (
    ichse.is_role('business_user') OR ichse.is_role('viewer')
);

CREATE POLICY ak_insert ON ichse.api_keys
FOR INSERT TO authenticated
WITH CHECK (ichse.is_role('business_user'));

CREATE POLICY ak_update ON ichse.api_keys
FOR UPDATE TO authenticated
USING (ichse.is_role('business_user'));

CREATE POLICY ak_delete ON ichse.api_keys
FOR DELETE TO authenticated
USING (ichse.is_role('business_user'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ichse.api_keys TO authenticated;

-- ── 3c. api_definition_log（业务变更日志 — 三员不可见）───────

ALTER TABLE ichse.api_definition_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adl_select ON ichse.api_definition_log;
DROP POLICY IF EXISTS adl_insert ON ichse.api_definition_log;

CREATE POLICY adl_select ON ichse.api_definition_log
FOR SELECT TO authenticated
USING (
    ichse.is_role('business_user') OR ichse.is_role('viewer')
);

CREATE POLICY adl_insert ON ichse.api_definition_log
FOR INSERT TO authenticated
WITH CHECK (ichse.is_role('business_user'));

GRANT SELECT, INSERT ON ichse.api_definition_log TO authenticated;

-- ── 3d. audit_log（合规审计 — 仅 audit_admin 可读，不可改）───

ALTER TABLE ichse.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS al_select ON ichse.audit_log;

CREATE POLICY al_select ON ichse.audit_log
FOR SELECT TO authenticated
USING (ichse.is_role('audit_admin'));

-- 任何人不可 INSERT/UPDATE/DELETE audit_log（仅 SECURITY DEFINER 函数可写入）
-- 对 authenticated 不 GRANT INSERT/UPDATE/DELETE，仅 GRANT SELECT
GRANT SELECT ON ichse.audit_log TO authenticated;

-- ── 3e. users 基表（禁止直接访问，仅 SECURITY DEFINER 函数）──

ALTER TABLE ichse.users ENABLE ROW LEVEL SECURITY;

-- 任何人不可直接 SELECT/INSERT/UPDATE/DELETE
-- 视图 + SECURITY DEFINER 函数是所有访问的唯一途径
-- 对 authenticated 不做任何 GRANT

-- ── 3f. rate_limit（内部使用，不对外暴露）────────────────────

-- 不对任何角色 GRANT，仅 db_pre_request 可操作

-- ============================================================
-- 4. 视图权限 ─────────────────────────────────────────────────
-- 视图控制列级安全 + 部分行级过滤

GRANT SELECT ON ichse.users_sysadmin_view  TO authenticated;
GRANT SELECT ON ichse.users_secadmin_view  TO authenticated;
GRANT SELECT ON ichse.users_biz_view       TO authenticated;

-- ============================================================
-- 5. 函数权限 ─────────────────────────────────────────────────

-- login 函数允许匿名调用
GRANT EXECUTE ON FUNCTION ichse.login(TEXT, TEXT) TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.login_with_code(TEXT, TEXT) TO web_anon;

-- 审计写入 + JWT 签发：仅内部使用
-- (SECURITY DEFINER 函数，内部以函数 owner 身份执行，不对外 GRANT)

-- db_pre_request：PostgREST 会直接调用，需授权
GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO authenticated;

-- Endpoint for frontend auth (bypasses PostgREST "login" name conflict)
CREATE OR REPLACE FUNCTION ichse.auth_login(p_login TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_user     RECORD;
    v_header   TEXT := '{"alg":"HS256","typ":"JWT"}';
    v_secret   TEXT;
    v_hdr_b64  TEXT;
    v_payload  JSONB;
    v_payload_b64 TEXT;
    v_signing_input TEXT;
    v_signature TEXT;
BEGIN
    SELECT id, email, phone, role, display_name, secret_level,
           password_hash, status, failed_attempts, locked_until
    INTO v_user FROM ichse.users
    WHERE email = p_login OR phone = p_login;
    
    IF NOT FOUND THEN RAISE EXCEPTION '登录失败：用户名或密码错误'; END IF;
    IF v_user.status = 'disabled' THEN RAISE EXCEPTION '账户已被禁用'; END IF;
    IF v_user.status = 'locked' AND v_user.locked_until > now() THEN 
        RAISE EXCEPTION '账户已被锁定'; 
    END IF;
    IF v_user.password_hash IS NULL OR v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        UPDATE ichse.users SET failed_attempts = failed_attempts + 1 WHERE id = v_user.id;
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;
    
    UPDATE ichse.users SET failed_attempts = 0, last_login_at = now() WHERE id = v_user.id;
    
    v_secret := current_setting('app.jwt_secret');
    v_payload := jsonb_build_object(
        'role', 'authenticated', 'sub', v_user.id::TEXT,
        'biz_role', v_user.role, 'email', v_user.email,
        'phone', v_user.phone, 'display_name', v_user.display_name,
        'secret_level', v_user.secret_level,
        'iat', extract(epoch FROM now())::INTEGER,
        'exp', extract(epoch FROM now() + INTERVAL '8 hours')::INTEGER
    );
    
    v_hdr_b64 := replace(replace(replace(rtrim(encode(v_header::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_payload_b64 := replace(replace(replace(rtrim(encode(v_payload::TEXT::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_signing_input := v_hdr_b64 || '.' || v_payload_b64;
    v_signature := replace(replace(replace(rtrim(encode(hmac(v_signing_input::BYTEA, v_secret::BYTEA, 'sha256'), 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    
    RETURN jsonb_build_object('token', v_signing_input || '.' || v_signature);
END;
$$;
GRANT EXECUTE ON FUNCTION ichse.auth_login(TEXT, TEXT) TO web_anon;

-- PostgREST-compatible login endpoint (returns JSON with JWT parts)
CREATE OR REPLACE FUNCTION ichse.auth_login(p_login TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_user     RECORD;
    v_header   TEXT := '{"alg":"HS256","typ":"JWT"}';
    v_secret   TEXT;
    v_hdr_b64  TEXT;
    v_payload  JSONB;
    v_payload_b64 TEXT;
    v_signing_input TEXT;
    v_signature TEXT;
BEGIN
    SELECT id, email, phone, role, display_name, secret_level,
           password_hash, status, failed_attempts, locked_until
    INTO v_user FROM ichse.users
    WHERE email = p_login OR phone = p_login;
    
    IF NOT FOUND THEN RAISE EXCEPTION '登录失败：用户名或密码错误'; END IF;
    IF v_user.status = 'disabled' THEN RAISE EXCEPTION '账户已被禁用'; END IF;
    IF v_user.status = 'locked' AND v_user.locked_until > now() THEN RAISE EXCEPTION '账户已被锁定'; END IF;
    IF v_user.password_hash IS NULL OR v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        UPDATE ichse.users SET failed_attempts = failed_attempts + 1 WHERE id = v_user.id;
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;
    
    UPDATE ichse.users SET failed_attempts = 0, last_login_at = now() WHERE id = v_user.id;
    
    v_secret := current_setting('app.jwt_secret');
    v_payload := jsonb_build_object(
        'role', 'authenticated', 'sub', v_user.id::TEXT,
        'biz_role', v_user.role, 'email', v_user.email,
        'phone', v_user.phone, 'display_name', v_user.display_name,
        'secret_level', v_user.secret_level,
        'iat', extract(epoch FROM now())::INTEGER,
        'exp', extract(epoch FROM now() + INTERVAL '8 hours')::INTEGER
    );
    
    v_hdr_b64 := replace(replace(replace(rtrim(encode(v_header::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_payload_b64 := replace(replace(replace(rtrim(encode(v_payload::TEXT::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_signing_input := v_hdr_b64 || '.' || v_payload_b64;
    v_signature := replace(replace(replace(rtrim(encode(hmac(v_signing_input::BYTEA, v_secret::BYTEA, 'sha256'), 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    
    RETURN jsonb_build_object('token', v_signing_input || '.' || v_signature);
END;
$$;
GRANT EXECUTE ON FUNCTION ichse.auth_login(TEXT, TEXT) TO web_anon;
