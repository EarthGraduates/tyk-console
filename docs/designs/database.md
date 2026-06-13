# LAB 业务表设计 v2.0 — 二维表方案

> 状态：草稿 | 日期：2026-06-13
> 数据源：检验中心接口.db — 36 个接口完整出入参
> 适用：全部业务域（LAB / IMG / PATH / ECG / CSSD），新业务必须遵循本文规范

---

## 一、设计原则

1. **消灭 JSONB `data` 列**：所有字段展开为真实列，用明确数据类型
2. **数组 → 子表**：接口载荷中每个 `List` 拆为独立子表，FK 关联
3. **实体前缀命名**：跨表出现的同一实体，用统一 3-5 字母前缀，下文第二章定义
4. **业务键关联**：跨表 JOIN 走 `sp_barcode` / `rpt_id` 等业务键
5. **统计友好**：索引覆盖时间、科室、项目名等常见分析维度

---

## 二、实体前缀命名规范

### 2.1 规则

所有跨表出现的实体字段，**必须**加实体前缀。前缀后列名格式：`{prefix}_{attribute}`。

单表内专属字段不强制加前缀，但跨表字段必须加。

### 2.2 实体前缀表

| 实体 | 前缀 | 释义 | 典型字段 |
|------|------|------|---------|
| Patient | `pt_` | 患者/受检者 | `pt_name`, `pt_sex`, `pt_age`, `pt_birthday`, `pt_id`, `pt_phone`, `pt_type`, `pt_properties`, `pt_diagnostic`, `pt_diagnostic_code`, `pt_id_card`, `pt_medicalcard_id`, `pt_source_id`, `pt_visit_id`, `pt_infant_flag`, `pt_bed_no`, `pt_ward_code`, `pt_ward_name` |
| Specimen | `sp_` | 标本 | `sp_barcode`, `sp_no`, `sp_type`, `sp_describe`, `sp_toponymy`, `sp_examinaim`, `sp_notes`, `sp_old_barcode`, `sp_status`, `sp_entrust_collect` |
| Request | `req_` | 开单/申请 | `req_doctor`, `req_name`, `req_time`, `req_section`, `req_section_name`, `req_mode`, `req_ward_code`, `req_ward_name`, `req_item_code`, `req_item_name`, `req_examinaim`, `req_examinaim_code` |
| Collect | `col_` | 采集 | `col_doctor`, `col_name`, `col_time`, `col_org_code`, `col_org_name` |
| Check | `chk_` | 审核/发布 | `chk_doctor`, `chk_name`, `chk_doctor2`, `chk_name2`, `chk_time`, `chk_opinion`, `chk_section`, `chk_section_name` |
| Receive | `rec_` | 接收/反馈 | `rec_doctor`, `rec_name`, `rec_time`, `rec_flag`, `rec_status`, `rec_note` |
| Report | `rpt_` | 报告 | `rpt_id`, `rpt_status`, `rpt_url`, `rpt_explain`, `rpt_result_status` |
| Org | `org_` | 机构 | `org_lab`, `org_sending`, `org_center`, `org_sending_name` |
| Cancel | `cnl_` | 撤销 | `cnl_reason`, `cnl_doctor`, `cnl_name`, `cnl_time`, `cnl_section`, `cnl_section_name` |
| Concession | `cnc_` | 让步 | `cnc_flag`, `cnc_reason` |
| Warning | `warn_` | 危急值 | `warn_info`, `warn_type` |
| Billing | `bill_` | 收费 | `bill_price`, `bill_number`, `bill_item_code`, `bill_child_code`, `bill_name`, `bill_child_name` |

### 2.3 使用示例

同一张表里出现多个角色，前缀直接区分：

```
-- 无前缀（混乱）
section            -- 哪个科室？
executor           -- 开单者？采集者？审核者？取消者？

-- 有前缀（自文档化）
req_section        -- 开单科室
chk_section        -- 审核科室
col_doctor         -- 采集者
chk_doctor         -- 审核者
cnl_doctor         -- 取消者
```

### 2.4 适用范围

