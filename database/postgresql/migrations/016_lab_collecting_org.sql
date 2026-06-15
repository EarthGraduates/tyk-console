-- ============================================================
-- Migration 016: Collecting Org Separation
-- Date: 2026-06-15
-- Depends on: 013, 014
-- ============================================================
-- Adds collecting org fields to application and report tables,
-- and updates associated PG functions to read/write them.
-- The specimen chain (lab_specimens, lab_specimen_items, B02, D01)
-- already fully supports collecting org separation.
-- ============================================================

-- 1a. Add columns to biz.lab_applications
ALTER TABLE biz.lab_applications
  ADD COLUMN IF NOT EXISTS col_org_code text,
  ADD COLUMN IF NOT EXISTS col_org_name text;

COMMENT ON COLUMN biz.lab_applications.col_org_code IS '采集机构代码 (fg_entrustcollect=1时必填)';
COMMENT ON COLUMN biz.lab_applications.col_org_name IS '采集机构名称';

-- 1b. Add columns to biz.lab_test_reports
ALTER TABLE biz.lab_test_reports
  ADD COLUMN IF NOT EXISTS col_org_code text,
  ADD COLUMN IF NOT EXISTS col_org_name text;

COMMENT ON COLUMN biz.lab_test_reports.col_org_code IS '采集机构代码';
COMMENT ON COLUMN biz.lab_test_reports.col_org_name IS '采集机构名称';

-- 1c. Indexes
CREATE INDEX IF NOT EXISTS idx_lab_app_col_org ON biz.lab_applications(col_org_code);
CREATE INDEX IF NOT EXISTS idx_lab_reports_col_org ON biz.lab_test_reports(col_org_code);

-- ============================================================
-- 2. Update PG functions
-- ============================================================

-- 2a. P02: submit application — write collecting org
CREATE OR REPLACE FUNCTION ichse.lab_nx_qr_p02_submit_application(payload json)
RETURNS json AS $$
DECLARE
  v_id int;
  v_x jsonb;
BEGIN
  INSERT INTO biz.lab_applications (application_id, org_sending, sp_barcode,
    pt_name, pt_sex, pt_age, pt_id, pt_phone, pt_type, pt_diagnostic, pt_bed_no, pt_ward_name,
    req_section_name, req_mode, req_doctor, req_time, status, send_flag,
    col_org_code, col_org_name)
  VALUES (payload->>'applicationId', payload->>'sendingOrg', payload->>'doctAdviseNo',
    payload->>'patientName', payload->>'sex', payload->>'age', payload->>'patientId',
    payload->>'patientPhone', payload->>'patientType', payload->>'diagnostic', payload->>'bedNo', payload->>'wardName',
    payload->>'sectionName', payload->>'requestMode', payload->>'requester',
    (payload->>'requestTime')::timestamptz, payload->>'status', (payload->>'sendFlag')::int,
    payload->>'collectingOrgCode', payload->>'collectingOrgName')
  ON CONFLICT (application_id) DO UPDATE SET
    status = EXCLUDED.status, send_flag = EXCLUDED.send_flag,
    col_org_code = EXCLUDED.col_org_code, col_org_name = EXCLUDED.col_org_name,
    updated_at = now()
  RETURNING id INTO v_id;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'itemInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_application_items (application_id, req_item_code, req_item_name,
      compose_type, sp_type, req_mode, req_doctor, preparation_note)
    VALUES (v_id, v_x->>'itemCode', v_x->>'itemName',
      v_x->>'composeType', v_x->>'sampleType', v_x->>'requestMode', v_x->>'requester', v_x->>'preparationNote');
  END LOOP;

  RETURN jsonb_build_object('code', 200, 'message', 'success', 'applicationId', payload->>'applicationId');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2b. P01: get application list — output collecting org
