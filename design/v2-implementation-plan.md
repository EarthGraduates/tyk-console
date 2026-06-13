# v2.0 数据库改造实施计划

> 日期：2026-06-13 | 基于设计文档 `design/database-design-v2.md`
> 当前：v1.4 — 12 张表，JSONB `data` 字段方案
> 目标：v2.0 — 23 张表，二维主子表 + 实体前缀命名

---

## 实施步骤总览

```
Step 1: 迁移脚本 (DDL)
  └── Step 2: PG 函数 (写入) + 视图 (读取)
        └── Step 3: 接口元数据更新 (biz.interfaces)
              └── Step 4: Python 服务适配
                    └── Step 5: 测试脚本更新
                          └── Step 6: Tyk API 重新生成 + 全量测试
```

严格按顺序执行，每步完成后验证再进入下一步。

---

## Step 1: 数据库迁移脚本

### 1.1 创建新迁移文件

`database/postgresql/migrations/013_v2_lab_tables.sql`

**内容：**

1. **删除旧对象**
   - DROP 12 个 `ichse.lab_*` PostgREST 视图
   - DROP 36 个 `ichse.lab_nx_*` PG 函数
   - DROP 12 张 `biz.lab_*` 旧表

2. **建新表（23 张）**
   - 7 张字典表（5 主 + 2 子）
   - 3 张标本表（L1 送检单 + L2 标本 + L3 收费明细）
   - 6 张报告表（1 主 + 4 明细子表 + 1 图文子表）
   - 2 张危急值表（1 主 + 1 子）
   - 2 张申请表（1 主 + 1 子）
   - 2 张独立表（质控 + 设备）
   - 每张表包含完整列定义 + 索引 + 唯一约束 + COMMENT

3. **建 PostgREST 视图**
   - 每张 `biz.lab_*` 表对应一个 `ichse.lab_*` 视图，过滤 `is_valid = true`
   - 授权 `GRANT SELECT, INSERT, UPDATE TO web_anon`

### 1.2 种子数据

将旧表中的字典数据迁移到新表结构：

```sql
-- 样本类型
INSERT INTO biz.lab_sample_types (org_lab, sample_type, sample_describe, srm1, srm2)
  SELECT lab_org, sample_type, sample_describe, srm1, srm2
  FROM biz.lab_sample_types_old WHERE is_valid = true;

-- 其他字典表同理...
```

**验证：** `docker exec ichse-postgres psql -U ichse -d ichse -f migrations/013_*.sql` 无报错，`\dt biz.lab_*` 列出 23 张表。

---

## Step 2: PG 函数重写

### 2.1 写入函数（有主子表的接口）

为每个涉及主子表写入的接口创建 PG 函数，在事务内拆解 payload 并写入：

| 接口 | 函数名 | 涉及表 |
|------|--------|--------|
| B02 标本送检 | `lab_nx_sp_b02_external_specimen` | lab_specimens + lab_specimen_items + lab_specimen_barcode_items |
| E01 报告上传 | `lab_nx_rp_e01_submit_report` | lab_test_reports + 4 明细子表 |
| E02 图文上传 | `lab_nx_rp_e02_upload_image_info` | lab_report_images |
| F01 危急值上传 | `lab_nx_cv_f01_upload_sample_warn` | lab_sample_warnings + lab_warn_log_items |
| P02 申请提交 | `lab_nx_qr_p02_submit_application` | lab_applications + lab_application_items |

**函数模板（以报告上传为例）：**

