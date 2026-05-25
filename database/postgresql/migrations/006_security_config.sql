-- 006_security_config.sql
-- Phase 3 P0: 安全配置持久化到 PostgreSQL
-- 将 localStorage 中的安全策略迁移到 security_config 表，DB 函数从表读取

-- ============================================================================
-- 1. security_config 表
-- ============================================================================

CREATE TABLE IF NOT EXISTS ichse.security_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

COMMENT ON TABLE  ichse.security_config IS '安全策略配置（等保三级）';
COMMENT ON COLUMN ichse.security_config.key IS '配置键';
COMMENT ON COLUMN ichse.security_config.value IS '配置值（统一用 TEXT 存储，消费端做类型转换）';
COMMENT ON COLUMN ichse.security_config.updated_by IS '最后修改者 UUID（存文本，避免 FK 触发 RLS 权限问题）';

-- ============================================================================
-- 2. 种子默认值
-- ============================================================================

INSERT INTO ichse.security_config (key, value) VALUES
  ('password_min_length',       '8'),
  ('password_require_upper',    'true'),
  ('password_require_digit',    'true'),
  ('password_require_special',  'false'),
  ('lockout_threshold',         '5'),
  ('lockout_duration_minutes',  '30'),
  ('session_timeout_hours',     '8'),
  ('rate_limit_per_minute',     '100')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. get_config() — SECURITY DEFINER，所有函数内部调用
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.get_config(p_key TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
  SELECT value FROM ichse.security_config WHERE key = p_key;
$$;

GRANT EXECUTE ON FUNCTION ichse.get_config(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION ichse.get_config(TEXT) TO web_anon;

-- ============================================================================
-- 4. set_security_config() — SECURITY DEFINER，仅 security_admin
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.set_security_config(p_config JSONB)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id   UUID;
  v_kv          RECORD;
  v_count       INTEGER := 0;
BEGIN
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'biz_role';
  v_caller_id   := current_setting('request.jwt.claims', true)::jsonb->>'sub';

  IF v_caller_role != 'security_admin' THEN
    RAISE EXCEPTION '权限不足：仅安全管理员可修改安全配置';
  END IF;

  FOR v_kv IN SELECT * FROM jsonb_each_text(p_config)
  LOOP
    -- 白名单校验：只允许已知的 key
    IF v_kv.key IN (
      'password_min_length', 'password_require_upper', 'password_require_digit',
      'password_require_special', 'lockout_threshold', 'lockout_duration_minutes',
      'session_timeout_hours', 'rate_limit_per_minute'
    ) THEN
      INSERT INTO ichse.security_config (key, value, updated_at, updated_by)
      VALUES (v_kv.key, v_kv.value, now(), v_caller_id)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.set_security_config(JSONB) TO authenticated;

-- ============================================================================
-- 5. RLS + 权限
-- ============================================================================

ALTER TABLE ichse.security_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sc_select ON ichse.security_config;
CREATE POLICY sc_select ON ichse.security_config
FOR SELECT TO authenticated
USING (true);

-- 任何人不可直接 INSERT/UPDATE/DELETE（仅 SECURITY DEFINER 函数可写入）
GRANT SELECT ON ichse.security_config TO authenticated;

-- ============================================================================
-- 6. 更新 login() — 从 security_config 读取阈值
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.login(p_login TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
    v_user      RECORD;
    v_secret    TEXT;
    v_header    JSONB;
    v_payload   JSONB;
    v_hdr_b64   TEXT;
    v_payload_b64 TEXT;
    v_signing_input TEXT;
    v_signature TEXT;
    v_lockout_threshold    INTEGER;
    v_lockout_duration_min INTEGER;
    v_session_timeout_hours INTEGER;
BEGIN
    -- 读取安全配置（带默认降级）
    v_lockout_threshold     := COALESCE(ichse.get_config('lockout_threshold')::INTEGER, 5);
    v_lockout_duration_min  := COALESCE(ichse.get_config('lockout_duration_minutes')::INTEGER, 30);
    v_session_timeout_hours := COALESCE(ichse.get_config('session_timeout_hours')::INTEGER, 8);

    SELECT * INTO v_user FROM ichse.users
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

    IF v_user.status = 'disabled' THEN
        RAISE EXCEPTION '账户已被禁用，请联系管理员';
    END IF;

    IF v_user.status = 'locked' AND v_user.locked_until > now() THEN
        RAISE EXCEPTION '账户已被锁定至 %', to_char(v_user.locked_until, 'YYYY-MM-DD HH24:MI:SS');
    END IF;

    IF v_user.password_hash IS NULL
       OR v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        UPDATE ichse.users
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= v_lockout_threshold THEN 'locked'
                          ELSE status END,
            locked_until = CASE WHEN failed_attempts + 1 >= v_lockout_threshold
                                THEN now() + (v_lockout_duration_min || ' minutes')::INTERVAL
                                ELSE locked_until END
        WHERE id = v_user.id;

        PERFORM ichse.write_audit_log(
            v_user.id, 'login_failed', FALSE,
            'user', v_user.id::TEXT,
            jsonb_build_object('reason', 'wrong password', 'attempt', v_user.failed_attempts + 1)
        );
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;

    UPDATE ichse.users
    SET failed_attempts = 0,
        last_login_at = now(),
        status = CASE WHEN status = 'locked' THEN 'active' ELSE status END,
        locked_until = NULL
    WHERE id = v_user.id;

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
        'exp',          extract(epoch FROM now() + (v_session_timeout_hours || ' hours')::INTERVAL)::INTEGER
    );

    v_header := jsonb_build_object('alg', 'HS256', 'typ', 'JWT');
    v_hdr_b64 := replace(replace(replace(rtrim(encode(v_header::TEXT::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_payload_b64 := replace(replace(replace(rtrim(encode(v_payload::TEXT::BYTEA, 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');
    v_signing_input := v_hdr_b64 || '.' || v_payload_b64;
    v_signature := replace(replace(replace(rtrim(encode(hmac(v_signing_input::BYTEA, v_secret::BYTEA, 'sha256'), 'base64'), '='), chr(10), ''), '+', '-'), '/', '_');

    PERFORM ichse.write_audit_log(
        v_user.id, 'login', TRUE,
        'user', v_user.id::TEXT
    );

    RETURN jsonb_build_object('token', v_signing_input || '.' || v_signature);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.login(TEXT, TEXT) TO web_anon;

-- ============================================================================
-- 7. 更新 db_pre_request() — 仅做认证状态检查，速率限制单独实现
-- ============================================================================

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
    v_claims := current_setting('request.jwt.claims', true)::JSONB;
    v_user_id := v_claims->>'sub';
    v_role    := v_claims->>'biz_role';
    v_secret_level := v_claims->>'secret_level';

    IF v_user_id IS NULL THEN
        PERFORM set_config('app.role', 'anonymous', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
        PERFORM set_config('app.secret_level', '公开', TRUE);
        RETURN;
    END IF;

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

    PERFORM set_config('app.user_id', v_user_id::TEXT, TRUE);
    PERFORM set_config('app.role', v_role, TRUE);
    PERFORM set_config('app.secret_level', v_secret_level, TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO authenticated;

-- ============================================================================
-- 8. 更新 manage_user() — 增加密码复杂度校验
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.manage_user(
  p_action        TEXT,
  p_user_id       UUID   DEFAULT NULL,
  p_email         TEXT   DEFAULT NULL,
  p_phone         TEXT   DEFAULT NULL,
  p_password      TEXT   DEFAULT NULL,
  p_display_name  TEXT   DEFAULT NULL,
  p_role          TEXT   DEFAULT NULL,
  p_secret_level  TEXT   DEFAULT NULL,
  p_status        TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
  v_caller_id     UUID;
  v_caller_role   TEXT;
  v_result        JSONB;
  v_target        RECORD;
  v_password_hash TEXT;
  v_min_length    INTEGER;
  v_require_upper   BOOLEAN;
  v_require_digit   BOOLEAN;
  v_require_special BOOLEAN;
BEGIN
  v_caller_id   := current_setting('request.jwt.claims', true)::jsonb->>'sub';
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'biz_role';

  IF v_caller_role NOT IN ('system_admin', 'security_admin') THEN
    RAISE EXCEPTION '权限不足：仅系统管理员和安全管理员可管理用户';
  END IF;

  IF v_caller_role = 'security_admin' AND p_action NOT IN ('update') THEN
    RAISE EXCEPTION '权限不足：安全管理员仅可修改用户角色和安全等级';
  END IF;

  -- 读取密码策略（带默认降级）
  v_min_length      := COALESCE(ichse.get_config('password_min_length')::INTEGER, 8);
  v_require_upper   := COALESCE(ichse.get_config('password_require_upper')::BOOLEAN, true);
  v_require_digit   := COALESCE(ichse.get_config('password_require_digit')::BOOLEAN, true);
  v_require_special := COALESCE(ichse.get_config('password_require_special')::BOOLEAN, false);

  -- ========== 密码校验辅助函数 ==========
  IF p_action IN ('create', 'reset_password') AND p_password IS NOT NULL THEN
    IF length(p_password) < v_min_length THEN
      RAISE EXCEPTION '密码长度不足，至少需要 % 位', v_min_length;
    END IF;
    IF v_require_upper AND p_password !~ '[A-Z]' THEN
      RAISE EXCEPTION '密码必须包含至少一个大写字母';
    END IF;
    IF v_require_digit AND p_password !~ '[0-9]' THEN
      RAISE EXCEPTION '密码必须包含至少一个数字';
    END IF;
    IF v_require_special AND p_password !~ '[!@#$%^&*(),.?\":{}|<>]' THEN
      RAISE EXCEPTION '密码必须包含至少一个特殊字符';
    END IF;
  END IF;

  -- ========== CREATE ==========
  IF p_action = 'create' THEN
    IF p_email IS NULL OR p_password IS NULL OR p_display_name IS NULL THEN
      RAISE EXCEPTION '创建用户需要 email, password, display_name';
    END IF;

    IF EXISTS (SELECT 1 FROM ichse.users WHERE email = p_email) THEN
      RAISE EXCEPTION '邮箱已被使用: %', p_email;
    END IF;
    IF p_phone IS NOT NULL AND EXISTS (SELECT 1 FROM ichse.users WHERE phone = p_phone) THEN
      RAISE EXCEPTION '手机号已被使用: %', p_phone;
    END IF;

    v_password_hash := crypt(p_password, gen_salt('bf'));

    INSERT INTO ichse.users (email, phone, display_name, password_hash, role, secret_level, status)
    VALUES (p_email, p_phone, p_display_name, v_password_hash,
            COALESCE(p_role, 'business_user'),
            COALESCE(p_secret_level, '内部'),
            'active')
    RETURNING id INTO v_caller_id;

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,
      p_event_type := 'user_create',
      p_event_success := true,
      p_target_type := 'user',
      p_target_id := v_caller_id::text,
      p_target_detail := jsonb_build_object('email', p_email, 'role', COALESCE(p_role, 'business_user'))
    );

    v_result := jsonb_build_object('success', true, 'action', 'create', 'user_id', v_caller_id);
    RETURN v_result;
  END IF;

  -- ========== 后续操作需要 p_user_id ==========
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '缺少 p_user_id 参数';
  END IF;

  SELECT * INTO v_target FROM ichse.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在: %', p_user_id;
  END IF;

  IF v_target.is_system THEN
    RAISE EXCEPTION '不允许操作系统用户';
  END IF;

  -- ========== UPDATE ==========
  IF p_action = 'update' THEN
    IF v_caller_role = 'security_admin' THEN
      IF p_role IS NOT NULL OR p_secret_level IS NOT NULL THEN
        UPDATE ichse.users SET
          role = COALESCE(p_role, role),
          secret_level = COALESCE(p_secret_level, secret_level)
        WHERE id = p_user_id;

        PERFORM ichse.write_audit_log(
          p_user_id := v_caller_id,
          p_event_type := 'user_role_change',
          p_event_success := true,
          p_target_type := 'user',
          p_target_id := p_user_id::text,
          p_changes := jsonb_build_object('role', p_role, 'secret_level', p_secret_level)
        );
      END IF;
    ELSE
      UPDATE ichse.users SET
        email = COALESCE(p_email, email),
        phone = COALESCE(p_phone, phone),
        display_name = COALESCE(p_display_name, display_name),
        role = COALESCE(p_role, role),
        secret_level = COALESCE(p_secret_level, secret_level),
        status = COALESCE(p_status, status)
      WHERE id = p_user_id;

      PERFORM ichse.write_audit_log(
        p_user_id := v_caller_id,
        p_event_type := 'user_role_change',
        p_event_success := true,
        p_target_type := 'user',
        p_target_id := p_user_id::text,
        p_changes := jsonb_build_object(
          'email', p_email, 'phone', p_phone, 'display_name', p_display_name,
          'role', p_role, 'secret_level', p_secret_level, 'status', p_status
        )
      );
    END IF;

    v_result := jsonb_build_object('success', true, 'action', 'update', 'user_id', p_user_id);
    RETURN v_result;
  END IF;

  -- ========== DISABLE ==========
  IF p_action = 'disable' THEN
    UPDATE ichse.users SET status = 'disabled' WHERE id = p_user_id;

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,
      p_event_type := 'user_disable', p_event_success := true,
      p_target_type := 'user', p_target_id := p_user_id::text
    );

    v_result := jsonb_build_object('success', true, 'action', 'disable', 'user_id', p_user_id);
    RETURN v_result;
  END IF;

  -- ========== ENABLE ==========
  IF p_action = 'enable' THEN
    UPDATE ichse.users SET status = 'active', failed_attempts = 0, locked_until = NULL WHERE id = p_user_id;

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,
      p_event_type := 'user_enable', p_event_success := true,
      p_target_type := 'user', p_target_id := p_user_id::text
    );

    v_result := jsonb_build_object('success', true, 'action', 'enable', 'user_id', p_user_id);
    RETURN v_result;
  END IF;

  -- ========== RESET_PASSWORD ==========
  IF p_action = 'reset_password' THEN
    IF p_password IS NULL THEN
      RAISE EXCEPTION '重置密码需要 p_password 参数';
    END IF;

    v_password_hash := crypt(p_password, gen_salt('bf'));
    UPDATE ichse.users SET
      password_hash = v_password_hash,
      password_changed_at = now(),
      failed_attempts = 0,
      locked_until = NULL,
      status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
    WHERE id = p_user_id;

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,
      p_event_type := 'password_change', p_event_success := true,
      p_target_type := 'user', p_target_id := p_user_id::text
    );

    v_result := jsonb_build_object('success', true, 'action', 'reset_password', 'user_id', p_user_id);
    RETURN v_result;
  END IF;

  -- ========== DELETE ==========
  IF p_action = 'delete' THEN
    DELETE FROM ichse.rate_limit WHERE user_id = p_user_id;
    DELETE FROM ichse.audit_log WHERE user_id = p_user_id;
    DELETE FROM ichse.users WHERE id = p_user_id;

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,
      p_event_type := 'user_delete', p_event_success := true,
      p_target_type := 'user', p_target_id := p_user_id::text
    );

    v_result := jsonb_build_object('success', true, 'action', 'delete', 'user_id', p_user_id);
    RETURN v_result;
  END IF;

  RAISE EXCEPTION '不支持的操作: %', p_action;
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.manage_user(
  TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
