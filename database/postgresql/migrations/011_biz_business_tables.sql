-- ============================================================
-- V1.4: 业务表 — PostgREST 直连 CRUD
-- 基础字段: is_valid, version, created_at, updated_at, deleted_at
-- 业务数据: data JSONB 存接口特有字段
-- v2.0: 重命名为 lab_ 前缀
-- ============================================================

-- MD: 样本类型字典 (已存在，加 data 列)
ALTER TABLE biz.lab_sample_types ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}';

-- MD: 检验项目字典
CREATE TABLE biz.lab_request_items (
  id serial PRIMARY KEY,
  lab_org text NOT NULL,
  item_code text NOT NULL,
  item_name text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL,
  UNIQUE(lab_org, item_code)
);

-- MD: 报告项目字典
CREATE TABLE biz.lab_test_items (
  id serial PRIMARY KEY,
  lab_org text NOT NULL,
  item_code text NOT NULL,
  item_name text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL,
  UNIQUE(lab_org, item_code)
);

-- MD: 细菌字典
CREATE TABLE biz.lab_bio_items (
  id serial PRIMARY KEY,
  lab_org text NOT NULL,
  item_code text NOT NULL,
  item_name text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL,
  UNIQUE(lab_org, item_code)
);

-- MD: 药敏字典
CREATE TABLE biz.lab_anti_items (
  id serial PRIMARY KEY,
  lab_org text NOT NULL,
  item_code text NOT NULL,
  item_name text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL,
  UNIQUE(lab_org, item_code)
);

-- SP/RC: 标本
CREATE TABLE biz.lab_specimens (
  id serial PRIMARY KEY,
  barcode text,
  sending_org text,
  center_org text,
  specimen_type text,
  status text DEFAULT 'registered',
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_specimens_barcode ON biz.lab_specimens(barcode);

-- RP: 检验报告
CREATE TABLE biz.lab_test_reports (
  id serial PRIMARY KEY,
  report_id text,
  barcode text,
  lab_org text,
  report_status text DEFAULT 'submitted',
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- RP: 报告图片
CREATE TABLE biz.lab_report_images (
  id serial PRIMARY KEY,
  report_id int REFERENCES biz.lab_test_reports(id),
  image_type text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- CV: 危急值
CREATE TABLE biz.lab_sample_warnings (
  id serial PRIMARY KEY,
  barcode text,
  lab_org text,
  warn_type text,
  feedback_status text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- QC: 质控数据
CREATE TABLE biz.lab_qc_data (
  id serial PRIMARY KEY,
  lab_org text,
  qc_type text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- EQ: 设备信息
CREATE TABLE biz.lab_device_info (
  id serial PRIMARY KEY,
  lab_org text,
  device_code text,
  device_name text,
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL,
  UNIQUE(lab_org, device_code)
);

-- QR: 检验申请
CREATE TABLE biz.lab_applications (
  id serial PRIMARY KEY,
  app_no text,
  sending_org text,
  center_org text,
  app_status text DEFAULT 'submitted',
  data jsonb DEFAULT '{}',
  is_valid boolean DEFAULT true,
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- ============================================================
-- PostgREST 视图 + 权限（ichse schema 暴露）
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['lab_sample_types','lab_request_items','lab_test_items','lab_bio_items','lab_anti_items',
      'lab_specimens','lab_test_reports','lab_report_images','lab_sample_warnings','lab_qc_data','lab_device_info','lab_applications'])
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS ichse.%I CASCADE', tbl);
    EXECUTE format('CREATE VIEW ichse.%I AS SELECT * FROM biz.%I WHERE is_valid = true', tbl, tbl);
    EXECUTE format('GRANT SELECT ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT INSERT, UPDATE ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT USAGE ON SEQUENCE biz.%I_id_seq TO web_anon', tbl);
  END LOOP;
END $$;