- **必须加前缀**：所有业务主表、条码级子表中跨实体出现的字段
- **不强制加前缀**：单实体字典表（如 `lab_sample_types.sample_type` 不需要 `sp_`）、纯明细子表（如 `lab_report_result_items.test_result` 不需要前缀）、单表（如 `lab_qc_data`）

---

## 三、ER 总览

```
lab_sample_types / lab_request_items / lab_test_items / lab_bio_items / lab_anti_items
(字典表，独立)

lab_specimens (L1 送检单)
  └──1:N── lab_specimen_items (L2 标本，患者+开单+采集+接收+不合格)
              └──1:N── lab_specimen_barcode_items (L3 收费明细)

lab_test_reports (报告主表，患者+开单+审核+接收+让步+撤销)
  ├──1:N── lab_report_result_items (常规结果)
  ├──1:N── lab_report_plant_items  (培养结果)
  ├──1:N── lab_report_anti_items   (药敏结果)
  ├──1:N── lab_report_bio_items    (细菌结果)
  └──1:N── lab_report_images       (图文)

lab_sample_warnings (危急值主表，患者+发布+反馈)
  └──1:N── lab_warn_log_items (危急项目明细)

lab_applications (申请主表，患者+开单)
  └──1:N── lab_application_items (检验项目)

lab_qc_data / lab_device_info (独立)
```

---

## 四、表详细定义

> 所有表均含基础字段 `is_valid / version / created_at / updated_at / deleted_at`，DDL 中省略。
> `*` 标记的列建有索引。

---

### 4.1 字典表（5 主 + 2 子）

#### `lab_sample_types` — A01/A07

```sql
CREATE TABLE biz.lab_sample_types (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,            -- labOrg*
  sample_type     text NOT NULL,            -- sampleType
  sample_describe text NOT NULL,            -- sampleDescribe
  srm1            text,                     -- 拼音码
  srm2            text,                     -- 五笔码
  UNIQUE(org_lab, sample_type)
);
```

#### `lab_request_items` — A02/A08（主表）

```sql
CREATE TABLE biz.lab_request_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,            -- labOrg*
  req_item_code   text NOT NULL,            -- itemCode (开单项目代码)
  req_item_name   text,                     -- itemName
  bill_price      numeric(10,2),            -- itemPrice
  used_now        int,                      -- 是否在用
  srm1            text,
  srm2            text,
  sp_type         text,                     -- sampleType
  sp_describe     text,                     -- sampleDescribe
  compose_type    text,                     -- composeType
  UNIQUE(org_lab, req_item_code)
);
```

**子表 1 — testInfoList（关联报告项目）：**

```sql
CREATE TABLE biz.lab_request_item_tests (
  id                serial PRIMARY KEY,
  request_item_id   int NOT NULL REFERENCES biz.lab_request_items(id) ON DELETE CASCADE,
  test_id           text NOT NULL,          -- testId
  chinese_name      text                    -- chineseName
);
```

**子表 2 — itemInfoList（组合明细）：**

```sql
CREATE TABLE biz.lab_request_item_children (
  id                serial PRIMARY KEY,
  request_item_id   int NOT NULL REFERENCES biz.lab_request_items(id) ON DELETE CASCADE,
  child_item_code   text NOT NULL,          -- childItemCode
  child_item_name   text                    -- childItemName
);
```

#### `lab_test_items` — A03/A09

```sql
CREATE TABLE biz.lab_test_items (
  id              serial PRIMARY KEY,
  org_lab         text NOT NULL,            -- labOrg*
  test_id         text NOT NULL,            -- testId
  chinese_name    text NOT NULL,
  english_ab      text,
  english_name    text,
  method_name     text,
  srm1            text,
  srm2            text,
  sp_type         text,                     -- sampleType
  sp_describe     text,                     -- sampleDescribe
  unit            text,
  UNIQUE(org_lab, test_id)
);
```

#### `lab_bio_items` — A04/A10

```sql
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
  UNIQUE(org_lab, bio_id)
);
```

#### `lab_anti_items` — A05/A11

```sql
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
  UNIQUE(org_lab, anti_id)
);
```

---

### 4.2 标本 — 三级结构

