-- ============================================================
-- Migration 017: Report Review Workflow
-- Date: 2026-06-15
-- Depends on: 013, 014, 016
-- ============================================================
-- Implements dual-review (双人审核) workflow for lab reports.
-- Status machine: pending_first_review → pending_second_review → issued
-- Rejection resets to rejected; lab can resubmit via E01.
-- Cancel works from any non-terminal state.
-- ============================================================

-- 1. Data migration: existing 'submitted' reports → 'pending_first_review'
UPDATE biz.lab_test_reports SET rpt_status = 'pending_first_review' WHERE rpt_status = 'submitted';

-- 2. Add CHECK constraint on rpt_status
ALTER TABLE biz.lab_test_reports
  DROP CONSTRAINT IF EXISTS ck_lab_rpt_status;

ALTER TABLE biz.lab_test_reports
  ADD CONSTRAINT ck_lab_rpt_status CHECK (
    rpt_status IN ('pending_first_review', 'pending_second_review', 'issued', 'rejected', 'canceled')
  );

ALTER TABLE biz.lab_test_reports
  ALTER COLUMN rpt_status SET DEFAULT 'pending_first_review';

-- 3. Review audit log table
CREATE TABLE biz.lab_review_logs (
  id                serial PRIMARY KEY,
  report_id         int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  review_action     text NOT NULL,
  reviewer_doctor   text,
  reviewer_name     text,
  review_time       timestamptz DEFAULT now(),
  review_opinion    text,
  review_stage      text NOT NULL,
  is_valid          boolean DEFAULT true,
  version           int DEFAULT 1,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz DEFAULT NULL
);

CREATE INDEX idx_lab_rl_report_id ON biz.lab_review_logs(report_id);
CREATE INDEX idx_lab_rl_review_time ON biz.lab_review_logs(review_time);
CREATE INDEX idx_lab_rl_stage ON biz.lab_review_logs(review_stage);

COMMENT ON TABLE biz.lab_review_logs IS '报告审核日志 (E10/E11/E13)';

-- 4. PostgREST view
CREATE VIEW ichse.lab_review_logs AS
SELECT * FROM biz.lab_review_logs WHERE is_valid = true;

GRANT SELECT, INSERT ON ichse.lab_review_logs TO web_anon;
GRANT USAGE ON SEQUENCE biz.lab_review_logs_id_seq TO web_anon;

-- ============================================================
-- 5. Updated existing functions
-- ============================================================

-- 5a. E01: submit report → defaults to pending_first_review (includes Phase 1 col_org)
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
    payload->>'receiver', payload->>'receiverName', (payload->>'receiveTime')::timestamptz,
    (payload->>'concessionFlag')::int, payload->>'concessionReason',
    payload->>'collectingOrgCode', payload->>'collectingOrgName'
  ) RETURNING id INTO v_id;

  -- Record initial submission in review log
  INSERT INTO biz.lab_review_logs (report_id, review_action, review_time, review_stage)
  VALUES (v_id, 'submit', now(), 'first');

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

-- 5b. E08: cancel — accept wider status range
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e08_cancel_check_for_report(payload json)
RETURNS json AS $$
BEGIN
  UPDATE biz.lab_test_reports SET
    rpt_status = 'canceled',
    cnl_reason = payload->>'cancelReason', cnl_doctor = payload->>'executor', cnl_name = payload->>'executorName',
    cnl_time = (payload->>'executeDate')::timestamptz,
    cnl_section = payload->>'section', cnl_section_name = payload->>'sectionName',
    updated_at = now()
  WHERE sp_barcode = payload->>'doctAdviseNo'
    AND rpt_status IN ('pending_first_review', 'pending_second_review', 'issued')
    AND is_valid = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 400, 'message', '报告不存在或当前状态不允许撤销');
  END IF;

  -- Record cancel in review log
  INSERT INTO biz.lab_review_logs (report_id, review_action, reviewer_doctor, reviewer_name,
    review_time, review_stage)
  SELECT id, 'cancel', payload->>'executor', payload->>'executorName',
    COALESCE((payload->>'executeDate')::timestamptz, now()), 'cancel'
  FROM biz.lab_test_reports
  WHERE sp_barcode = payload->>'doctAdviseNo' AND is_valid = true;

  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5c. E03: get report — now includes rpt_status in output
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
        'rptStatus', tr.rpt_status,
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
        'concessionFlag', tr.cnc_flag, 'concessionReason', tr.cnc_reason,
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

-- ============================================================
-- 6. New PG functions for review workflow
-- ============================================================

