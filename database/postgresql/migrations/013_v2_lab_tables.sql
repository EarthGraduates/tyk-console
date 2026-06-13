-- ============================================================
-- Migration 013: v2.0 LAB 二维表方案 — 完整 DDL
-- 日期: 2026-06-13
-- 说明: DROP 旧 12 表 + 36 函数 → CREATE 新 23 表 + 索引 + 视图
-- 依赖: 011 (biz_business_tables), 012 (rename_biz_to_lab)
-- ============================================================

-- ============================================================
-- Phase 0: 备份关键种子数据
-- ============================================================
DROP TABLE IF EXISTS _mig_seed_sample_types;
CREATE TEMP TABLE _mig_seed_sample_types AS
SELECT lab_org, sample_type, sample_describe, srm1, srm2
FROM biz.lab_sample_types WHERE is_valid = true;

-- ============================================================
-- Phase 1: DROP 旧对象（视图 → 函数 → 表，按依赖顺序）
-- ============================================================

-- 1a. Drop ichse views
DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['lab_sample_types','lab_request_items','lab_test_items','lab_bio_items','lab_anti_items',
      'lab_specimens','lab_test_reports','lab_report_images','lab_sample_warnings','lab_qc_data','lab_device_info','lab_applications'])
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS ichse.%I CASCADE', tbl);
  END LOOP;
END $$;

-- 1b. Drop all lab_nx_* functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'ichse' AND proname LIKE 'lab_nx_%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS ichse.%I(json) CASCADE', r.proname);
  END LOOP;
END $$;

-- 1c. Drop old biz tables (CASCADE to handle FKs)
DROP TABLE IF EXISTS biz.lab_report_images CASCADE;
DROP TABLE IF EXISTS biz.lab_test_reports CASCADE;
DROP TABLE IF EXISTS biz.lab_specimens CASCADE;
DROP TABLE IF EXISTS biz.lab_sample_warnings CASCADE;
DROP TABLE IF EXISTS biz.lab_applications CASCADE;
DROP TABLE IF EXISTS biz.lab_qc_data CASCADE;
DROP TABLE IF EXISTS biz.lab_device_info CASCADE;
DROP TABLE IF EXISTS biz.lab_sample_types CASCADE;
DROP TABLE IF EXISTS biz.lab_request_items CASCADE;
DROP TABLE IF EXISTS biz.lab_test_items CASCADE;
DROP TABLE IF EXISTS biz.lab_bio_items CASCADE;
DROP TABLE IF EXISTS biz.lab_anti_items CASCADE;

-- ============================================================
-- Phase 2: CREATE 新 23 表
-- ============================================================

-- ── 字典表 (7) ──

CREATE TABLE biz.lab_sample_types (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,
  sample_type     text NOT NULL,
  sample_describe text NOT NULL,
  srm1            text,
  srm2            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,
  UNIQUE(org_lab, sample_type)
);
COMMENT ON TABLE biz.lab_sample_types IS '样本类型字典 (A01/A07)';
COMMENT ON COLUMN biz.lab_sample_types.org_lab IS '临检机构代码';
COMMENT ON COLUMN biz.lab_sample_types.sample_type IS '样本类型编码';
COMMENT ON COLUMN biz.lab_sample_types.sample_describe IS '样本类型名称';

CREATE TABLE biz.lab_request_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,
  req_item_code   text NOT NULL,
  req_item_name   text,
  bill_price      numeric(10,2),
  used_now        int,
  srm1            text,
  srm2            text,
  sp_type         text,
  sp_describe     text,
  compose_type    text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,
  UNIQUE(org_lab, req_item_code)
);
COMMENT ON TABLE biz.lab_request_items IS '检验开单项目字典 (A02/A08)';

CREATE TABLE biz.lab_request_item_tests (
  id                serial PRIMARY KEY,
  request_item_id   int NOT NULL REFERENCES biz.lab_request_items(id) ON DELETE CASCADE,
  test_id           text NOT NULL,
  chinese_name      text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);