```sql
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e01_submit_report(json)
RETURNS json AS $$
DECLARE
  v_id int;
  v_param jsonb := ($1->'param');
BEGIN
  -- 1. INSERT 主表
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
    v_param->>'reportId', v_param->>'doctAdviseNo', v_param->>'sampleNo',
    v_param->>'sampleType', v_param->>'sampleDescribe',
    v_param->>'labOrg', v_param->>'sendingOrg', v_param->>'sendingOrgName',
    v_param->>'patientName', (v_param->>'sex')::int, (v_param->>'age')::int,
    (v_param->>'ageUnit')::int, (v_param->>'birthday')::date, v_param->>'patientId',
    v_param->>'medicalcardId', v_param->>'patientProperties', (v_param->>'patientType')::int,
    v_param->>'diagnostic', v_param->>'diagnosticCode', v_param->>'toponymy',
    v_param->>'section', v_param->>'sectionName', (v_param->>'requestMode')::int,
    v_param->>'examinaim', v_param->>'examinaimCode',
    v_param->>'checker', v_param->>'checkerName', v_param->>'checker2', v_param->>'checker2Name',
    (v_param->>'checkTime')::timestamptz, v_param->>'checkerOpinion',
    v_param->>'section', v_param->>'sectionName',
    v_param->>'receiver', v_param->>'receiverName', (v_param->>'receiveTime')::timestamptz,
    (v_param->>'concessionFlag')::int, v_param->>'concessionReason'
  ) RETURNING id INTO v_id;

  -- 2. INSERT 常规结果明细
  INSERT INTO biz.lab_report_result_items (report_id, sp_no, test_id, hos_test_id,
    chinese_name, test_result, ref_range, ref_lo, ref_hi, measure_time, hint, unit)
  SELECT v_id, x->>'sampleNo', x->>'testId', x->>'hosTestId',
    x->>'chineseName', x->>'testResult', x->>'refRange', x->>'refLo', x->>'refHi',
    (x->>'measureTime')::timestamptz, x->>'hint', x->>'unit'
  FROM jsonb_array_elements(v_param->'resultInfoList') AS x;

  -- 3. INSERT 培养结果明细
  INSERT INTO biz.lab_report_plant_items (report_id, sp_no, test_id, hos_test_id,
    chinese_name, test_result, result_type, plant_type, plant_remark)
  SELECT v_id, x->>'sampleNo', x->>'testId', x->>'hosTestId',
    x->>'chineseName', x->>'testResult', (x->>'resultType')::int,
    (x->>'plantType')::int, x->>'plantRemark'
  FROM jsonb_array_elements(v_param->'plantInfoList') AS x;

  -- 4. INSERT 药敏结果明细
  INSERT INTO biz.lab_report_anti_items (report_id, sp_no, anti_id, anti_name,
    bio_id, bio_name, bio_type, kb_result, mic_result, etest_result,
    test_result, method, print_ord)
  SELECT v_id, x->>'sampleNo', x->>'antiId', x->>'antiName',
    x->>'bioId', x->>'bioName', (x->>'bioType')::int, x->>'kbResult',
    x->>'micResult', x->>'etestResult', x->>'testResult',
    (x->>'method')::int, (x->>'printOrd')::int
  FROM jsonb_array_elements(v_param->'antiInfoList') AS x;

  -- 5. INSERT 细菌结果明细
  INSERT INTO biz.lab_report_bio_items (report_id, sp_no, bio_id, bio_name,
    bio_type, bio_quantity, spectrum, measure_time, remark)
  SELECT v_id, x->>'sampleNo', x->>'bioId', x->>'bioName',
    (x->>'bioType')::int, x->>'bioQuantity', x->>'spectrum',
    (x->>'measureTime')::timestamptz, x->>'remark'
  FROM jsonb_array_elements(v_param->'bioInfoList') AS x;

  RETURN jsonb_build_object('code', 200, 'message', 'success', 'reportId', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2.2 读取函数（SELECT 接口）

为查询接口创建函数或视图，JOIN 子表后用 `jsonb_agg` 组装回原始 JSON 格式：

```sql
CREATE OR REPLACE FUNCTION ichse.lab_nx_rp_e03_get_lab_report(json)
RETURNS json AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'code', 200, 'message', 'success',
    'dataInfoList', COALESCE(jsonb_agg(
      jsonb_build_object(
        'labOrg', tr.org_lab, 'reportId', tr.rpt_id, 'sampleNo', tr.sp_no,
        'doctAdviseNo', tr.sp_barcode, 'patientName', tr.pt_name, ...
        'resultInfoList', (
          SELECT COALESCE(jsonb_agg(row_to_json(ri.*)::jsonb - 'id' - 'report_id'), '[]'::jsonb)
          FROM lab_report_result_items ri WHERE ri.report_id = tr.id AND ri.is_valid = true
        ),
        'plantInfoList', (...),
        'antiInfoList', (...),
        'bioInfoList', (...)
      )
    ), '[]'::jsonb)
  ) INTO v_result
  FROM biz.lab_test_reports tr
  WHERE tr.sp_barcode = ($1->>'doctAdviseNo') AND tr.is_valid = true;

  RETURN v_result::json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2.3 简单 CRUD 函数（单表，无子表）

