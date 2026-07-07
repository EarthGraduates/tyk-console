-- ============================================================
-- Migration 014: v2.0 PG Functions — 36 接口完整实现
-- 日期: 2026-06-13
-- 依赖: 013_v2_lab_tables.sql
-- 说明: 所有函数接收 jsonb 参数，内部做字段映射（接口名→DB列名）
--       写入函数在同一事务内完成主子表 INSERT
--       读取函数 JOIN 子表后用 jsonb_agg 组装回原始嵌套格式
-- ============================================================

-- ============================================================
-- 1. 字典上传 (MD-O001..O005)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a01_upload_sample_type(payload json)
RETURNS json AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_sample_types (org_lab, sample_type, sample_describe, srm1, srm2)
    VALUES (payload->>'labOrg', r->>'sampleType', r->>'sampleDescribe', r->>'srm1', r->>'srm2')
    ON CONFLICT (org_lab, sample_type) DO UPDATE SET
      sample_describe = EXCLUDED.sample_describe,
      srm1 = COALESCE(EXCLUDED.srm1, lab_sample_types.srm1),
      srm2 = COALESCE(EXCLUDED.srm2, lab_sample_types.srm2),
      updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a02_upload_request_item(payload json)
RETURNS json AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_request_items (org_lab, req_item_code, req_item_name, bill_price, used_now, srm1, srm2, sp_type, sp_describe, compose_type)
    VALUES (payload->>'labOrg', r->>'itemCode', r->>'itemName',
            (r->>'itemPrice')::numeric, (r->>'usedNow')::int, r->>'srm1', r->>'srm2',
            r->>'sampleType', r->>'sampleDescribe', r->>'composeType')
    ON CONFLICT (org_lab, req_item_code) DO UPDATE SET
      req_item_name = EXCLUDED.req_item_name, bill_price = COALESCE(EXCLUDED.bill_price, lab_request_items.bill_price),
      updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a03_upload_test_item(payload json)
RETURNS json AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_test_items (org_lab, test_id, chinese_name, english_ab, english_name, method_name, srm1, srm2, sp_type, sp_describe, unit)
    VALUES (payload->>'labOrg', r->>'testId', r->>'chineseName', r->>'englishAb', r->>'englishName',
            r->>'methodName', r->>'srm1', r->>'srm2', r->>'sampleType', r->>'sampleDescribe', r->>'unit')
    ON CONFLICT (org_lab, test_id) DO UPDATE SET
      chinese_name = EXCLUDED.chinese_name, updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a04_upload_bio_item(payload json)
RETURNS json AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_bio_items (org_lab, bio_id, fabio_id, fabio_name, english_name, english_ab, chinese_name, bio_type, srm1, srm2)
    VALUES (payload->>'labOrg', r->>'bioId', r->>'fabioId', r->>'fabioName', r->>'englishName', r->>'englishAb',
            r->>'chineseName', (r->>'bioType')::int, r->>'srm1', r->>'srm2')
    ON CONFLICT (org_lab, bio_id) DO UPDATE SET
      chinese_name = EXCLUDED.chinese_name, updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a05_upload_anti_item(payload json)
