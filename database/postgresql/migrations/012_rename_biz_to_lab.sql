-- ============================================================
-- Migration 012: Rename biz tables → lab_ prefix (per v2.0 conventions)
-- Date: 2026-06-13
-- Depends on: 011_biz_business_tables.sql
-- ============================================================
-- Converts:
--   biz.sample_types    → biz.lab_sample_types
--   biz.request_items   → biz.lab_request_items
--   biz.test_items      → biz.lab_test_items
--   biz.bio_items       → biz.lab_bio_items
--   biz.anti_items      → biz.lab_anti_items
--   biz.specimens       → biz.lab_specimens
--   biz.test_reports    → biz.lab_test_reports
--   biz.report_images   → biz.lab_report_images
--   biz.sample_warnings → biz.lab_sample_warnings
--   biz.qc_data         → biz.lab_qc_data
--   biz.device_info     → biz.lab_device_info
--   biz.applications    → biz.lab_applications
--
-- Adds biz.interfaces.biz_domain, updates interface_id (NX-* → LAB-DEMO-*)
-- Renames all PG functions: nx_* → lab_demo_*
-- Recreates PostgREST views as ichse.lab_*
-- ============================================================

-- ============================================================
-- Phase 1: Update interfaces table
-- ============================================================

-- Add biz_domain column
ALTER TABLE biz.interfaces ADD COLUMN IF NOT EXISTS biz_domain text;
UPDATE biz.interfaces SET biz_domain = 'LAB' WHERE biz_domain IS NULL;
ALTER TABLE biz.interfaces ALTER COLUMN biz_domain SET NOT NULL;

-- Update interface_id: NX-* → LAB-DEMO-*
UPDATE biz.interfaces SET interface_id = 'LAB-' || interface_id
WHERE interface_id NOT LIKE 'LAB-%';

-- Update func_name: nx_* → lab_demo_*
UPDATE biz.interfaces SET func_name = 'lab_' || func_name
WHERE func_name LIKE 'nx_%' AND func_name NOT LIKE 'lab_%';

-- Update target_table: sample_types → lab_sample_types, etc.
UPDATE biz.interfaces SET target_table = 'lab_' || target_table
WHERE target_table IS NOT NULL AND target_table NOT LIKE 'lab_%';

-- ============================================================
-- Phase 2: Drop old ichse views
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['sample_types','request_items','test_items','bio_items','anti_items',
      'specimens','test_reports','report_images','sample_warnings','qc_data','device_info','applications'])
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS ichse.%I CASCADE', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Phase 3: Rename biz tables
-- ============================================================

-- Drop FK first (report_images → test_reports)
ALTER TABLE biz.report_images DROP CONSTRAINT IF EXISTS report_images_report_id_fkey;

-- Rename tables that have no dependent FKs
ALTER TABLE biz.sample_types    RENAME TO lab_sample_types;
ALTER TABLE biz.request_items   RENAME TO lab_request_items;
ALTER TABLE biz.test_items      RENAME TO lab_test_items;
ALTER TABLE biz.bio_items       RENAME TO lab_bio_items;
ALTER TABLE biz.anti_items      RENAME TO lab_anti_items;
ALTER TABLE biz.specimens       RENAME TO lab_specimens;
ALTER TABLE biz.test_reports    RENAME TO lab_test_reports;
ALTER TABLE biz.report_images   RENAME TO lab_report_images;
ALTER TABLE biz.sample_warnings RENAME TO lab_sample_warnings;
ALTER TABLE biz.qc_data         RENAME TO lab_qc_data;
ALTER TABLE biz.device_info     RENAME TO lab_device_info;
ALTER TABLE biz.applications    RENAME TO lab_applications;

-- Recreate FK: lab_report_images → lab_test_reports
ALTER TABLE biz.lab_report_images
  ADD CONSTRAINT lab_report_images_report_id_fkey
  FOREIGN KEY (report_id) REFERENCES biz.lab_test_reports(id);