CREATE OR REPLACE FUNCTION ichse.lab_nx_qr_p01_get_application_list(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'applicationId', a.application_id, 'doctAdviseNo', a.sp_barcode,
        'patientName', a.pt_name, 'sex', a.pt_sex, 'age', a.pt_age, 'patientId', a.pt_id,
        'patientPhone', a.pt_phone, 'patientType', a.pt_type, 'diagnostic', a.pt_diagnostic,
        'sectionName', a.req_section_name, 'wardName', a.pt_ward_name, 'bedNo', a.pt_bed_no,
        'status', a.status, 'requestMode', a.req_mode, 'requester', a.req_doctor,
        'requestTime', a.req_time, 'acceptTime', a.accept_time, 'reason', a.reason,
        'collectingOrgCode', a.col_org_code, 'collectingOrgName', a.col_org_name,
        'itemInfoList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'itemCode', ai.req_item_code, 'itemName', ai.req_item_name,
            'composeType', ai.compose_type, 'sampleType', ai.sp_type,
            'requestMode', ai.req_mode, 'requester', ai.req_doctor, 'preparationNote', ai.preparation_note
          )) FROM biz.lab_application_items ai
          WHERE ai.application_id = a.id AND ai.is_valid = true
        ), '[]'::jsonb)
      )
    ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_applications a
  WHERE (payload->>'sendingOrg' IS NULL OR a.org_sending = payload->>'sendingOrg')
    AND (payload->>'doctAdviseNo' IS NULL OR a.sp_barcode = payload->>'doctAdviseNo')
    AND (payload->>'status' IS NULL OR a.status = payload->>'status')
    AND (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR a.req_time >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR a.req_time <= (payload->>'endDate')::date)
    AND a.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2c. E01: submit report — write collecting org
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e01_submit_report(payload json)
RETURNS json AS $$
DECLARE
  v_id int;
  v_x jsonb;