B02 载荷结构：
```
送检单(packet级)
  ├── dataInfoList[]       — 标本条码列表，每个条码对应不同患者/样本
  └── barcodeDetailList[]  — 条码收费明细
```

**设计决策：条码级才是真正的标本实体。** L1 送检单只存约 10 个送检级字段，患者/开单/采集/接收全部下到 L2 标本级，消除重叠。

#### L1 `lab_specimens` — 送检单

```sql
CREATE TABLE biz.lab_specimens (
  id                serial PRIMARY KEY,
  packet_id         text NOT NULL,          -- packetId (送检单编号)*
  org_sending       text,                   -- sendingOrg*
  org_center        text,                   -- centerOrg*
  col_org_code      text,                   -- collectingOrgCode (采集机构)
  col_org_name      text,                   -- collectingOrgName
  col_doctor        text,                   -- sender (送检人)
  col_name          text,                   -- senderName
  col_time          timestamptz,            -- sendDate
  send_flag         text                    -- sendFlag
);
CREATE UNIQUE INDEX uq_lab_specimens_packet_id ON biz.lab_specimens(packet_id);
CREATE INDEX idx_lab_specimens_org_sending ON biz.lab_specimens(org_sending);
CREATE INDEX idx_lab_specimens_org_center ON biz.lab_specimens(org_center);
```

#### L2 `lab_specimen_items` — 标本（条码级，核心实体）

```sql
CREATE TABLE biz.lab_specimen_items (
  id                serial PRIMARY KEY,
  specimen_id       int NOT NULL REFERENCES biz.lab_specimens(id) ON DELETE CASCADE,
  -- 标本标识
  sp_barcode        text NOT NULL,          -- doctAdviseNo* UNIQUE
  sp_old_barcode    text,                   -- oldBarcode
  sp_no             text,                   -- sampleNo
  sp_type           text,                   -- sampleType
  sp_describe       text,                   -- sampleDescribe
  sp_toponymy       text,                   -- toponymy (采集部位)
  sp_examinaim      text,                   -- examinaim (检验项目)
  sp_notes          text,                   -- notes
  sp_entrust_collect int,                   -- fg_entrustcollect (异地采集)
  -- 患者 pt_
  pt_name           text,                   -- patientName*
  pt_sex            int,                    -- 0未知 1男 2女
  pt_age            int,
  pt_age_unit       int,
  pt_birthday       date,
  pt_id             text,                   -- patientId*
  pt_id_card        text,                   -- idCard
  pt_phone          text,                   -- patientPhone
  pt_type           int,                    -- patientType (病人类别)
  pt_properties     text,                   -- patientProperties (病人性质)
  pt_diagnostic     text,                   -- diagnostic
  pt_infant_flag    int,                    -- infantFlag
  pt_source_id      text,                   -- sourcePatientId (病案号)
  pt_visit_id       text,                   -- visitId (就诊/住院号)
  pt_bed_no         text,                   -- bedNo
  pt_ward_code      text,                   -- wardCode
  pt_ward_name      text,                   -- wardName
  -- 开单 req_
  req_doctor        text,                   -- requester
  req_name          text,                   -- requestName
  req_time          timestamptz,            -- requestTime
  req_section       text,                   -- section
  req_section_name  text,                   -- sectionName
  req_mode          int,                    -- requestMode
  req_ward_code     text,                   -- wardCode
  req_ward_name     text,                   -- wardName
  -- 采集 col_
  col_doctor        text,                   -- executor
  col_name          text,                   -- executorName
  col_time          timestamptz,            -- executeTime
  col_org_code      text,                   -- dataInfoList.collectingOrgCode
  col_org_name      text,                   -- dataInfoList.collectingOrgName
  -- 接收 rec_ (D02 回写)
  rec_doctor        text,                   -- receiver
  rec_name          text,                   -- receiverName
  rec_time          timestamptz,            -- receiveTime
  rec_flag          text,                   -- receiveFlag
  rec_status        int,                    -- status
  rec_reject_reason text,                   -- reason (退回原因)
  -- 状态
  sp_status         text DEFAULT 'registered', -- registered/received/qualified/rejected
  -- 不合格 (D04 回写)
  unqual_reason     text,                   -- reason
  unqual_doctor     text,                   -- executor
  unqual_name       text,                   -- executorName
  unqual_time       timestamptz,            -- executeDate
  unqual_section    text,                   -- section
  unqual_section_name text                  -- sectionName
);
CREATE UNIQUE INDEX uq_lab_si_barcode ON biz.lab_specimen_items(sp_barcode);
CREATE INDEX idx_lab_si_specimen_id ON biz.lab_specimen_items(specimen_id);
CREATE INDEX idx_lab_si_pt_id ON biz.lab_specimen_items(pt_id);
CREATE INDEX idx_lab_si_pt_name ON biz.lab_specimen_items(pt_name);
CREATE INDEX idx_lab_si_sp_status ON biz.lab_specimen_items(sp_status);
CREATE INDEX idx_lab_si_col_time ON biz.lab_specimen_items(col_time);
```