-- Rename sequences to match
ALTER SEQUENCE IF EXISTS biz.sample_types_id_seq    RENAME TO lab_sample_types_id_seq;
ALTER SEQUENCE IF EXISTS biz.request_items_id_seq   RENAME TO lab_request_items_id_seq;
ALTER SEQUENCE IF EXISTS biz.test_items_id_seq      RENAME TO lab_test_items_id_seq;
ALTER SEQUENCE IF EXISTS biz.bio_items_id_seq       RENAME TO lab_bio_items_id_seq;
ALTER SEQUENCE IF EXISTS biz.anti_items_id_seq      RENAME TO lab_anti_items_id_seq;
ALTER SEQUENCE IF EXISTS biz.specimens_id_seq       RENAME TO lab_specimens_id_seq;
ALTER SEQUENCE IF EXISTS biz.test_reports_id_seq    RENAME TO lab_test_reports_id_seq;
ALTER SEQUENCE IF EXISTS biz.report_images_id_seq   RENAME TO lab_report_images_id_seq;
ALTER SEQUENCE IF EXISTS biz.sample_warnings_id_seq RENAME TO lab_sample_warnings_id_seq;
ALTER SEQUENCE IF EXISTS biz.qc_data_id_seq         RENAME TO lab_qc_data_id_seq;
ALTER SEQUENCE IF EXISTS biz.device_info_id_seq     RENAME TO lab_device_info_id_seq;
ALTER SEQUENCE IF EXISTS biz.applications_id_seq    RENAME TO lab_applications_id_seq;

-- Rename indexes
ALTER INDEX IF EXISTS idx_specimens_barcode RENAME TO idx_lab_specimens_barcode;

-- Rename unique constraints
ALTER TABLE biz.lab_sample_types RENAME CONSTRAINT uq_sample_types TO uq_lab_sample_types;

-- ============================================================
-- Phase 4: Rename PG functions (nx_* → lab_demo_*)
-- ============================================================
DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  FOR r IN
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'ichse' AND proname LIKE 'nx_%'
  LOOP
    new_name := 'lab_' || r.proname;
    EXECUTE format('ALTER FUNCTION ichse.%I(json) RENAME TO %I', r.proname, new_name);
  END LOOP;
END $$;

-- Update the one non-stub function that references biz.sample_types
CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a07_get_sample_type(json)
RETURNS json AS $$
DECLARE
  v_center_org text;
  v_result     jsonb;
BEGIN
  v_center_org := $1->>'centerOrg';

  IF v_center_org IS NULL OR v_center_org = '' THEN
    RETURN jsonb_build_object(
      'code', 400,
      'message', 'centerOrg 不能为空'
    )::json;
  END IF;

  SELECT jsonb_build_object(
    'code', 200,
    'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'sampleType', st.sample_type,
        'sampleDescribe', st.sample_describe,
        'srm1', st.srm1,
        'srm2', st.srm2
      )
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_sample_types st
  WHERE st.lab_org = v_center_org
    AND st.is_valid = true;

  RETURN v_result::json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Phase 5: Recreate PostgREST views as ichse.lab_*
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['lab_sample_types','lab_request_items','lab_test_items','lab_bio_items','lab_anti_items',
      'lab_specimens','lab_test_reports','lab_report_images','lab_sample_warnings','lab_qc_data','lab_device_info','lab_applications'])
  LOOP
    EXECUTE format('CREATE VIEW ichse.%I AS SELECT * FROM biz.%I WHERE is_valid = true', tbl, tbl);
    EXECUTE format('GRANT SELECT ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT INSERT, UPDATE ON ichse.%I TO web_anon', tbl);
    EXECUTE format('GRANT USAGE ON SEQUENCE biz.%I_id_seq TO web_anon', tbl);
  END LOOP;
END $$;
