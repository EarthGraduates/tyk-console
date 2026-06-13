-- ============================================================
-- ICHSE biz schema v1.0
-- 日期: 2026-06-12
-- Schema: biz（业务数据）
-- 基础字段约定: is_valid, version, created_at, updated_at, deleted_at
-- ============================================================

CREATE SCHEMA IF NOT EXISTS biz;

-- ============================================================
-- 表 1：lab_sample_types — 样本类型字典
-- ============================================================
CREATE TABLE biz.lab_sample_types (
  id              serial PRIMARY KEY,
  lab_org         text NOT NULL,
  sample_type     text NOT NULL,
  sample_describe text NOT NULL,
  srm1            text,
  srm2            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,

  CONSTRAINT uq_lab_sample_types UNIQUE (lab_org, sample_type)
);

COMMENT ON TABLE biz.lab_sample_types IS '样本类型字典，医院上传/下载的样本类型对照数据';

-- ============================================================
-- 表 2：interfaces — 接口定义元数据
-- ============================================================
CREATE TABLE biz.interfaces (
  id              serial PRIMARY KEY,
  interface_id    text NOT NULL UNIQUE,     -- LAB-NX-MD-O001
  platform        text NOT NULL,            -- NX
  biz_domain      text NOT NULL,            -- LAB (业务域编码)
  biz_category    text,                     -- A.主数据同步（字典对照）
  category_code   text,                     -- MD
  biz_id          text,                     -- A07
  interface_name  text NOT NULL,            -- 检验样本类型下载
  func_name       text NOT NULL UNIQUE,     -- lab_nx_md_a07_get_sample_type
  direction       text,                     -- 送检方
  data_flow       text,                     -- O=出站
  http_method     text DEFAULT 'POST',
  url             text,
  description     text,
  status          text DEFAULT 'active',
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);

COMMENT ON TABLE biz.interfaces IS '接口定义元数据，记录平台接入的所有API接口';

-- ============================================================
-- 种子数据：样本类型
-- ============================================================
INSERT INTO biz.lab_sample_types (lab_org, sample_type, sample_describe, srm1, srm2) VALUES
  ('ORG001', '01', '血液', 'XY', 'AB'),
  ('ORG002', '02', '尿液', 'NY', 'NS')
ON CONFLICT (lab_org, sample_type) DO NOTHING;

-- ============================================================
-- 种子数据：接口定义
-- ============================================================
INSERT INTO biz.interfaces
  (interface_id, platform, biz_domain, biz_category, category_code, biz_id,
   interface_name, func_name, direction, data_flow, http_method, url, description)
VALUES
  ('LAB-NX-MD-O001', 'NX', 'LAB', 'A.主数据同步（字典对照）', 'MD', 'A07',
   '检验样本类型下载', 'lab_nx_md_a07_get_sample_type', '送检方', 'O', 'POST',
   '/api/ygt/mdrs/v1/lis/samplesjf/getSampleType',
   '送检方下载样本类型字典用于项目对照')
ON CONFLICT (interface_id) DO NOTHING;
