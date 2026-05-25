-- ============================================================
-- Migration 007: 会话管理（Phase 3 P1）
-- 日期: 2026-05-25
-- 依赖: 006_security_config.sql
-- ============================================================

-- ============================================================================
-- 1. user_sessions 表
-- ============================================================================

CREATE TABLE IF NOT EXISTS ichse.user_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES ichse.users(id) ON DELETE CASCADE,
  client_ip   TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID
);

COMMENT ON TABLE  ichse.user_sessions IS '用户会话（等保三级 P1 会话管理）';
COMMENT ON COLUMN ichse.user_sessions.id IS '会话 UUID，同时作为 JWT jti (JWT ID) 声明';
COMMENT ON COLUMN ichse.user_sessions.client_ip IS '登录时的客户端 IP';
COMMENT ON COLUMN ichse.user_sessions.user_agent IS '登录时的 User-Agent';
COMMENT ON COLUMN ichse.user_sessions.revoked_at IS '会话撤销时间，NULL 表示会话仍有效';

CREATE INDEX IF NOT EXISTS idx_us_user ON ichse.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_us_revoked ON ichse.user_sessions (revoked_at);

-- ============================================================================
-- 2. RLS
-- ============================================================================

ALTER TABLE ichse.user_sessions ENABLE ROW LEVEL SECURITY;

-- 用户可看自己的会话
CREATE POLICY us_select_own ON ichse.user_sessions
FOR SELECT TO authenticated
USING (user_id::TEXT = current_setting('request.jwt.claims', true)::jsonb->>'sub');

-- security_admin 可看全部会话
CREATE POLICY us_select_admin ON ichse.user_sessions
FOR SELECT TO authenticated
USING (
  (current_setting('request.jwt.claims', true)::jsonb->>'biz_role') = 'security_admin'
);

-- 仅 SECURITY DEFINER 函数可 INSERT/UPDATE/DELETE
GRANT SELECT ON ichse.user_sessions TO authenticated;

-- ============================================================================
-- 3. 新增 security_config 配置项
-- ============================================================================

INSERT INTO ichse.security_config (key, value) VALUES
  ('max_concurrent_sessions', '0')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN ichse.security_config.value IS '0 表示不限制';

-- ============================================================================
-- 4. 更新 set_security_config() — 白名单增加 max_concurrent_sessions
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
    IF v_kv.key IN (
      'password_min_length', 'password_require_upper', 'password_require_digit',
      'password_require_special', 'lockout_threshold', 'lockout_duration_minutes',
      'session_timeout_hours', 'rate_limit_per_minute', 'max_concurrent_sessions'
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
-- 5. 更新 login() — jti + 创建 session + 并发控制
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
    v_max_concurrent       INTEGER;
    v_session_id           UUID;
    v_active_count         INTEGER;
    v_client_ip            TEXT;
    v_user_agent           TEXT;
BEGIN
    v_lockout_threshold     := COALESCE(ichse.get_config('lockout_threshold')::INTEGER, 5);
    v_lockout_duration_min  := COALESCE(ichse.get_config('lockout_duration_minutes')::INTEGER, 30);
    v_session_timeout_hours := COALESCE(ichse.get_config('session_timeout_hours')::INTEGER, 8);
    v_max_concurrent        := COALESCE(ichse.get_config('max_concurrent_sessions')::INTEGER, 0);

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

    -- 并发会话控制：超过限制时撤销最早会话
    IF v_max_concurrent > 0 THEN
        SELECT COUNT(*) INTO v_active_count
        FROM ichse.user_sessions
        WHERE user_id = v_user.id AND revoked_at IS NULL AND expires_at > now();

        IF v_active_count >= v_max_concurrent THEN
            UPDATE ichse.user_sessions
            SET revoked_at = now(), revoked_by = v_user.id
            WHERE id IN (
                SELECT id FROM ichse.user_sessions
                WHERE user_id = v_user.id AND revoked_at IS NULL AND expires_at > now()
                ORDER BY created_at ASC
                LIMIT (v_active_count - v_max_concurrent + 1)
            );
        END IF;
    END IF;

    -- 创建会话
    v_session_id := gen_random_uuid();
    BEGIN
        v_client_ip  := current_setting('request.header.x-forwarded-for', true);
    EXCEPTION WHEN OTHERS THEN
        v_client_ip := NULL;
    END;
    BEGIN
        v_user_agent := current_setting('request.header.user-agent', true);
    EXCEPTION WHEN OTHERS THEN
        v_user_agent := NULL;
    END;

    INSERT INTO ichse.user_sessions (id, user_id, client_ip, user_agent, expires_at)
    VALUES (v_session_id, v_user.id, v_client_ip, v_user_agent,
            now() + (v_session_timeout_hours || ' hours')::INTERVAL);

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
        'jti',          v_session_id::TEXT,
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
        'user', v_user.id::TEXT,
        jsonb_build_object('session_id', v_session_id)
    );

    RETURN jsonb_build_object('token', v_signing_input || '.' || v_signature);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.login(TEXT, TEXT) TO web_anon;

-- ============================================================================
-- 6. logout() — 服务端撤销会话
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.logout()
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
  v_claims     JSONB;
  v_user_id    UUID;
  v_jti        TEXT;
BEGIN
  BEGIN
    v_claims := current_setting('request.jwt.claims', true)::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', true, 'message', 'no token');
  END;

  v_user_id := (v_claims->>'sub')::UUID;
  v_jti     := v_claims->>'jti';

  IF v_jti IS NOT NULL THEN
    UPDATE ichse.user_sessions
    SET revoked_at = now(), revoked_by = v_user_id
    WHERE id = v_jti::UUID AND revoked_at IS NULL;

    PERFORM ichse.write_audit_log(
      v_user_id, 'logout', TRUE, 'session', v_jti
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'logged out');
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.logout() TO authenticated;