#### L3 `lab_specimen_barcode_items` — 收费明细

```sql
CREATE TABLE biz.lab_specimen_barcode_items (
  id                  serial PRIMARY KEY,
  specimen_item_id    int NOT NULL REFERENCES biz.lab_specimen_items(id) ON DELETE CASCADE,
  sp_barcode          text NOT NULL,        -- doctAdviseNo*
  org_sending         text,                 -- sendingOrg
  bill_item_code      text,                 -- itemCode (组合代码)
  bill_child_code     text,                 -- childItemCode (明细代码)
  bill_price          numeric(10,2),        -- costPrice
  bill_number         int,                  -- costNumber
  bill_name           text,                 -- costName (收费项目名称)
  bill_child_name     text                  -- childItemName (收费项目名称-明细)
);
CREATE INDEX idx_lab_sbi_item_id ON biz.lab_specimen_barcode_items(specimen_item_id);
```

---

### 4.3 检验报告 — 主表 + 5 子表

E01 载荷含 4 个子列表 + E02 图文上传。

#### 主表 `lab_test_reports`

```sql
CREATE TABLE biz.lab_test_reports (
  id                serial PRIMARY KEY,
  -- 报告标识
  rpt_id            text NOT NULL,          -- reportId* UNIQUE
  rpt_status        text DEFAULT 'submitted', -- reportStatus (submitted/canceled)
  rpt_result_status int,                    -- resultStatus (E03 审核状态)
  rpt_explain       text,                   -- reportExplain
  rpt_url           text,                   -- labReportUrl (E05 回写)
  -- 标本关联
  sp_barcode        text,                   -- doctAdviseNo* → lab_specimen_items.sp_barcode
  sp_no             text,                   -- sampleNo
  sp_type           text,                   -- sampleType
  sp_describe       text,                   -- sampleDescribe
  -- 机构 org_
  org_lab           text NOT NULL,          -- labOrg*
  org_sending       text,                   -- sendingOrg*
  org_sending_name  text,                   -- sendingOrgName
  -- 患者 pt_
  pt_name           text,                   -- patientName*
  pt_sex            int,
  pt_age            int,
  pt_age_unit       int,
  pt_birthday       date,
  pt_id             text,                   -- patientId*
  pt_medicalcard_id text,                   -- medicalcardId
  pt_properties     text,                   -- patientProperties
  pt_type           int,                    -- patientType
  pt_diagnostic     text,                   -- diagnostic
  pt_diagnostic_code text,                  -- diagnosticCode
  pt_toponymy       text,                   -- toponymy (采集部位-患者级)
  -- 开单 req_
  req_section       text,                   -- section (检验科室代码)
  req_section_name  text,                   -- sectionName*
  req_mode          int,                    -- requestMode (平诊急诊)
  req_examinaim     text,                   -- examinaim (检验项目)
  req_examinaim_code text,                  -- examinaimCode (检验项目代码)
  -- 审核 chk_
  chk_doctor        text,                   -- checker
  chk_name          text,                   -- checkerName
  chk_doctor2       text,                   -- checker2
  chk_name2         text,                   -- checker2Name
  chk_time          timestamptz,            -- checkTime*
  chk_opinion       text,                   -- checkerOpinion
  chk_section       text,                   -- section
  chk_section_name  text,                   -- sectionName
  -- 接收 rec_
  rec_doctor        text,                   -- receiver
  rec_name          text,                   -- receiverName
  rec_time          timestamptz,            -- receiveTime
  -- 让步 cnc_
  cnc_flag          int,                    -- concessionFlag
  cnc_reason        text,                   -- concessionReason
  -- 撤销 cnl_ (E08 回写)
  cnl_reason        text,                   -- cancelReason
  cnl_doctor        text,                   -- canceler/executor
  cnl_name          text,                   -- cancelerName/executorName
  cnl_time          timestamptz,            -- cancelDate/executeDate
  cnl_section       text,                   -- section
  cnl_section_name  text                    -- sectionName
);
CREATE UNIQUE INDEX uq_lab_reports_rpt_id ON biz.lab_test_reports(rpt_id);
CREATE INDEX idx_lab_reports_sp_barcode ON biz.lab_test_reports(sp_barcode);
CREATE INDEX idx_lab_reports_org_lab ON biz.lab_test_reports(org_lab);
CREATE INDEX idx_lab_reports_pt_id ON biz.lab_test_reports(pt_id);
CREATE INDEX idx_lab_reports_chk_time ON biz.lab_test_reports(chk_time);
CREATE INDEX idx_lab_reports_rpt_status ON biz.lab_test_reports(rpt_status);
```

