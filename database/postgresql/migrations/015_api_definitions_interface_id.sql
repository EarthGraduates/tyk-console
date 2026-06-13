-- ============================================================
-- Migration 015: api_definitions ↔ biz.interfaces 关联
-- 日期: 2026-06-13
-- 依赖: 013_v2_lab_tables.sql
-- 说明: 通过 interface_id FK 关联 API 定义和业务服务
-- ============================================================

-- 1. Add interface_id column (optional FK to biz.interfaces)
ALTER TABLE ichse.api_definitions
  ADD COLUMN IF NOT EXISTS interface_id text;

-- 2. Add FK constraint
ALTER TABLE ichse.api_definitions
  DROP CONSTRAINT IF EXISTS fk_ad_interface_id;
ALTER TABLE ichse.api_definitions
  ADD CONSTRAINT fk_ad_interface_id
  FOREIGN KEY (interface_id) REFERENCES biz.interfaces(interface_id)
  ON DELETE SET NULL;

-- 3. Add index for lookup
CREATE INDEX IF NOT EXISTS idx_ad_interface_id ON ichse.api_definitions(interface_id);

COMMENT ON COLUMN ichse.api_definitions.interface_id IS '关联 biz.interfaces.interface_id，可追溯 API 对应的业务服务';