-- ============================================================================
-- 7. revoke_session() — 管理员强制撤销指定会话
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.revoke_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id   UUID;
  v_session     RECORD;
BEGIN
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'biz_role';
  v_caller_id   := current_setting('request.jwt.claims', true)::jsonb->>'sub';

  IF v_caller_role NOT IN ('security_admin', 'system_admin') THEN
    RAISE EXCEPTION '权限不足：仅安全管理员和系统管理员可撤销会话';
  END IF;

  SELECT * INTO v_session FROM ichse.user_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会话不存在';
  END IF;

  UPDATE ichse.user_sessions
  SET revoked_at = now(), revoked_by = v_caller_id
  WHERE id = p_session_id AND revoked_at IS NULL;

  PERFORM ichse.write_audit_log(
    v_caller_id, 'session_revoke', TRUE,
    'session', p_session_id::TEXT,
    jsonb_build_object('target_user_id', v_session.user_id)
  );

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.revoke_session(UUID) TO authenticated;

-- ============================================================================
-- 8. list_active_sessions() — 管理员查看所有活跃会话
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.list_active_sessions()
RETURNS TABLE(
  session_id    UUID,
  user_id       UUID,
  user_email    TEXT,
  user_display  TEXT,
  user_role     TEXT,
  client_ip     TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ
)
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'biz_role';

  IF v_caller_role NOT IN ('security_admin', 'system_admin') THEN
    RAISE EXCEPTION '权限不足：仅安全管理员和系统管理员可查看会话列表';
  END IF;

  RETURN QUERY
  SELECT
    us.id,
    us.user_id,
    u.email,
    u.display_name,
    u.role,
    us.client_ip,
    us.user_agent,
    us.created_at,
    us.expires_at
  FROM ichse.user_sessions us
  JOIN ichse.users u ON u.id = us.user_id
  WHERE us.revoked_at IS NULL AND us.expires_at > now()
  ORDER BY us.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.list_active_sessions() TO authenticated;

-- ============================================================================
-- 9. 更新 db_pre_request() — 验证会话未被撤销
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.db_pre_request() RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
    v_claims       JSONB;
    v_user_id      UUID;
    v_jti          TEXT;
    v_role         TEXT;
    v_secret_level TEXT;
    v_user_status  TEXT;
    v_locked_until TIMESTAMPTZ;
BEGIN
    BEGIN
        v_claims := current_setting('request.jwt.claims')::JSONB;
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.role', 'anonymous', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
        PERFORM set_config('app.secret_level', '公开', TRUE);
        RETURN;
    END;

    v_user_id      := (v_claims->>'sub')::UUID;
    v_role         := v_claims->>'biz_role';
    v_secret_level := COALESCE(v_claims->>'secret_level', '内部');
    v_jti          := v_claims->>'jti';

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

    -- 会话验证：仅对带 jti 的新 token 做检查（兼容旧 token）
    IF v_jti IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM ichse.user_sessions
            WHERE id = v_jti::UUID AND revoked_at IS NULL AND expires_at > now()
        ) THEN
            RAISE SQLSTATE 'A0004' USING MESSAGE = '会话已失效或被撤销，请重新登录';
        END IF;
    END IF;

    PERFORM set_config('app.user_id', v_user_id::TEXT, TRUE);
    PERFORM set_config('app.role', v_role, TRUE);
    PERFORM set_config('app.secret_level', v_secret_level, TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.db_pre_request() TO authenticated;

-- ============================================================================
-- 10. 更新 write_audit_log() — 自动填充 client_ip / user_agent
-- ============================================================================

CREATE OR REPLACE FUNCTION ichse.write_audit_log(
    p_user_id       UUID    DEFAULT NULL,
    p_event_type    TEXT    DEFAULT NULL,
    p_event_success BOOLEAN DEFAULT NULL,
    p_target_type   TEXT    DEFAULT NULL,
    p_target_id     TEXT    DEFAULT NULL,
    p_target_detail JSONB   DEFAULT NULL,
    p_changes       JSONB   DEFAULT NULL,
    p_error_message TEXT    DEFAULT NULL
) RETURNS BIGINT LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path = ichse, pg_catalog
AS $$
DECLARE
    v_user_email TEXT;
    v_user_role  TEXT;
    v_hmac       TEXT;
    v_row_data   TEXT;
    v_record_id  BIGINT;
    v_client_ip  TEXT;
    v_user_agent TEXT;
BEGIN
    IF p_user_id IS NOT NULL THEN
        SELECT email, role INTO v_user_email, v_user_role
        FROM ichse.users WHERE id = p_user_id;
    END IF;

    BEGIN
        v_client_ip  := current_setting('request.header.x-forwarded-for', true);
    EXCEPTION WHEN OTHERS THEN
        v_client_ip := NULL;
    END;
    BEGIN
        v_user_agent := current_setting('request.header.user-agent', true);
    EXCEPTION WHEN OTHERS THEN
        v_user_agent := NULL;
    END;

    INSERT INTO ichse.audit_log (
        user_id, user_email, user_role,
        event_type, event_success,
        target_type, target_id, target_detail,
        changes, error_message,
        client_ip, user_agent
    ) VALUES (
        p_user_id, v_user_email, v_user_role,
        p_event_type, p_event_success,
        p_target_type, p_target_id, p_target_detail,
        p_changes, p_error_message,
        v_client_ip, v_user_agent
    ) RETURNING id INTO v_record_id;

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