CREATE TABLE biz.lab_request_item_children (
  id                serial PRIMARY KEY,
  request_item_id   int NOT NULL REFERENCES biz.lab_request_items(id) ON DELETE CASCADE,
  child_item_code   text NOT NULL,
  child_item_name   text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);

CREATE TABLE biz.lab_test_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,
  test_id         text NOT NULL,
  chinese_name    text NOT NULL,
  english_ab      text,
  english_name    text,
  method_name     text,
  srm1            text,
  srm2            text,
  sp_type         text,
  sp_describe     text,
  unit            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,
  UNIQUE(org_lab, test_id)
);
COMMENT ON TABLE biz.lab_test_items IS '检验报告项目字典 (A03/A09)';

CREATE TABLE biz.lab_bio_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,
  bio_id          text NOT NULL,
  fabio_id        text,
  fabio_name      text,
  english_name    text,
  english_ab      text,
  chinese_name    text NOT NULL,
  bio_type        int,
  srm1            text,
  srm2            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,
  UNIQUE(org_lab, bio_id)
);
COMMENT ON TABLE biz.lab_bio_items IS '细菌字典 (A04/A10)';

CREATE TABLE biz.lab_anti_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,
  anti_id         text NOT NULL,
  faanti_id       text,
  faanti_name     text,
  english_name    text,
  english_ab      text,
  chinese_name    text NOT NULL,
  srm1            text,
  srm2            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL,
  UNIQUE(org_lab, anti_id)
);
COMMENT ON TABLE biz.lab_anti_items IS '药敏字典 (A05/A11)';

-- ── 标本三级结构 (3) ──

CREATE TABLE biz.lab_specimens (
  id                serial PRIMARY KEY,
  packet_id         text NOT NULL,
  org_sending       text,
  org_center        text,
  col_org_code      text,
  col_org_name      text,
  col_doctor        text,
  col_name          text,
  col_time          timestamptz,
  send_flag         text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);
CREATE UNIQUE INDEX uq_lab_specimens_packet_id ON biz.lab_specimens(packet_id);
CREATE INDEX idx_lab_specimens_org_sending ON biz.lab_specimens(org_sending);
CREATE INDEX idx_lab_specimens_org_center ON biz.lab_specimens(org_center);
COMMENT ON TABLE biz.lab_specimens IS '送检单 L1 (B02)';

CREATE TABLE biz.lab_specimen_items (
  id                serial PRIMARY KEY,
  specimen_id       int NOT NULL REFERENCES biz.lab_specimens(id) ON DELETE CASCADE,
  -- 标本标识
  sp_barcode        text NOT NULL,
  sp_old_barcode    text,
  sp_no             text,
  sp_type           text,
  sp_describe       text,
  sp_toponymy       text,
  sp_examinaim      text,
  sp_notes          text,
  sp_entrust_collect int,
  -- 患者 pt_
  pt_name           text,
  pt_sex            int,
  pt_age            int,
  pt_age_unit       int,
  pt_birthday       date,
  pt_id             text,
  pt_id_card        text,
  pt_phone          text,
  pt_type           int,
  pt_properties     text,
  pt_diagnostic     text,
  pt_infant_flag    int,
  pt_source_id      text,
  pt_visit_id       text,
  pt_bed_no         text,
  pt_ward_code      text,
  pt_ward_name      text,
  -- 开单 req_
  req_doctor        text,
  req_name          text,
  req_time          timestamptz,
  req_section       text,
  req_section_name  text,
  req_mode          int,
  req_ward_code     text,
  req_ward_name     text,
  -- 采集 col_
  col_doctor        text,
  col_name          text,
  col_time          timestamptz,
  col_org_code      text,
  col_org_name      text,
  -- 接收 rec_ (D02)
  rec_doctor        text,
  rec_name          text,
  rec_time          timestamptz,
  rec_flag          text,
  rec_status        int,
  rec_reject_reason text,
  -- 状态
  sp_status         text DEFAULT 'registered',
  -- 不合格 (D04)
  unqual_reason     text,
  unqual_doctor     text,
  unqual_name       text,
  unqual_time       timestamptz,
  unqual_section    text,
  unqual_section_name text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);
