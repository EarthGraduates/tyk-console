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

-- 1. pgjwt（JWT 签发）───────────────────────────────────────────
-- 从 michelp/pgjwt v0.2.0 加载，使用 translate() 处理 encode() 换行
-- 需要 pgcrypto（已在 002 安装）

-- pgcrypto hmac() 需要 bytea 参数，pgjwt 调用时传 text → 桥接
CREATE OR REPLACE FUNCTION ichse.hmac(data text, key text, algorithm text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
    SELECT public.hmac(data::bytea, key::bytea, algorithm);
$$;

CREATE OR REPLACE FUNCTION ichse.url_encode(data bytea) RETURNS text LANGUAGE sql AS $$
    SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
$$ IMMUTABLE;

CREATE OR REPLACE FUNCTION ichse.url_decode(data text) RETURNS bytea LANGUAGE sql AS $$
WITH t AS (SELECT translate(data, '-_', '+/') AS trans),
     rem AS (SELECT length(t.trans) % 4 AS remainder FROM t)
    SELECT decode(
        t.trans ||
        CASE WHEN rem.remainder > 0
           THEN repeat('=', (4 - rem.remainder))
           ELSE '' END,
    'base64') FROM t, rem;
$$ IMMUTABLE;

CREATE OR REPLACE FUNCTION ichse.algorithm_sign(signables text, secret text, algorithm text)
RETURNS text LANGUAGE sql AS $$
WITH
  alg AS (
    SELECT CASE
      WHEN algorithm = 'HS256' THEN 'sha256'
      WHEN algorithm = 'HS384' THEN 'sha384'
      WHEN algorithm = 'HS512' THEN 'sha512'
      ELSE '' END AS id)
SELECT ichse.url_encode(ichse.hmac(signables, secret, alg.id)) FROM alg;
$$ IMMUTABLE;

CREATE OR REPLACE FUNCTION ichse.sign(payload json, secret text, algorithm text DEFAULT 'HS256')
RETURNS text LANGUAGE sql AS $$
WITH
  header AS (
    SELECT ichse.url_encode(convert_to('{"alg":"' || algorithm || '","typ":"JWT"}', 'utf8')) AS data
    ),
  payload AS (
    SELECT ichse.url_encode(convert_to(payload::text, 'utf8')) AS data
    ),
  signables AS (
    SELECT header.data || '.' || payload.data AS data FROM header, payload
    )
SELECT
    signables.data || '.' ||
    ichse.algorithm_sign(signables.data, secret, algorithm) FROM signables;
$$ IMMUTABLE;

CREATE OR REPLACE FUNCTION ichse.verify(token text, secret text, algorithm text DEFAULT 'HS256')
RETURNS table(header json, payload json, valid boolean) LANGUAGE sql AS $$
  SELECT
    jwt.header AS header,
    jwt.payload AS payload,
    jwt.signature_ok AS valid
  FROM (
    SELECT
      convert_from(ichse.url_decode(r[1]), 'utf8')::json AS header,
      convert_from(ichse.url_decode(r[2]), 'utf8')::json AS payload,
      r[3] = ichse.algorithm_sign(r[1] || '.' || r[2], secret, algorithm) AS signature_ok
    FROM regexp_split_to_array(token, '\.') r
  ) jwt
$$ IMMUTABLE;

-- 2. 验证码登录（预留，Phase 2 实现）────────────────────────────

CREATE OR REPLACE FUNCTION ichse.login_with_code(
    p_login TEXT,
    p_code  TEXT
) RETURNS TEXT LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
    RAISE EXCEPTION '验证码登录尚未实现';
END;
$$;

-- 3. 密码登录（pgjwt 签名，返回 JSONB { token }）──────────────

CREATE OR REPLACE FUNCTION ichse.login(
    p_login    TEXT,
    p_password TEXT
) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_user     RECORD;
    v_payload  JSON;
    v_token    TEXT;
BEGIN
    SELECT id, email, phone, role, display_name, secret_level,
           password_hash, status, failed_attempts, locked_until
    INTO v_user
    FROM ichse.users
    WHERE email = p_login OR phone = p_login;

    IF NOT FOUND THEN
        PERFORM ichse.write_audit_log(NULL, 'login_failed', FALSE,
            'user', p_login, jsonb_build_object('reason', 'user not found'), NULL, p_login);
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;

    IF v_user.status = 'disabled' THEN
        RAISE EXCEPTION '账户已被禁用，请联系管理员';
    END IF;

    IF v_user.status = 'locked' AND v_user.locked_until > now() THEN
        RAISE EXCEPTION '账户已被锁定至 %',
            to_char(v_user.locked_until, 'YYYY-MM-DD HH24:MI:SS');
    END IF;

    IF v_user.password_hash IS NULL
       OR v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        UPDATE ichse.users
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= 5 THEN 'locked' ELSE status END,
            locked_until = CASE WHEN failed_attempts + 1 >= 5
                THEN now() + INTERVAL '30 minutes' ELSE locked_until END
        WHERE id = v_user.id;
        PERFORM ichse.write_audit_log(v_user.id, 'login_failed', FALSE,
            'user', v_user.id::TEXT,
            jsonb_build_object('reason', 'wrong password', 'attempt', v_user.failed_attempts + 1));
        RAISE EXCEPTION '登录失败：用户名或密码错误';
    END IF;

    UPDATE ichse.users
    SET failed_attempts = 0, last_login_at = now(),
        status = CASE WHEN status = 'locked' THEN 'active' ELSE status END,
        locked_until = NULL
    WHERE id = v_user.id;

    -- JWT payload：全部 9 个字段（含中文，pgjwt 支持 UTF-8）
    v_payload := json_build_object(
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
    v_token := ichse.sign(v_payload, current_setting('app.jwt_secret'));

    PERFORM ichse.write_audit_log(v_user.id, 'login', TRUE, 'user', v_user.id::TEXT);

    RETURN jsonb_build_object('token', v_token);
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

-- 6. db_pre_request — PostgREST 每次请求前执行（只读，SECURITY DEFINER 绕过 RLS）──

CREATE OR REPLACE FUNCTION ichse.db_pre_request() RETURNS VOID
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
    v_claims       JSONB;
    v_user_id      UUID;
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
        PERFORM set_config('app.secret_level', '内部', TRUE);
        RETURN;
    END;

    v_user_id      := (v_claims->>'sub')::UUID;
    v_role         := v_claims->>'biz_role';
    v_secret_level := COALESCE(v_claims->>'secret_level', '内部');

    IF v_user_id IS NULL THEN
        PERFORM set_config('app.role', 'anonymous', TRUE);
        PERFORM set_config('app.user_id', '', TRUE);
        PERFORM set_config('app.secret_level', '内部', TRUE);
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