字典表上传/下载、质控、设备等单表操作，直接用 PostgREST 直连表，不需要 PG 函数。只需保持 35 个 stub 函数可用（返回空成功），方便 Tyk 路由不报错。

### 2.4 更新 functions 迁移文件

`database/postgresql/migrations/014_v2_lab_functions.sql` — 包含上述所有新函数。

**验证：** `SELECT ichse.lab_nx_*` 函数存在且可调用，stub 返回 `{"code":200}`。

---

## Step 3: 接口元数据更新

更新 `biz.interfaces` 表，将 `target_table` 改为新表名：

```sql
-- 报告主表
UPDATE biz.interfaces SET target_table = 'lab_test_reports' WHERE interface_id LIKE 'LAB-NX-RP-%';

-- 标本主表（指向 L2 标本级）
UPDATE biz.interfaces SET target_table = 'lab_specimen_items' WHERE interface_id IN ('LAB-NX-SP-I001', 'LAB-NX-RC-O001', 'LAB-NX-RC-O002', 'LAB-NX-RC-I001', 'LAB-NX-RC-I002');

-- 危急值主表
UPDATE biz.interfaces SET target_table = 'lab_sample_warnings' WHERE interface_id LIKE 'LAB-NX-CV-%';

-- 申请主表
UPDATE biz.interfaces SET target_table = 'lab_applications' WHERE interface_id LIKE 'LAB-NX-QR-%';

-- 字典表
UPDATE biz.interfaces SET target_table = 'lab_sample_types' WHERE interface_id IN ('LAB-NX-MD-O001', 'LAB-NX-MD-I001');
-- ... 其他字典同理
```

**验证：** `SELECT interface_id, target_table FROM biz.interfaces WHERE target_table IS NOT NULL ORDER BY interface_id;` 全部指向新表名。

---

## Step 4: Python 服务适配

### 4.1 网关路由

当前 `gateway.py` 的 `_url_map` 从 `biz.interfaces` 读取 `target_table` 和 `target_op`，如果 `target_table` 已更新为新表名，路由层理论上不需要改动。

但需要确认：主子表写入的接口，`target_op` 应从表直连改为 RPC：

```sql
-- 将复杂写入接口改为走 RPC 函数（不走直连）
UPDATE biz.interfaces SET target_table = NULL, target_op = NULL
WHERE interface_id IN (
  'LAB-NX-SP-I001',  -- 标本送检（3 级主子表）
  'LAB-NX-RP-O001',  -- 报告上传（1+4 主子表）
  'LAB-NX-CV-O001',  -- 危急值上传（1+1 主子表）
  'LAB-NX-QR-I002'   -- 申请提交（1+1 主子表）
);
```

`gateway.py` 中 `target_table` 为 NULL 时会 fallback 到 `_forward_rpc(func_name)`，正确。

### 4.2 校验引擎

校验引擎不需要改动——它只依赖 `biz.validation_rules` 和 `biz.interface_fields`，这两张共享表不受影响。

**验证：** `curl -X POST http://localhost:8000/rest/lab_nx_md_a07_get_sample_type -d '{"centerOrg":"ORG001"}'` 返回旧格式 JSON（接口契约不变）。

---

## Step 5: 测试脚本更新

### 5.1 `generate_test_data.py`