-- 6a. E10: First review submission
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e10_submit_first_review(payload json)
RETURNS json AS $$
DECLARE
  v_report_int_id int;
  v_action text;
  v_current_status text;
BEGIN
  v_action := payload->>'action';

  SELECT id, rpt_status INTO v_report_int_id, v_current_status
  FROM biz.lab_test_reports
  WHERE rpt_id = payload->>'reportId' AND is_valid = true;

  IF v_report_int_id IS NULL THEN
    RETURN jsonb_build_object('code', 400, 'message', '报告不存在: ' || (payload->>'reportId'));
  END IF;

  IF v_current_status != 'pending_first_review' THEN
    RETURN jsonb_build_object('code', 400, 'message', '当前状态不允许一审: ' || v_current_status);
  END IF;

  INSERT INTO biz.lab_review_logs (report_id, review_action, reviewer_doctor, reviewer_name,
    review_time, review_opinion, review_stage)
  VALUES (v_report_int_id,
    CASE WHEN v_action = 'approve' THEN 'first_review_approve' ELSE 'first_reject' END,
    payload->>'reviewer', payload->>'reviewerName',
    COALESCE((payload->>'reviewTime')::timestamptz, now()),
    payload->>'reviewOpinion', 'first');

  UPDATE biz.lab_test_reports SET
    rpt_status = CASE WHEN v_action = 'approve' THEN 'pending_second_review' ELSE 'rejected' END,
    chk_doctor = COALESCE(payload->>'reviewer', chk_doctor),
    chk_name = COALESCE(payload->>'reviewerName', chk_name),
    chk_time = COALESCE((payload->>'reviewTime')::timestamptz, now()),
    chk_opinion = CASE
      WHEN v_action = 'approve' AND chk_opinion IS NOT NULL
      THEN chk_opinion || E'\n---\n一审: ' || COALESCE(payload->>'reviewOpinion', '')
      ELSE COALESCE(payload->>'reviewOpinion', chk_opinion)
    END,
    updated_at = now()
  WHERE id = v_report_int_id;

  RETURN jsonb_build_object('code', 200, 'message', 'success',
    'reportId', payload->>'reportId',
    'newStatus', CASE WHEN v_action = 'approve' THEN 'pending_second_review' ELSE 'rejected' END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6b. E11: Second review submission
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e11_submit_second_review(payload json)
RETURNS json AS $$
DECLARE
  v_report_int_id int;
  v_action text;
  v_current_status text;
  v_first_reviewer text;
  v_night_shift boolean;
BEGIN
  v_action := payload->>'action';
  v_night_shift := COALESCE((payload->>'nightShift')::boolean, false);

  SELECT id, rpt_status, chk_doctor INTO v_report_int_id, v_current_status, v_first_reviewer
  FROM biz.lab_test_reports
  WHERE rpt_id = payload->>'reportId' AND is_valid = true;

  IF v_report_int_id IS NULL THEN
    RETURN jsonb_build_object('code', 400, 'message', '报告不存在: ' || (payload->>'reportId'));
  END IF;

  IF v_current_status != 'pending_second_review' THEN
    RETURN jsonb_build_object('code', 400, 'message', '当前状态不允许二审: ' || v_current_status);
  END IF;

  IF NOT v_night_shift AND v_first_reviewer IS NOT NULL AND v_first_reviewer = payload->>'reviewer' THEN
    RETURN jsonb_build_object('code', 400, 'message', '二审与一审不能为同一人（夜班可例外）');
  END IF;

  INSERT INTO biz.lab_review_logs (report_id, review_action, reviewer_doctor, reviewer_name,
    review_time, review_opinion, review_stage)
  VALUES (v_report_int_id,
    CASE WHEN v_action = 'approve' THEN 'second_review_approve' ELSE 'second_reject' END,
    payload->>'reviewer', payload->>'reviewerName',
    COALESCE((payload->>'reviewTime')::timestamptz, now()),
    payload->>'reviewOpinion', 'second');

  UPDATE biz.lab_test_reports SET
    rpt_status = CASE WHEN v_action = 'approve' THEN 'issued' ELSE 'rejected' END,
    chk_doctor2 = COALESCE(payload->>'reviewer', chk_doctor2),
    chk_name2 = COALESCE(payload->>'reviewerName', chk_name2),
    updated_at = now()
  WHERE id = v_report_int_id;

  RETURN jsonb_build_object('code', 200, 'message', 'success',
    'reportId', payload->>'reportId',
    'newStatus', CASE WHEN v_action = 'approve' THEN 'issued' ELSE 'rejected' END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6c. E12: Get pending review queue
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e12_get_pending_reviews(payload json)
RETURNS json AS $$
DECLARE
  v_review_stage text;
  v_result jsonb;
BEGIN
  v_review_stage := payload->>'reviewStage';

  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'reportId', tr.rpt_id, 'doctAdviseNo', tr.sp_barcode, 'sampleNo', tr.sp_no,
        'patientName', tr.pt_name, 'patientId', tr.pt_id,
        'sex', tr.pt_sex, 'age', tr.pt_age, 'sampleType', tr.sp_type,
        'labOrg', tr.org_lab, 'sendingOrg', tr.org_sending, 'sendingOrgName', tr.org_sending_name,
        'reportTime', tr.created_at, 'rptStatus', tr.rpt_status,
        'checker', tr.chk_doctor, 'checkerName', tr.chk_name,
        'checker2', tr.chk_doctor2, 'checker2Name', tr.chk_name2,
        'concessionFlag', tr.cnc_flag, 'priority', tr.req_mode
      ) ORDER BY tr.req_mode ASC, tr.created_at ASC
    ) FILTER (WHERE tr.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_test_reports tr
  WHERE tr.is_valid = true
    AND tr.rpt_status = CASE
      WHEN v_review_stage = 'first' THEN 'pending_first_review'
      WHEN v_review_stage = 'second' THEN 'pending_second_review'
      ELSE tr.rpt_status
    END
    AND (payload->>'labOrg' IS NULL OR tr.org_lab = payload->>'labOrg')
    AND (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR tr.created_at >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR tr.created_at <= (payload->>'endDate')::date);

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6d. E13: Get review logs for a report
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e13_get_review_logs(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'reviewAction', rl.review_action,
        'reviewerDoctor', rl.reviewer_doctor,
        'reviewerName', rl.reviewer_name,
        'reviewTime', rl.review_time,
        'reviewOpinion', rl.review_opinion,
        'reviewStage', rl.review_stage
      ) ORDER BY rl.review_time
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_review_logs rl
  JOIN biz.lab_test_reports tr ON tr.id = rl.report_id
  WHERE tr.rpt_id = payload->>'reportId' AND rl.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Register new interfaces
-- ============================================================

INSERT INTO biz.interfaces
  (interface_id, platform, biz_domain, biz_category, category_code, biz_id,
   interface_name, func_name, direction, data_flow, http_method, url, description, target_table, target_op)
VALUES
  ('LAB-NX-RP-O004', 'NX', 'LAB', 'E.报告管理', 'RP', 'E10',
   '检验报告一审提交', 'lab_nx_rp_e10_submit_first_review', '临检中心方', 'O', 'POST',
   '/api/ygt/mdrs/v1/lis-center/rp/submitFirstReview',
   '检验中心一审审核报告，支持通过/驳回', NULL, NULL),
  ('LAB-NX-RP-O005', 'NX', 'LAB', 'E.报告管理', 'RP', 'E11',
   '检验报告二审提交', 'lab_nx_rp_e11_submit_second_review', '临检中心方', 'O', 'POST',
   '/api/ygt/mdrs/v1/lis-center/rp/submitSecondReview',
   '检验中心二审审核报告，校验同人约束（夜班可例外）', NULL, NULL),
  ('LAB-NX-RP-I005', 'NX', 'LAB', 'E.报告管理', 'RP', 'E12',
   '待审核报告查询', 'lab_nx_rp_e12_get_pending_reviews', '临检中心方', 'I', 'POST',
   '/api/ygt/mdrs/v1/lis-center/rp/getPendingReviews',
   '按一审/二审查询待审核报告队列', NULL, NULL),
  ('LAB-NX-RP-I006', 'NX', 'LAB', 'E.报告管理', 'RP', 'E13',
   '审核日志查询', 'lab_nx_rp_e13_get_review_logs', '临检中心方', 'I', 'POST',
   '/api/ygt/mdrs/v1/lis-center/rp/getReviewLogs',
   '按 reportId 查询报告的完整审核历史', NULL, NULL)
ON CONFLICT (interface_id) DO UPDATE SET
  func_name = EXCLUDED.func_name, url = EXCLUDED.url,
  description = EXCLUDED.description, updated_at = now();

-- ============================================================
-- 8. Grant execute on new functions
-- ============================================================

GRANT EXECUTE ON FUNCTION ichse.lab_nx_rp_e10_submit_first_review(json) TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.lab_nx_rp_e11_submit_second_review(json) TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.lab_nx_rp_e12_get_pending_reviews(json) TO web_anon;
GRANT EXECUTE ON FUNCTION ichse.lab_nx_rp_e13_get_review_logs(json) TO web_anon;
