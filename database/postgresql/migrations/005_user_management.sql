-- 005_user_management.sql
-- Phase 2: 用户管理函数 + 审计日志 RLS 更新 + sysadmin 视图补全

-- ============================================================================
-- 1. 更新 users_sysadmin_view：system_admin 应能看到 role 和 secret_level
-- ============================================================================

DROP VIEW IF EXISTS ichse.users_sysadmin_view;
CREATE OR REPLACE VIEW ichse.users_sysadmin_view AS
SELECT id, email, phone, display_name, is_system,
       role, secret_level, status,
       last_login_at, failed_attempts, locked_until,
       password_changed_at, created_at
FROM ichse.users;

GRANT SELECT ON ichse.users_sysadmin_view TO authenticated;

-- ============================================================================
-- 2. 更新 audit_log RLS：system_admin 也可 SELECT
-- ============================================================================

DROP POLICY IF EXISTS al_select ON ichse.audit_log;
CREATE POLICY al_select ON ichse.audit_log
FOR SELECT TO authenticated
USING (ichse.is_role('audit_admin') OR ichse.is_role('system_admin'));

-- ============================================================================
-- 3. manage_user() — SECURITY DEFINER 用户管理函数
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
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_caller_email TEXT;
  v_result      JSONB;
  v_target       RECORD;
  v_password_hash TEXT;
BEGIN
  -- 获取调用者信息
  v_caller_id   := current_setting('request.jwt.claims', true)::jsonb->>'sub';
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'biz_role';
  v_caller_email := current_setting('request.jwt.claims', true)::jsonb->>'email';

  -- 权限检查：仅 system_admin 和 security_admin 可调用
  IF v_caller_role NOT IN ('system_admin', 'security_admin') THEN
    RAISE EXCEPTION '权限不足：仅系统管理员和安全管理员可管理用户';
  END IF;

  -- security_admin 只能 update role/secret_level，其他操作拒绝
  IF v_caller_role = 'security_admin' AND p_action NOT IN ('update') THEN
    RAISE EXCEPTION '权限不足：安全管理员仅可修改用户角色和安全等级';
  END IF;

  -- ========== CREATE ==========
  IF p_action = 'create' THEN
    IF p_email IS NULL OR p_password IS NULL OR p_display_name IS NULL THEN
      RAISE EXCEPTION '创建用户需要 email, password, display_name';
    END IF;

    -- 检查唯一性
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
    RETURNING id INTO v_caller_id;  -- 复用变量存新用户 ID

    PERFORM ichse.write_audit_log(
      p_user_id := v_caller_id,  -- 新用户 ID
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

  -- 不允许操作系统用户
  IF v_target.is_system THEN
    RAISE EXCEPTION '不允许操作系统用户';
  END IF;

  -- ========== UPDATE ==========
  IF p_action = 'update' THEN
    -- security_admin 只能改 role 和 secret_level
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
      -- system_admin 可更新全部字段
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
    -- 清理关联数据
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