BEGIN
  INSERT INTO biz.lab_test_reports (
    rpt_id, sp_barcode, sp_no, sp_type, sp_describe,
    org_lab, org_sending, org_sending_name,
    pt_name, pt_sex, pt_age, pt_age_unit, pt_birthday, pt_id,
    pt_medicalcard_id, pt_properties, pt_type, pt_diagnostic, pt_diagnostic_code, pt_toponymy,
    req_section, req_section_name, req_mode, req_examinaim, req_examinaim_code,
    chk_doctor, chk_name, chk_doctor2, chk_name2, chk_time, chk_opinion, chk_section, chk_section_name,
    rec_doctor, rec_name, rec_time,
    cnc_flag, cnc_reason,
    col_org_code, col_org_name
  ) VALUES (
    payload->>'reportId', payload->>'doctAdviseNo', payload->>'sampleNo', payload->>'sampleType', payload->>'sampleDescribe',
    payload->>'labOrg', payload->>'sendingOrg', payload->>'sendingOrgName',
    payload->>'patientName', (payload->>'sex')::int, (payload->>'age')::int, (payload->>'ageUnit')::int,
    (payload->>'birthday')::date, payload->>'patientId',
    payload->>'medicalcardId', payload->>'patientProperties', (payload->>'patientType')::int,
    payload->>'diagnostic', payload->>'diagnosticCode', payload->>'toponymy',
    payload->>'section', payload->>'sectionName', (payload->>'requestMode')::int,
    payload->>'examinaim', payload->>'examinaimCode',
    payload->>'checker', payload->>'checkerName', payload->>'checker2', payload->>'checker2Name',
    (payload->>'checkTime')::timestamptz, payload->>'checkerOpinion', payload->>'section', payload->>'sectionName',
    payload->>'receiver', payload->>'receiverName', (payload->>'receiveTime')::timestamptz,
    (payload->>'concessionFlag')::int, payload->>'concessionReason',
    payload->>'collectingOrgCode', payload->>'collectingOrgName'
  ) RETURNING id INTO v_id;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'resultInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_report_result_items (report_id, sp_no, test_id, hos_test_id, chinese_name,
      test_result, ref_range, ref_lo, ref_hi, measure_time, hint, unit)
    VALUES (v_id, v_x->>'sampleNo', v_x->>'testId', v_x->>'hosTestId', v_x->>'chineseName',
      v_x->>'testResult', v_x->>'refRange', v_x->>'refLo', v_x->>'refHi',
      (v_x->>'measureTime')::timestamptz, v_x->>'hint', v_x->>'unit');
  END LOOP;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'plantInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_report_plant_items (report_id, sp_no, test_id, hos_test_id, chinese_name,
      test_result, result_type, plant_type, plant_remark)
    VALUES (v_id, v_x->>'sampleNo', v_x->>'testId', v_x->>'hosTestId', v_x->>'chineseName',
      v_x->>'testResult', (v_x->>'resultType')::int, (v_x->>'plantType')::int, v_x->>'plantRemark');
  END LOOP;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'antiInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_report_anti_items (report_id, sp_no, anti_id, anti_name,
      bio_id, bio_name, bio_type, kb_result, mic_result, etest_result, test_result, method, print_ord)
    VALUES (v_id, v_x->>'sampleNo', v_x->>'antiId', v_x->>'antiName',
      v_x->>'bioId', v_x->>'bioName', (v_x->>'bioType')::int,
      v_x->>'kbResult', v_x->>'micResult', v_x->>'etestResult',
      v_x->>'testResult', (v_x->>'method')::int, (v_x->>'printOrd')::int);
  END LOOP;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'bioInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_report_bio_items (report_id, sp_no, bio_id, bio_name,
      bio_type, bio_quantity, spectrum, measure_time, remark)
    VALUES (v_id, v_x->>'sampleNo', v_x->>'bioId', v_x->>'bioName',
      (v_x->>'bioType')::int, v_x->>'bioQuantity', v_x->>'spectrum',
      (v_x->>'measureTime')::timestamptz, v_x->>'remark');
  END LOOP;

  RETURN jsonb_build_object('code', 200, 'message', 'success', 'reportId', payload->>'reportId');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2d. E03: get report — output collecting org
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e03_get_lab_report(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'labOrg', tr.org_lab, 'sendingOrg', tr.org_sending,
        'sendingOrgName', tr.org_sending_name,
        'reportId', tr.rpt_id, 'sampleNo', tr.sp_no, 'doctAdviseNo', tr.sp_barcode,
        'receiveTime', tr.rec_time, 'receiver', tr.rec_doctor, 'receiverName', tr.rec_name,
        'patientType', tr.pt_type, 'patientId', tr.pt_id, 'patientName', tr.pt_name,
        'sex', tr.pt_sex, 'birthday', tr.pt_birthday, 'age', tr.pt_age, 'ageUnit', tr.pt_age_unit,
        'diagnostic', tr.pt_diagnostic, 'toponymy', tr.pt_toponymy,
        'examinaim', tr.req_examinaim, 'requestMode', tr.req_mode,
        'checker', tr.chk_doctor, 'checkerName', tr.chk_name,
        'checker2', tr.chk_doctor2, 'checker2Name', tr.chk_name2,
        'checkerOpinion', tr.chk_opinion, 'notes', tr.chk_opinion,
        'checkTime', tr.chk_time,
        'section', tr.chk_section, 'sectionName', tr.chk_section_name,
        'sampleType', tr.sp_type, 'sampleDescribe', tr.sp_describe,
        'resultStatus', tr.rpt_result_status,
        'collectingOrgCode', tr.col_org_code, 'collectingOrgName', tr.col_org_name,
        'resultInfoList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'sampleNo', ri.sp_no, 'testId', ri.test_id, 'hosTestId', ri.hos_test_id,
            'chineseName', ri.chinese_name, 'testResult', ri.test_result,
            'refRange', ri.ref_range, 'refLo', ri.ref_lo, 'refHi', ri.ref_hi,
            'measureTime', ri.measure_time, 'hint', ri.hint, 'unit', ri.unit
          )) FROM biz.lab_report_result_items ri
          WHERE ri.report_id = tr.id AND ri.is_valid = true
        ), '[]'::jsonb),
        'plantInfoList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'sampleNo', pi.sp_no, 'testId', pi.test_id, 'hosTestId', pi.hos_test_id,
            'chineseName', pi.chinese_name, 'testResult', pi.test_result,
            'resultType', pi.result_type, 'plantType', pi.plant_type, 'plantRemark', pi.plant_remark
          )) FROM biz.lab_report_plant_items pi
          WHERE pi.report_id = tr.id AND pi.is_valid = true
        ), '[]'::jsonb),
        'antiInfoList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'sampleNo', ai.sp_no, 'antiId', ai.anti_id, 'antiName', ai.anti_name,
            'bioId', ai.bio_id, 'bioName', ai.bio_name, 'bioType', ai.bio_type,
            'kbResult', ai.kb_result, 'micResult', ai.mic_result, 'etestResult', ai.etest_result,
            'testResult', ai.test_result, 'method', ai.method, 'printOrd', ai.print_ord
          )) FROM biz.lab_report_anti_items ai
          WHERE ai.report_id = tr.id AND ai.is_valid = true
        ), '[]'::jsonb),
        'bioInfoList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'sampleNo', bi.sp_no, 'bioId', bi.bio_id, 'bioName', bi.bio_name,
            'bioType', bi.bio_type, 'bioQuantity', bi.bio_quantity,
            'spectrum', bi.spectrum, 'measureTime', bi.measure_time, 'remark', bi.remark
          )) FROM biz.lab_report_bio_items bi
          WHERE bi.report_id = tr.id AND bi.is_valid = true
        ), '[]'::jsonb)
      )
    ) FILTER (WHERE tr.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_test_reports tr
  WHERE tr.sp_barcode = payload->>'doctAdviseNo' AND tr.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