#### 子表 `lab_report_result_items` — resultInfoList（常规结果）

```sql
CREATE TABLE biz.lab_report_result_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  test_id         text NOT NULL,            -- testId*
  hos_test_id     text,                     -- hosTestId
  chinese_name    text NOT NULL,            -- chineseName*
  test_result     text,                     -- testResult
  ref_range       text,                     -- refRange
  ref_lo          text,                     -- refLo
  ref_hi          text,                     -- refHi
  measure_time    timestamptz,              -- measureTime
  hint            text,                     -- hint
  unit            text                      -- unit
);
CREATE INDEX idx_lab_rri_report_id ON biz.lab_report_result_items(report_id);
CREATE INDEX idx_lab_rri_test_id ON biz.lab_report_result_items(test_id);
```

#### 子表 `lab_report_plant_items` — plantInfoList（培养结果）

```sql
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
  plant_remark    text
);
CREATE INDEX idx_lab_rpi_report_id ON biz.lab_report_plant_items(report_id);
```

#### 子表 `lab_report_anti_items` — antiInfoList（药敏结果）

```sql
CREATE TABLE biz.lab_report_anti_items (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  sp_no           text,
  anti_id         text,                     -- antiId*
  anti_name       text,
  bio_id          text,
  bio_name        text,
  bio_type        int,
  kb_result       text,
  mic_result      text,
  etest_result    text,
  test_result     text,
  method          int,
  print_ord       int
);
CREATE INDEX idx_lab_rai_report_id ON biz.lab_report_anti_items(report_id);
```

#### 子表 `lab_report_bio_items` — bioInfoList（细菌结果）

```sql
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
  remark          text
);
CREATE INDEX idx_lab_rbi_report_id ON biz.lab_report_bio_items(report_id);
```

#### 子表 `lab_report_images` — E02/E04 图文报告

```sql
CREATE TABLE biz.lab_report_images (
  id              serial PRIMARY KEY,
  report_id       int NOT NULL REFERENCES biz.lab_test_reports(id) ON DELETE CASCADE,
  org_lab         text,
  sp_barcode      text,                     -- doctAdviseNo
  sp_no           text,                     -- sampleNo
  report_type     int,                      -- 1=整份报告
  pic_no          int,                      -- 图片流水号
  image_text      text,                     -- Base64 图片数据
  format          text,                     -- jpg/png/pdf
  image_url       text                      -- 外部URL
);
CREATE INDEX idx_lab_rimg_report_id ON biz.lab_report_images(report_id);
```

---

### 4.4 危急值 — 主表 + 1 子表

#### 主表 `lab_sample_warnings`