CREATE UNIQUE INDEX uq_lab_si_barcode ON biz.lab_specimen_items(sp_barcode);
CREATE INDEX idx_lab_si_specimen_id ON biz.lab_specimen_items(specimen_id);
CREATE INDEX idx_lab_si_pt_id ON biz.lab_specimen_items(pt_id);
CREATE INDEX idx_lab_si_pt_name ON biz.lab_specimen_items(pt_name);
CREATE INDEX idx_lab_si_sp_status ON biz.lab_specimen_items(sp_status);
CREATE INDEX idx_lab_si_col_time ON biz.lab_specimen_items(col_time);
COMMENT ON TABLE biz.lab_specimen_items IS '标本 L2 条码级 (B02/D01/D02/D04)';

CREATE TABLE biz.lab_specimen_barcode_items (
  id                  serial PRIMARY KEY,
  specimen_item_id    int NOT NULL REFERENCES biz.lab_specimen_items(id) ON DELETE CASCADE,
  sp_barcode          text NOT NULL,
  org_sending         text,
  bill_item_code      text,
  bill_child_code     text,
  bill_price          numeric(10,2),
  bill_number         int,
  bill_name           text,
  bill_child_name     text,
  is_valid            boolean DEFAULT true,
  version             int DEFAULT 1,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_sbi_item_id ON biz.lab_specimen_barcode_items(specimen_item_id);
COMMENT ON TABLE biz.lab_specimen_barcode_items IS '标本收费明细 L3 (B02 barcodeDetailList)';

-- ── 报告 (6) ──

CREATE TABLE biz.lab_test_reports (
  id                serial PRIMARY KEY,
  -- 报告标识
  rpt_id            text NOT NULL,
  rpt_status        text DEFAULT 'submitted',
  rpt_result_status int,
  rpt_explain       text,
  rpt_url           text,
  -- 标本关联
  sp_barcode        text,
  sp_no             text,
  sp_type           text,
  sp_describe       text,
  -- 机构 org_
  org_lab           text NOT NULL,
  org_sending       text,
  org_sending_name  text,
  -- 患者 pt_
  pt_name           text,
  pt_sex            int,
  pt_age            int,
  pt_age_unit       int,
  pt_birthday       date,
  pt_id             text,
  pt_medicalcard_id text,
  pt_properties     text,
  pt_type           int,
  pt_diagnostic     text,
  pt_diagnostic_code text,
  pt_toponymy       text,
  -- 开单 req_
  req_section       text,
  req_section_name  text,
  req_mode          int,
  req_examinaim     text,
  req_examinaim_code text,
  -- 审核 chk_
  chk_doctor        text,
  chk_name          text,
  chk_doctor2       text,
  chk_name2         text,
  chk_time          timestamptz,
  chk_opinion       text,
  chk_section       text,
  chk_section_name  text,
  -- 接收 rec_
  rec_doctor        text,
  rec_name          text,
  rec_time          timestamptz,
  -- 让步 cnc_
  cnc_flag          int,
  cnc_reason        text,
  -- 撤销 cnl_
  cnl_reason        text,
  cnl_doctor        text,
  cnl_name          text,
  cnl_time          timestamptz,
  cnl_section       text,
  cnl_section_name  text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);
CREATE UNIQUE INDEX uq_lab_reports_rpt_id ON biz.lab_test_reports(rpt_id);
CREATE INDEX idx_lab_reports_sp_barcode ON biz.lab_test_reports(sp_barcode);
CREATE INDEX idx_lab_reports_org_lab ON biz.lab_test_reports(org_lab);
CREATE INDEX idx_lab_reports_pt_id ON biz.lab_test_reports(pt_id);
CREATE INDEX idx_lab_reports_chk_time ON biz.lab_test_reports(chk_time);
CREATE INDEX idx_lab_reports_rpt_status ON biz.lab_test_reports(rpt_status);
COMMENT ON TABLE biz.lab_test_reports IS '检验报告主表 (E01/E03/E05/E08/E09)';

CREATE TABLE biz.lab_report_result_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  test_id         text NOT NULL,
  hos_test_id     text,
  chinese_name    text NOT NULL,
  test_result     text,
  ref_range       text,
  ref_lo          text,
  ref_hi          text,
  measure_time    timestamptz,
  hint            text,
  unit            text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_rri_report_id ON biz.lab_report_result_items(report_id);
CREATE INDEX idx_lab_rri_test_id ON biz.lab_report_result_items(test_id);
COMMENT ON TABLE biz.lab_report_result_items IS '常规结果明细 (E01/E03 resultInfoList)';

CREATE TABLE biz.lab_report_plant_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  test_id         text,
  hos_test_id     text,
  chinese_name    text,
  test_result     text,
  result_type     int,
  plant_type      int,
  plant_remark    text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_rpi_report_id ON biz.lab_report_plant_items(report_id);
COMMENT ON TABLE biz.lab_report_plant_items IS '培养结果明细 (E01/E03 plantInfoList)';

CREATE TABLE biz.lab_report_anti_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  anti_id         text,
  anti_name       text,
  bio_id          text,
  bio_name        text,
  bio_type        int,
  kb_result       text,
  mic_result      text,
  etest_result    text,
  test_result     text,
  method          int,
  print_ord       int,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_rai_report_id ON biz.lab_report_anti_items(report_id);
COMMENT ON TABLE biz.lab_report_anti_items IS '药敏结果明细 (E01/E03 antiInfoList)';

CREATE TABLE biz.lab_report_bio_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  bio_id          text,
  bio_name        text,
  bio_type        int,
  bio_quantity    text,
  spectrum        text,
  measure_time    timestamptz,
  remark          text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_rbi_report_id ON biz.lab_report_bio_items(report_id);
COMMENT ON TABLE biz.lab_report_bio_items IS '细菌结果明细 (E01/E03 bioInfoList)';

CREATE TABLE biz.lab_report_images (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  org_lab         text,
  sp_barcode      text,
  sp_no           text,
  report_type     int,
  pic_no          int,
  image_text      text,
  format          text,
  image_url       text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_rimg_report_id ON biz.lab_report_images(report_id);
COMMENT ON TABLE biz.lab_report_images IS '图文报告 (E02/E04)';

-- ── 危急值 (2) ──

CREATE TABLE biz.lab_sample_warnings (
  id                serial PRIMARY KEY,
  org_lab           text NOT NULL,
  sp_barcode        text,
  sp_no             text,
  pt_name           text,
  pt_sex            int,
  pt_birthday       date,
  pt_id             text,
  chk_doctor        text,
  chk_name          text,
  chk_time          timestamptz,
  chk_section       text,
  chk_section_name  text,
  feedback_status   int,
  rec_doctor        text,
  rec_time          timestamptz,
  rec_note          text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_warn_sp_barcode ON biz.lab_sample_warnings(sp_barcode);
CREATE INDEX idx_lab_warn_chk_time ON biz.lab_sample_warnings(chk_time);
CREATE INDEX idx_lab_warn_org_lab ON biz.lab_sample_warnings(org_lab);
COMMENT ON TABLE biz.lab_sample_warnings IS '危急值主表 (F01/F02/F03/F04)';

CREATE TABLE biz.lab_warn_log_items (
  id              serial PRIMARY KEY,
  warning_id      int NOT NULL REFERENCES biz.lab_sample_warnings(id) ON DELETE CASCADE,
  warn_info       text NOT NULL,
  test_id         text,
  test_name       text,
  test_result     text,
  rpt_id          text,
  rec_doctor      text,
  rec_time        timestamptz,
  rec_note        text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_wli_warning_id ON biz.lab_warn_log_items(warning_id);
COMMENT ON TABLE biz.lab_warn_log_items IS '危急项目明细 (F01/F02 warnLogList)';

-- ── 申请 (2) ──

CREATE TABLE biz.lab_applications (
  id                serial PRIMARY KEY,
  application_id    text NOT NULL,
  org_sending       text NOT NULL,
  sp_barcode        text,
  pt_name           text,
  pt_sex            text,
  pt_age            text,
  pt_id             text,
  pt_phone          text,
  pt_type           text,
  pt_diagnostic     text,
  pt_bed_no         text,
  pt_ward_name      text,
  req_section_name  text,
  req_mode          text,
  req_doctor        text,
  req_time          timestamptz,
  status            text,
  accept_time       timestamptz,
  send_flag         int,
  reason            text,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);
CREATE UNIQUE INDEX uq_lab_app_application_id ON biz.lab_applications(application_id);
CREATE INDEX idx_lab_app_org_sending ON biz.lab_applications(org_sending);
CREATE INDEX idx_lab_app_pt_id ON biz.lab_applications(pt_id);
CREATE INDEX idx_lab_app_status ON biz.lab_applications(status);
CREATE INDEX idx_lab_app_req_time ON biz.lab_applications(req_time);
COMMENT ON TABLE biz.lab_applications IS '检验申请主表 (P01/P02)';

CREATE TABLE biz.lab_application_items (
  id               serial PRIMARY KEY,
  application_id   int NOT NULL REFERENCES biz.lab_applications(id) ON DELETE CASCADE,
  req_item_code    text NOT NULL,
  req_item_name    text,
  compose_type     text,
  sp_type          text,
  req_mode         text,
  req_doctor       text,
  preparation_note text,
  is_valid         boolean DEFAULT true,
  version          int DEFAULT 1,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_ai_application_id ON biz.lab_application_items(application_id);
COMMENT ON TABLE biz.lab_application_items IS '申请检验项目明细 (P01/P02 itemInfoList)';

-- ── 独立表 (2) ──

CREATE TABLE biz.lab_qc_data (
  id               serial PRIMARY KEY,
  org_lab          text,
  qc_type          text,
  qc_date          date,
  instrument_code  text,
  test_item_code   text,
  qc_value         numeric(10,2),
  qc_target        numeric(10,2),
  qc_sd            numeric(10,2),
  is_valid         boolean DEFAULT true,
  version          int DEFAULT 1,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz DEFAULT NULL
);
CREATE INDEX idx_lab_qc_org_lab ON biz.lab_qc_data(org_lab);
CREATE INDEX idx_lab_qc_item ON biz.lab_qc_data(test_item_code);
CREATE INDEX idx_lab_qc_date ON biz.lab_qc_data(qc_date);

CREATE TABLE biz.lab_device_info (
  id            serial PRIMARY KEY,
  org_lab       text,
  device_code   text NOT NULL,
  device_name   text,
  model         text,
  sn            text,
  manufacturer  text,
  is_valid      boolean DEFAULT true,
  version       int DEFAULT 1,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz DEFAULT NULL,
  UNIQUE(org_lab, device_code)
);

-- ============================================================
-- Phase 3: 种子数据
-- ============================================================

INSERT INTO biz.lab_sample_types (org_lab, sample_type, sample_describe, srm1, srm2)
  SELECT lab_org, sample_type, sample_describe, srm1, srm2
  FROM _mig_seed_sample_types
ON CONFLICT (org_lab, sample_type) DO NOTHING;

-- 补一条默认种子（如果表为空）
INSERT INTO biz.lab_sample_types (org_lab, sample_type, sample_describe, srm1, srm2)
  SELECT 'ORG001', '01', '血液', 'XY', 'AB'
  WHERE NOT EXISTS (SELECT 1 FROM biz.lab_sample_types)
ON CONFLICT (org_lab, sample_type) DO NOTHING;

-- ============================================================
-- Phase 4: PostgREST 视图
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'lab_sample_types','lab_request_items','lab_request_item_tests','lab_request_item_children',
      'lab_test_items','lab_bio_items','lab_anti_items',
      'lab_specimens','lab_specimen_items','lab_specimen_barcode_items',
      'lab_test_reports','lab_report_result_items','lab_report_plant_items',
      'lab_report_anti_items','lab_report_bio_items','lab_report_images',
      'lab_sample_warnings','lab_warn_log_items',
      'lab_applications','lab_application_items',
      'lab_qc_data','lab_device_info'
    ])
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS ichse.%I CASCADE', tbl);
    EXECUTE format('CREATE VIEW ichse.%I AS SELECT * FROM biz.%I WHERE is_valid = true', tbl, tbl);
    EXECUTE format('GRANT SELECT ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT INSERT, UPDATE ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT USAGE ON SEQUENCE biz.%I_id_seq TO web_anon', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Phase 5: 更新 biz.interfaces.target_table
-- ============================================================

-- 字典表
UPDATE biz.interfaces SET target_table = 'lab_sample_types'  WHERE interface_id IN ('LAB-NX-MD-O001', 'LAB-NX-MD-I001');
UPDATE biz.interfaces SET target_table = 'lab_request_items' WHERE interface_id IN ('LAB-NX-MD-O002', 'LAB-NX-MD-I002');
UPDATE biz.interfaces SET target_table = 'lab_test_items'    WHERE interface_id IN ('LAB-NX-MD-O003', 'LAB-NX-MD-I003');
UPDATE biz.interfaces SET target_table = 'lab_bio_items'     WHERE interface_id IN ('LAB-NX-MD-O004', 'LAB-NX-MD-I004');
UPDATE biz.interfaces SET target_table = 'lab_anti_items'    WHERE interface_id IN ('LAB-NX-MD-O005', 'LAB-NX-MD-I005');

-- 标本（指向 L2 标本级）
UPDATE biz.interfaces SET target_table = 'lab_specimen_items' WHERE interface_id IN ('LAB-NX-SP-I001', 'LAB-NX-RC-O001', 'LAB-NX-RC-O002', 'LAB-NX-RC-I001', 'LAB-NX-RC-I002');

-- 报告
UPDATE biz.interfaces SET target_table = 'lab_test_reports'   WHERE interface_id IN ('LAB-NX-RP-O001', 'LAB-NX-RP-I001', 'LAB-NX-RP-I003', 'LAB-NX-RP-O003', 'LAB-NX-RP-I004');
UPDATE biz.interfaces SET target_table = 'lab_report_images'  WHERE interface_id IN ('LAB-NX-RP-O002', 'LAB-NX-RP-I002');

-- 危急值
UPDATE biz.interfaces SET target_table = 'lab_sample_warnings' WHERE interface_id LIKE 'LAB-NX-CV-%';

-- 申请
UPDATE biz.interfaces SET target_table = 'lab_applications'   WHERE interface_id LIKE 'LAB-NX-QR-%';

-- 质控/设备
UPDATE biz.interfaces SET target_table = 'lab_qc_data'        WHERE interface_id LIKE 'LAB-NX-QC-%';
UPDATE biz.interfaces SET target_table = 'lab_device_info'    WHERE interface_id LIKE 'LAB-NX-EQ-%';

-- 复杂写入接口改走 RPC（清空 target_table）
UPDATE biz.interfaces SET target_table = NULL, target_op = NULL
WHERE interface_id IN (
  'LAB-NX-SP-I001',   -- 标本送检 (L1+L2+L3)
  'LAB-NX-RP-O001',   -- 报告上传 (1+4 主子表)
  'LAB-NX-CV-O001',   -- 危急值上传 (1+1 主子表)
  'LAB-NX-QR-I002'    -- 申请提交 (1+1 主子表)
);

-- Cleanup
DROP TABLE IF EXISTS _mig_seed_sample_types;
