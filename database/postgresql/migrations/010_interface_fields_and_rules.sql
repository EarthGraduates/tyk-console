-- ============================================================
-- ICHSE biz schema: interface_fields + validation_rules
-- 日期: 2026-06-12
-- ============================================================

-- ============================================================
-- 表: interface_fields — 接口参数字段
-- ============================================================
CREATE TABLE biz.interface_fields (
  id              serial PRIMARY KEY,
  interface_id    int REFERENCES biz.interfaces(id) ON DELETE CASCADE,
  field_name      text NOT NULL,
  field_path      text,
  field_type      text NOT NULL,
  direction       text NOT NULL DEFAULT 'input',
  required        boolean DEFAULT false,
  description     text,
  param_l1        text,
  param_l2        text,
  param_l3        text,
  param_l4        text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);

COMMENT ON TABLE biz.interface_fields IS '接口参数字段定义';

-- ============================================================
-- 表: validation_rules — 校验规则
-- ============================================================
CREATE TABLE biz.validation_rules (
  id              serial PRIMARY KEY,
  field_id        int REFERENCES biz.interface_fields(id) ON DELETE CASCADE,
  rule_type       text NOT NULL,
  rule_config     jsonb NOT NULL,
  error_message   text,
  is_active       boolean DEFAULT true,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,

  CONSTRAINT ck_rule_type CHECK (rule_type IN ('regex', 'domain', 'cross_field'))
);

COMMENT ON TABLE biz.validation_rules IS '校验规则配置表';