注意：危急值接口中的 `executor`（发布操作员）对应报告的审核者，前缀用 `chk_`；反馈接收人用 `rec_`。

```sql
CREATE TABLE biz.lab_sample_warnings (
  id              serial PRIMARY KEY,
  -- 机构
  org_lab         text NOT NULL,            -- labOrg*
  -- 标本关联
  sp_barcode      text,                     -- doctAdviseNo* → lab_specimen_items.sp_barcode
  sp_no           text,                     -- sampleNo
  -- 患者 pt_
  pt_name         text,                     -- patientName
  pt_sex          int,
  pt_birthday     date,
  pt_id           text,                     -- patientId
  -- 发布 chk_（接口中叫 executor/executorName，实为报告审核者触发）
  chk_doctor      text,                     -- executor
  chk_name        text,                     -- executorName
  chk_time        timestamptz,              -- executeDate*
  chk_section     text,                     -- section
  chk_section_name text,                   -- sectionName
  -- 反馈 rec_ (F03/F04 回写)
  feedback_status int,                      -- status
  rec_doctor      text,                     -- receiver (F03)
  rec_time        timestamptz,              -- receiveDate
  rec_note        text                      -- receiveNote
);
CREATE INDEX idx_lab_warn_sp_barcode ON biz.lab_sample_warnings(sp_barcode);
CREATE INDEX idx_lab_warn_chk_time ON biz.lab_sample_warnings(chk_time);
CREATE INDEX idx_lab_warn_org_lab ON biz.lab_sample_warnings(org_lab);
```

#### 子表 `lab_warn_log_items` — warnLogList

```sql
CREATE TABLE biz.lab_warn_log_items (
  id              serial PRIMARY KEY,
  warning_id      int NOT NULL REFERENCES biz.lab_sample_warnings(id) ON DELETE CASCADE,
  warn_info       text NOT NULL,            -- warnInfo*
  test_id         text,                     -- testId
  test_name       text,                     -- testName*
  test_result     text,                     -- testResult
  -- 反馈明细 (F03/F04)
  rpt_id          text,                     -- reportId
  rec_doctor      text,                     -- receiver
  rec_time        timestamptz,              -- receiveDate
  rec_note        text                      -- receiveNote
);
CREATE INDEX idx_lab_wli_warning_id ON biz.lab_warn_log_items(warning_id);
```

---

### 4.5 检验申请 — 主表 + 1 子表

#### 主表 `lab_applications`

```sql
CREATE TABLE biz.lab_applications (
  id              serial PRIMARY KEY,
  application_id  text NOT NULL,            -- applicationId* UNIQUE
  org_sending     text NOT NULL,            -- sendingOrg*
  sp_barcode      text,                     -- doctAdviseNo
  -- 患者 pt_
  pt_name         text,                     -- patientName*
  pt_sex          text,                     -- sex
  pt_age          text,                     -- age
  pt_id           text,                     -- patientId*
  pt_phone        text,                     -- patientPhone
  pt_type         text,                     -- patientType
  pt_diagnostic   text,                     -- diagnostic
  pt_bed_no       text,                     -- bedNo
  pt_ward_name    text,                     -- wardName
  -- 开单 req_
  req_section_name text,                    -- sectionName
  req_mode        text,                     -- requestMode
  req_doctor      text,                     -- requester
  req_time        timestamptz,              -- requestTime*
  -- 状态
  status          text,                     -- status*
  accept_time     timestamptz,              -- acceptTime
  send_flag       int,                      -- sendFlag
  reason          text                      -- 退回原因
);
CREATE UNIQUE INDEX uq_lab_app_application_id ON biz.lab_applications(application_id);
CREATE INDEX idx_lab_app_org_sending ON biz.lab_applications(org_sending);
CREATE INDEX idx_lab_app_pt_id ON biz.lab_applications(pt_id);
CREATE INDEX idx_lab_app_status ON biz.lab_applications(status);
CREATE INDEX idx_lab_app_req_time ON biz.lab_applications(req_time);
```

#### 子表 `lab_application_items` — itemInfoList

