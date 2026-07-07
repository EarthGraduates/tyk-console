-- ============================================================
-- PG Function: lab_demo_md_a07_get_sample_type
-- 日期: 2026-06-12  |  更新: 2026-06-13 (v2.0 conventions)
-- 用途: Download sample type dictionary (Requester downloads from Lab Center)
-- 暴露: POST /rpc/lab_demo_md_a07_get_sample_type (via PostgREST)
-- ============================================================

-- 参数必须为无名 json，PostgREST 才能做单对象绑定

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