- 将所有 `interface_id` 的 payload 生成函数改为**按新字段名构造**（如 `patientName` → `pt_name` 等）
  **实际上不需要**——payload 保持接口原始字段名不变（调用方无感知），PG 函数内部做映射。
  测试脚本的 payload 模板不需要改字段名，只需要确保 payload 结构与接口契约一致。

- 数据汇总部分：表名列表更新为新表名

```python
for tbl in ["lab_sample_types", "lab_request_items", "lab_test_items",
            "lab_bio_items", "lab_anti_items",
            "lab_specimens", "lab_specimen_items", "lab_specimen_barcode_items",
            "lab_test_reports", "lab_report_result_items", "lab_report_plant_items",
            "lab_report_anti_items", "lab_report_bio_items", "lab_report_images",
            "lab_sample_warnings", "lab_warn_log_items",
            "lab_applications", "lab_application_items",
            "lab_qc_data", "lab_device_info"]:
```

### 5.2 `generate_tyk_apis.py`

- 从 `biz.interfaces` 读取，自动使用新 `interface_id`，**不需要改动**。

### 5.3 `import_interfaces.py`

- 新数据库初始化时，`biz.interfaces` 的 `interface_id` 使用 `LAB-NX-*` 格式，**已在上次修改中完成**。

---

## Step 6: Tyk API 重新生成 + 全量测试

### 6.1 重新生成 Tyk API JSON

```bash
cd services && source venv/bin/activate
python scripts/generate_tyk_apis.py
```

### 6.2 热重载 Tyk

```bash
curl -X GET http://localhost:8080/tyk/reload/
```

### 6.3 全量集成测试

```bash
python scripts/generate_test_data.py
```

**预期结果：** 36 个接口全部通过，PHASE 1/2/3 均为 356+ ok。

### 6.4 手动抽检

```bash
# 报告上传（最复杂接口）
curl -X POST http://localhost:8080/api/ygt/mdrs/v1/lis/centerljzx/submitReport \
  -H 'Content-Type: application/json' \
  -d '{...}'  # 完整 E01 payload

# 报告查询
curl -X POST http://localhost:8080/api/ygt/mdrs/v1/lis/samplesjf/getLabReport \
  -H 'Content-Type: application/json' \
  -d '{"doctAdviseNo":"BCXXXXXXXX"}'
```

---

## 风险点

| 风险 | 缓解 |
|------|------|
| 旧数据丢失（字典数据需要迁移） | Step 1.2 种子数据迁移脚本，先在测试环境验证 |
| PG 函数写入事务中某个子表失败，主表已写入 | 函数内所有 INSERT 在同一事务，任一失败全部回滚 |
| PostgREST 视图重建后缓存不刷新 | NOTIFY pgrst, 'reload' 或重启容器 |
| 调用方接口契约变了吗？ | 没有——PG 函数内部做字段映射，入参出参格式不变 |

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `migrations/013_v2_lab_tables.sql` | **新增** | DROP 旧 + CREATE 新 23 表 + 视图 + 种子迁移 |
| `migrations/014_v2_lab_functions.sql` | **新增** | 重写 36 个 PG 函数 |
| `migrations/012_rename_biz_to_lab.sql` | 废弃 | v1.4→v2.0 后不再需要 |
| `migrations/008/009/011` | 废弃 | 旧的 DDL，被 013 替代 |
| `services/scripts/generate_test_data.py` | 修改 | 表名列表更新 |
| `biz.interfaces` (运行时数据) | 修改 | target_table 更新 |

---

## 工时估算

| Step | 内容 | 预估 |
|------|------|------|
| 1 | 迁移脚本 (013) | 1h |
| 2 | PG 函数重写 (014) | 2h（5 个复杂 + 30 个简单 CRUD/stub） |
| 3 | 接口元数据更新 | 15min |
| 4 | Python 服务适配 | 30min（确认 + 小改） |
| 5 | 测试脚本更新 | 30min |
| 6 | Tyk 重生成 + 全量测试 + 修 bug | 2h |
| **合计** | | **~6h** |