```sql
CREATE TABLE biz.lab_application_items (
  id              serial PRIMARY KEY,
  application_id  int NOT NULL REFERENCES biz.lab_applications(id) ON DELETE CASCADE,
  req_item_code   text NOT NULL,            -- itemCode*
  req_item_name   text,                     -- itemName
  compose_type    text,                     -- composeType
  sp_type         text,                     -- sampleType
  req_mode        text,                     -- requestMode
  req_doctor      text,                     -- requester
  preparation_note text                    -- preparationNote
);
CREATE INDEX idx_lab_ai_application_id ON biz.lab_application_items(application_id);
```

---

### 4.6 质控数据 — `lab_qc_data`（H01-H05，单表无子表）

```sql
CREATE TABLE biz.lab_qc_data (
  id               serial PRIMARY KEY,
  org_lab          text,                    -- labOrg*
  qc_type          text,                    -- indoor/outdoor
  qc_date          date,                    -- 质控日期*
  instrument_code  text,                    -- 仪器编码
  test_item_code   text,                    -- 检验项目编码*
  qc_value         numeric(10,2),           -- 质控值
  qc_target        numeric(10,2),           -- 靶值
  qc_sd            numeric(10,2)            -- 标准差
);
CREATE INDEX idx_lab_qc_org_lab ON biz.lab_qc_data(org_lab);
CREATE INDEX idx_lab_qc_item ON biz.lab_qc_data(test_item_code);
CREATE INDEX idx_lab_qc_date ON biz.lab_qc_data(qc_date);
```

---

### 4.7 设备信息 — `lab_device_info`（I01-I03，单表无子表）

```sql
CREATE TABLE biz.lab_device_info (
  id            serial PRIMARY KEY,
  org_lab       text,                       -- labOrg*
  device_code   text NOT NULL,              -- deviceCode*
  device_name   text,                       -- deviceName
  model         text,
  sn            text,
  manufacturer  text,
  UNIQUE(org_lab, device_code)
);
```

---

## 五、表清单

| 表 | 类型 | 列数 | 对应接口 |
|----|------|------|---------|
| `lab_sample_types` | 字典 | 5 | A01/A07 |
| `lab_request_items` | 字典主 | 12 | A02/A08 |
| `lab_request_item_tests` | 字典子 | 3 | A02 testInfoList |
| `lab_request_item_children` | 字典子 | 3 | A02 itemInfoList |
| `lab_test_items` | 字典 | 11 | A03/A09 |
| `lab_bio_items` | 字典 | 11 | A04/A10 |
| `lab_anti_items` | 字典 | 10 | A05/A11 |
| `lab_specimens` | L1 主表 | 10 | B02 (送检单级) |
| `lab_specimen_items` | L2 主表 | 51 | B02/D01/D02/D04 (标本级) |
| `lab_specimen_barcode_items` | L3 子表 | 9 | B02 barcodeDetailList |
| `lab_test_reports` | 主表 | 55 | E01/E03/E05/E08/E09 |
| `lab_report_result_items` | 子表 | 11 | E01/E03 resultInfoList |
| `lab_report_plant_items` | 子表 | 8 | E01/E03 plantInfoList |
| `lab_report_anti_items` | 子表 | 12 | E01/E03 antiInfoList |
| `lab_report_bio_items` | 子表 | 8 | E01/E03 bioInfoList |
| `lab_report_images` | 子表 | 9 | E02/E04 |
| `lab_sample_warnings` | 主表 | 18 | F01/F02/F03/F04 |
| `lab_warn_log_items` | 子表 | 10 | F01/F02 warnLogList |
| `lab_applications` | 主表 | 20 | P01/P02 |
| `lab_application_items` | 子表 | 7 | P01/P02 itemInfoList |
| `lab_qc_data` | 单表 | 8 | H01-H05 |
| `lab_device_info` | 单表 | 6 | I01-I03 |

**共 23 张表。**

---

## 六、跨表字段一致性检查

同一实体前缀的字段，类型和语义跨表保持一致：