RETURNS json AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_anti_items (org_lab, anti_id, faanti_id, faanti_name, english_name, english_ab, chinese_name, srm1, srm2)
    VALUES (payload->>'labOrg', r->>'antiId', r->>'faantiId', r->>'faantiName', r->>'englishName', r->>'englishAb',
            r->>'chineseName', r->>'srm1', r->>'srm2')
    ON CONFLICT (org_lab, anti_id) DO UPDATE SET
      chinese_name = EXCLUDED.chinese_name, updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. 字典下载 (MD-I001..I005)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a07_get_sample_type(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  IF payload->>'centerOrg' IS NULL OR payload->>'centerOrg' = '' THEN
    RETURN jsonb_build_object('code', 400, 'message', 'centerOrg is required');
  END IF;
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('sampleType', st.sample_type, 'sampleDescribe', st.sample_describe,
                         'srm1', st.srm1, 'srm2', st.srm2)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_sample_types st
  WHERE st.org_lab = payload->>'centerOrg' AND st.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a08_get_request_item(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('itemCode', ri.req_item_code, 'itemName', ri.req_item_name,
        'itemPrice', ri.bill_price, 'usedNow', ri.used_now, 'srm1', ri.srm1, 'srm2', ri.srm2,
        'sampleType', ri.sp_type, 'sampleDescribe', ri.sp_describe, 'composeType', ri.compose_type)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_request_items ri
  WHERE ri.org_lab = payload->>'centerOrg' AND ri.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a09_get_test_item(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('testId', ti.test_id, 'chineseName', ti.chinese_name,
        'englishAb', ti.english_ab, 'englishName', ti.english_name, 'methodName', ti.method_name,
        'srm1', ti.srm1, 'srm2', ti.srm2, 'sampleType', ti.sp_type, 'sampleDescribe', ti.sp_describe, 'unit', ti.unit)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_test_items ti
  WHERE ti.org_lab = payload->>'centerOrg' AND ti.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a10_get_bio_item(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('bioId', bi.bio_id, 'fabioId', bi.fabio_id, 'fabioName', bi.fabio_name,
        'englishName', bi.english_name, 'englishAb', bi.english_ab, 'chineseName', bi.chinese_name,
        'bioType', bi.bio_type, 'srm1', bi.srm1, 'srm2', bi.srm2)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_bio_items bi
  WHERE bi.org_lab = payload->>'centerOrg' AND bi.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_md_a11_get_anti_item(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('antiId', ai.anti_id, 'faantiId', ai.faanti_id, 'faantiName', ai.faanti_name,
        'englishName', ai.english_name, 'englishAb', ai.english_ab, 'chineseName', ai.chinese_name,
        'srm1', ai.srm1, 'srm2', ai.srm2)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_anti_items ai
  WHERE ai.org_lab = payload->>'centerOrg' AND ai.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. 标本 (SP / RC)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_sp_b02_external_specimen(payload json)
RETURNS json AS $$
DECLARE
  v_spec_id int;
  v_item_id int;
  v_si jsonb;
  v_bi jsonb;
BEGIN
  INSERT INTO biz.lab_specimens (packet_id, org_sending, org_center, col_org_code, col_org_name,
    col_doctor, col_name, col_time, send_flag)
  VALUES (payload->>'packetId', payload->>'sendingOrg', payload->>'centerOrg',
    payload->>'collectingOrgCode', payload->>'collectingOrgName',
    payload->>'sender', payload->>'senderName', (payload->>'sendDate')::timestamptz, payload->>'sendFlag')
  RETURNING id INTO v_spec_id;

  FOR v_si IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_specimen_items (specimen_id,
      sp_barcode, sp_old_barcode, sp_no, sp_type, sp_describe, sp_toponymy, sp_examinaim, sp_notes, sp_entrust_collect,
      pt_name, pt_sex, pt_age, pt_age_unit, pt_birthday, pt_id, pt_id_card, pt_phone,
      pt_type, pt_properties, pt_diagnostic, pt_infant_flag, pt_source_id, pt_visit_id,
      pt_bed_no, pt_ward_code, pt_ward_name,
      req_doctor, req_name, req_time, req_section, req_section_name, req_mode, req_ward_code, req_ward_name,
      col_doctor, col_name, col_time, col_org_code, col_org_name)
    VALUES (v_spec_id,
      v_si->>'doctAdviseNo', v_si->>'oldBarcode', v_si->>'sampleNo', v_si->>'sampleType', v_si->>'sampleDescribe',
      v_si->>'toponymy', v_si->>'examinaim', v_si->>'notes', (v_si->>'fg_entrustcollect')::int,
      v_si->>'patientName', (v_si->>'sex')::int, (v_si->>'age')::int, (v_si->>'ageUnit')::int,
      (v_si->>'birthday')::date, v_si->>'patientId', v_si->>'idCard', v_si->>'patientPhone',
      (v_si->>'patientType')::int, v_si->>'patientProperties', v_si->>'diagnostic',
      (v_si->>'infantFlag')::int, v_si->>'sourcePatientId', v_si->>'visitId',
      v_si->>'bedNo', v_si->>'wardCode', v_si->>'wardName',
      v_si->>'requester', v_si->>'requestName', (v_si->>'requestTime')::timestamptz,
      v_si->>'section', v_si->>'sectionName', (v_si->>'requestMode')::int,
      v_si->>'wardCode', v_si->>'wardName',
      v_si->>'executor', v_si->>'executorName', (v_si->>'executeTime')::timestamptz,
      v_si->>'collectingOrgCode', v_si->>'collectingOrgName')
    RETURNING id INTO v_item_id;

    FOR v_bi IN SELECT * FROM jsonb_array_elements((v_si->'barcodeDetailList')::jsonb)
    LOOP
      INSERT INTO biz.lab_specimen_barcode_items (specimen_item_id, sp_barcode, org_sending,
        bill_item_code, bill_child_code, bill_price, bill_number, bill_name, bill_child_name)
      VALUES (v_item_id, v_bi->>'doctAdviseNo', v_bi->>'sendingOrg',
        v_bi->>'itemCode', v_bi->>'childItemCode', (v_bi->>'costPrice')::numeric,
        (v_bi->>'costNumber')::int, v_bi->>'costName', v_bi->>'childItemName');
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('code', 200, 'message', 'success', 'packetId', payload->>'packetId');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rc_d01_get_doct_advise_by_barcode(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'doctAdviseNo', si.sp_barcode, 'oldBarcode', si.sp_old_barcode,
        'sendingOrgName', s.org_sending, 'sendingOrg', s.org_sending,
        'requester', si.req_doctor, 'requestName', si.req_name, 'requestTime', si.req_time,
        'section', si.req_section, 'sectionName', si.req_section_name,
        'wardCode', si.req_ward_code, 'wardName', si.req_ward_name, 'bedNo', si.pt_bed_no,
        'patientType', si.pt_type, 'patientProperties', si.pt_properties,
        'patientId', si.pt_id, 'patientName', si.pt_name, 'sex', si.pt_sex,
        'birthday', si.pt_birthday, 'age', si.pt_age, 'ageUnit', si.pt_age_unit,
        'sampleType', si.sp_type, 'sampleDescribe', si.sp_describe, 'toponymy', si.sp_toponymy,
        'examinaim', si.sp_examinaim, 'requestMode', si.req_mode,
        'executeTime', si.col_time, 'executor', si.col_doctor, 'executorName', si.col_name,
        'notes', si.sp_notes, 'diagnostic', si.pt_diagnostic, 'infantFlag', si.pt_infant_flag,
        'idCard', si.pt_id_card, 'patientPhone', si.pt_phone, 'sourcePatientId', si.pt_source_id,
        'sampleStatus', si.sp_status, 'sender', s.col_doctor, 'sendDate', s.col_time,
        'visitId', si.pt_visit_id,
        'collectingOrgCode', si.col_org_code, 'collectingOrgName', si.col_org_name
      )
    ) FILTER (WHERE si.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_specimen_items si
  JOIN biz.lab_specimens s ON s.id = si.specimen_id
  WHERE si.sp_barcode = payload->>'doctAdviseNo' AND si.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rc_d02_receive_specimen(payload json)
RETURNS json AS $$
BEGIN
  UPDATE biz.lab_specimen_items SET
    rec_doctor = payload->>'receiver', rec_name = payload->>'receiverName',
    rec_time = (payload->>'receiveTime')::timestamptz, rec_flag = payload->>'receiveFlag',
    rec_status = (payload->>'status')::int,
    sp_status = CASE WHEN (payload->>'status')::int = 3 THEN 'rejected' ELSE 'received' END,
    rec_reject_reason = payload->>'reason', updated_at = now()
  WHERE sp_barcode = payload->>'doctAdviseNo' AND is_valid = true;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rc_d03_get_receive_sample_status(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('doctAdviseNo', si.sp_barcode, 'labOrg', s.org_center,
        'status', si.rec_status, 'reason', si.rec_reject_reason,
        'executor', si.rec_doctor, 'executorName', si.rec_name, 'executeDate', si.rec_time)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_specimen_items si
  JOIN biz.lab_specimens s ON s.id = si.specimen_id
  WHERE (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR si.rec_time >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR si.rec_time <= (payload->>'endDate')::date)
    AND (payload->>'sendingOrg' IS NULL OR s.org_sending = payload->>'sendingOrg')
    AND si.is_valid = true AND si.rec_time IS NOT NULL;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rc_d04_get_sample_back(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('labOrg', s.org_center, 'doctAdviseNo', si.sp_barcode,
        'reason', si.unqual_reason, 'executor', si.unqual_doctor, 'executorName', si.unqual_name,
        'executeDate', si.unqual_time, 'section', si.unqual_section, 'sectionName', si.unqual_section_name)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_specimen_items si
  JOIN biz.lab_specimens s ON s.id = si.specimen_id
  WHERE (payload->>'sendingOrg' IS NULL OR s.org_sending = payload->>'sendingOrg')
    AND (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR si.unqual_time >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR si.unqual_time <= (payload->>'endDate')::date)
    AND si.is_valid = true AND si.unqual_time IS NOT NULL;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. 检验报告 (RP)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e01_submit_report(payload json)
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
    cnc_flag, cnc_reason
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
    (payload->>'concessionFlag')::int, payload->>'concessionReason'
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

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e02_upload_image_info(payload json)
RETURNS json AS $$
DECLARE
  v_report_int_id int;
  v_x jsonb;
BEGIN
  SELECT id INTO v_report_int_id FROM biz.lab_test_reports
  WHERE rpt_id = payload->>'reportId' AND is_valid = true;

  IF v_report_int_id IS NULL THEN
    RETURN jsonb_build_object('code', 400, 'message', '报告不存在: ' || (payload->>'reportId'));
  END IF;

  FOR v_x IN SELECT * FROM jsonb_array_elements((payload->'imageInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_report_images (report_id, org_lab, sp_barcode, sp_no,
      report_type, pic_no, image_text, format, image_url)
    VALUES (v_report_int_id, payload->>'labOrg', payload->>'doctAdviseNo', v_x->>'sampleNo',
      (payload->>'reportType')::int, (payload->>'picNo')::int, v_x->>'imageText', v_x->>'format',
      v_x->>'imageUrl');
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e03_get_lab_report(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'labOrg', tr.org_lab, 'sendingOrg', tr.org_sending,
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

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e04_get_image_info(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'imageInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('sampleNo', ri.sp_no, 'imageText', ri.image_text, 'format', ri.format)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_report_images ri
  WHERE ri.report_id IN (SELECT id FROM biz.lab_test_reports WHERE rpt_id = payload->>'reportId') AND ri.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e05_upload_lab_report_flag(payload json)
RETURNS json AS $$
BEGIN
  UPDATE biz.lab_test_reports SET rpt_url = payload->>'labReportUrl', updated_at = now()
  WHERE rpt_id = payload->>'reportId' AND is_valid = true;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e08_cancel_check_for_report(payload json)
RETURNS json AS $$
BEGIN
  UPDATE biz.lab_test_reports SET
    rpt_status = 'canceled',
    cnl_reason = payload->>'cancelReason', cnl_doctor = payload->>'executor', cnl_name = payload->>'executorName',
    cnl_time = (payload->>'executeDate')::timestamptz,
    cnl_section = payload->>'section', cnl_section_name = payload->>'sectionName',
    updated_at = now()
  WHERE sp_barcode = payload->>'doctAdviseNo' AND rpt_status = 'submitted' AND is_valid = true;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_rp_e09_get_cancel_check_report(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('reportId', tr.rpt_id, 'sampleNo', tr.sp_no, 'doctAdviseNo', tr.sp_barcode,
        'patientId', tr.pt_id, 'patientName', tr.pt_name,
        'cancelDate', tr.cnl_time, 'canceler', tr.cnl_doctor, 'cancelerName', tr.cnl_name)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_test_reports tr
  WHERE (payload->>'sendingOrg' IS NULL OR tr.org_sending = payload->>'sendingOrg')
    AND (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR tr.cnl_time >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR tr.cnl_time <= (payload->>'endDate')::date)
    AND tr.rpt_status = 'canceled' AND tr.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. 危急值 (CV)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_cv_f01_upload_sample_warn(payload json)
RETURNS json AS $$
DECLARE
  v_id int;
  v_di jsonb;
  v_wl jsonb;
BEGIN
  FOR v_di IN SELECT * FROM jsonb_array_elements((payload->'dataInfoList')::jsonb)
  LOOP
    INSERT INTO biz.lab_sample_warnings (org_lab, sp_barcode, sp_no,
      pt_name, pt_sex, pt_birthday, pt_id,
      chk_doctor, chk_name, chk_time, chk_section, chk_section_name)
    VALUES (v_di->>'labOrg', v_di->>'doctAdviseNo', v_di->>'sampleNo',
      v_di->>'patientName', (v_di->>'sex')::int, (v_di->>'birthday')::date, v_di->>'patientId',
      v_di->>'executor', v_di->>'executorName', (v_di->>'executeDate')::timestamptz,
      v_di->>'section', v_di->>'sectionName')
    RETURNING id INTO v_id;

    FOR v_wl IN SELECT * FROM jsonb_array_elements(v_di->'warnLogList')
    LOOP
      INSERT INTO biz.lab_warn_log_items (warning_id, warn_info, test_id, test_name, test_result)
      VALUES (v_id, v_wl->>'warnInfo', v_wl->>'testId', v_wl->>'testName', v_wl->>'testResult');
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_cv_f02_get_sample_warn(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'labOrg', sw.org_lab, 'doctAdviseNo', sw.sp_barcode, 'sampleNo', sw.sp_no,
        'patientId', sw.pt_id, 'patientName', sw.pt_name, 'sex', sw.pt_sex, 'birthday', sw.pt_birthday,
        'executor', sw.chk_doctor, 'executorName', sw.chk_name, 'executeDate', sw.chk_time,
        'section', sw.chk_section, 'sectionName', sw.chk_section_name,
        'warnLogList', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'warnInfo', wl.warn_info, 'testId', wl.test_id, 'testName', wl.test_name, 'testResult', wl.test_result
          )) FROM biz.lab_warn_log_items wl
          WHERE wl.warning_id = sw.id AND wl.is_valid = true
        ), '[]'::jsonb)
      )
    ) FILTER (WHERE sw.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_sample_warnings sw
  WHERE (payload->>'sendingOrg' IS NULL OR payload->>'sendingOrg' = sw.org_lab)
    AND (payload->>'startDate' IS NULL OR payload->>'startDate' = '' OR sw.chk_time >= (payload->>'startDate')::date)
    AND (payload->>'endDate' IS NULL OR payload->>'endDate' = '' OR sw.chk_time <= (payload->>'endDate')::date)
    AND sw.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_cv_f03_update_warn_feedback(payload json)
RETURNS json AS $$
BEGIN
  UPDATE biz.lab_warn_log_items SET
    rec_doctor = payload->>'receiver', rec_time = (payload->>'receiveDate')::timestamptz,
    rec_note = payload->>'receiveNote', rpt_id = payload->>'reportId', updated_at = now()
  WHERE test_id = payload->>'testId' AND is_valid = true;
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_cv_f04_get_sample_warn_feedback(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object('status', sw.feedback_status, 'receiver', wl.rec_doctor,
        'receiveDate', wl.rec_time, 'testid', wl.test_id)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_sample_warnings sw
  JOIN biz.lab_warn_log_items wl ON wl.warning_id = sw.id
  WHERE sw.sp_barcode = payload->>'doctAdviseNo' AND sw.is_valid = true AND wl.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. 质控 (QC)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_qc_h01_upload_query_qc(payload json)
RETURNS json AS $$
BEGIN
  INSERT INTO biz.lab_qc_data (org_lab, qc_type, qc_date, instrument_code, test_item_code, qc_value, qc_target, qc_sd)
  VALUES (payload->>'labOrg', payload->>'qcType', (payload->>'qcDate')::date,
          payload->>'instrumentCode', payload->>'testItemCode',
          (payload->>'qcValue')::numeric, (payload->>'qcTarget')::numeric, (payload->>'qcSd')::numeric);
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_qc_h02_upload_query_qc(payload json)
RETURNS json AS $$ BEGIN RETURN ichse.lab_demo_qc_h01_upload_query_qc(payload); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_qc_h03_get_qc_data(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(row_to_json(q.*)::jsonb - 'is_valid' - 'version' - 'deleted_at'), '[]'::jsonb)
  ) INTO v_result FROM biz.lab_qc_data q WHERE q.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_qc_h04_get_qc_out_of_control_stats(payload json)
RETURNS json AS $$ BEGIN RETURN ichse.lab_demo_qc_h03_get_qc_data(payload); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_qc_h05_get_eqa_results(payload json)
RETURNS json AS $$ BEGIN RETURN ichse.lab_demo_qc_h03_get_qc_data(payload); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. 设备 (EQ)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_eq_i01_upload_device_info(payload json)
RETURNS json AS $$
BEGIN
  INSERT INTO biz.lab_device_info (org_lab, device_code, device_name, model, sn, manufacturer)
  VALUES (payload->>'labOrg', payload->>'deviceCode', payload->>'deviceName',
          payload->>'model', payload->>'sn', payload->>'manufacturer')
  ON CONFLICT (org_lab, device_code) DO UPDATE SET
    device_name = EXCLUDED.device_name, model = EXCLUDED.model,
    sn = EXCLUDED.sn, manufacturer = EXCLUDED.manufacturer, updated_at = now();
  RETURN jsonb_build_object('code', 200, 'message', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_eq_i02_upload_device_info(payload json)
RETURNS json AS $$ BEGIN RETURN ichse.lab_demo_eq_i01_upload_device_info(payload); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ichse.lab_demo_eq_i03_get_device_info(payload json)
RETURNS json AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(row_to_json(d.*)::jsonb - 'is_valid' - 'version' - 'deleted_at'), '[]'::jsonb)
  ) INTO v_result FROM biz.lab_device_info d WHERE d.is_valid = true;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. 申请 (QR)
-- ============================================================

CREATE OR REPLACE FUNCTION ichse.lab_demo_qr_p01_get_application_list(payload json)
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

CREATE OR REPLACE FUNCTION ichse.lab_demo_qr_p02_submit_application(payload json)
RETURNS json AS $$
DECLARE
  v_id int;
  v_x jsonb;
BEGIN
  INSERT INTO biz.lab_applications (application_id, org_sending, sp_barcode,
    pt_name, pt_sex, pt_age, pt_id, pt_phone, pt_type, pt_diagnostic, pt_bed_no, pt_ward_name,
    req_section_name, req_mode, req_doctor, req_time, status, send_flag)
  VALUES (payload->>'applicationId', payload->>'sendingOrg', payload->>'doctAdviseNo',
    payload->>'patientName', payload->>'sex', payload->>'age', payload->>'patientId',
    payload->>'patientPhone', payload->>'patientType', payload->>'diagnostic', payload->>'bedNo', payload->>'wardName',
    payload->>'sectionName', payload->>'requestMode', payload->>'requester',
    (payload->>'requestTime')::timestamptz, payload->>'status', (payload->>'sendFlag')::int)
  ON CONFLICT (application_id) DO UPDATE SET
    status = EXCLUDED.status, send_flag = EXCLUDED.send_flag, updated_at = now()
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
