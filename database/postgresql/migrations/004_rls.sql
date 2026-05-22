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