| 字段 | lab_specimen_items | lab_test_reports | lab_sample_warnings | lab_applications |
|------|:-:|:-:|:-:|:-:|
| `pt_name` | text | text | text | text |
| `pt_sex` | int | int | int | text |
| `pt_age` | int | int | — | text |
| `pt_birthday` | date | date | date | — |
| `pt_id` | text | text | text | text |
| `pt_phone` | text | — | — | text |
| `pt_diagnostic` | text | text | — | text |
| `sp_barcode` | text UNIQUE | text INDEX | text INDEX | text |
| `sp_no` | text | text | text | — |
| `sp_type` | text | text | — | — |
| `sp_describe` | text | text | — | — |
| `req_doctor` | text | — | — | text |
| `req_section_name` | text | text | — | text |
| `chk_doctor` | — | text | text | — |
| `chk_time` | — | timestamptz | timestamptz | — |
| `rec_doctor` | text | text | text | — |
| `org_lab` | — | text | text | — |
| `org_sending` | — | text | — | text |

（`—` = 该表不适用此字段）

---

## 七、统计查询示例

```sql
-- 按检验项目统计报告量（近 30 天）
SELECT ri.chinese_name, COUNT(DISTINCT tr.id) AS report_count
FROM lab_report_result_items ri
JOIN lab_test_reports tr ON tr.id = ri.report_id
WHERE tr.chk_time >= now() - interval '30 days'
GROUP BY ri.chinese_name ORDER BY report_count DESC;

-- 危急值率（按审核科室 + 检验项目）
SELECT tr.chk_section_name, wli.test_name,
       COUNT(DISTINCT wli.id) AS warn_count
FROM lab_warn_log_items wli
JOIN lab_sample_warnings sw ON sw.id = wli.warning_id
JOIN lab_test_reports tr ON tr.sp_barcode = sw.sp_barcode
WHERE sw.chk_time >= now() - interval '30 days'
GROUP BY tr.chk_section_name, wli.test_name
ORDER BY warn_count DESC;

-- 标本→报告全链路追踪
SELECT si.sp_barcode, si.pt_name, si.sp_type, si.sp_status,
       tr.rpt_id, tr.rpt_status, tr.chk_time,
       ri.test_id, ri.chinese_name, ri.test_result, ri.unit
FROM lab_specimen_items si
JOIN lab_test_reports tr ON tr.sp_barcode = si.sp_barcode
JOIN lab_report_result_items ri ON ri.report_id = tr.id
WHERE si.sp_barcode = 'BCXXXXXXXX';

-- 质控趋势
SELECT test_item_code, date_trunc('month', qc_date) AS month,
       AVG(qc_value), AVG(qc_target), STDDEV(qc_value)
FROM lab_qc_data WHERE is_valid = true
GROUP BY test_item_code, month ORDER BY test_item_code, month;
```

---

## 八、服务层注意事项

### 写入

主子表写入用 PG 函数包裹事务：

```sql
CREATE FUNCTION ichse.lab_nx_rp_e01_submit_report(json) RETURNS json AS $$
DECLARE v_id int;
BEGIN
  INSERT INTO biz.lab_test_reports (rpt_id, sp_barcode, pt_name, ...)
    VALUES ($1->'param'->>'reportId', ...) RETURNING id INTO v_id;

  INSERT INTO biz.lab_report_result_items (report_id, test_id, chinese_name, ...)
    SELECT v_id, ... FROM jsonb_to_recordset($1->'param'->'resultInfoList') AS (...);

  -- plantInfoList, antiInfoList, bioInfoList 同理...

  RETURN jsonb_build_object('code', 200, 'reportId', v_id);
END;
$$ LANGUAGE plpgsql;
```

### 读取

用视图 JOIN 子表 + `jsonb_agg` 组装回接口原始 JSON 格式，保证对外接口契约不变。

---

## 九、待定事项

- [ ] QC/Device 的 H/I 类接口参数尚未录入 SQLite（当前 field_cnt=0），后续补充
- [ ] 统计查询是否需要物化视图（按天/按月汇总）
- [ ] 患者信息是否进一步抽取 `lab_patients` 表（当前用前缀隔离，暂不拆，观察查询性能后再定）
- [ ] 新业务域接入时，实体前缀复用本规范，如有新实体在本章第二节注册
