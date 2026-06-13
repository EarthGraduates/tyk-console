# ICHSE Development Conventions v2.0

> 版本：v2.0 | 日期：2026-06-13
> 适用范围：全部业务域（LAB / IMG / PATH / ECG / CSSD）及共享模块
> 本文档是项目命名、目录结构、数据库设计的唯一权威规范，所有开发必须遵循。

---

## 一、业务域编码（Business Domain Codes）

所有业务域使用**国际通用英文缩写**，3-4 个大写字母。

| 业务域 | 编码 | 来源 | 说明 |
|--------|------|------|------|
| 检验中心 | **LAB** | Laboratory | 临床检验，HL7/LOINC 标准术语 |
| 影像中心 | **IMG** | Medical Imaging | 医学影像，DICOM 标准术语 |
| 病理中心 | **PATH** | Pathology | 病理学，SNOMED/ICD 标准术语 |
| 心电中心 | **ECG** | Electrocardiography | 心电检查，国际通用缩写 |
| 消毒供应中心 | **CSSD** | Central Sterile Supply Department | WHO 标准术语 |

**规则：**
- 所有代码、命名中引用业务域时，**一律使用编码**，不得使用中文或拼音
- 编码统一大写，不随语境变化
- 新业务接入时，必须先在本表中注册编码

---

## 二、数据库规范

### 2.1 Schema 划分

| Schema | 用途 | 业务域区分 |
|--------|------|-----------|
| `ichse` | 平台管理数据（用户、API 定义、密钥、日志） | **不分**，共享 |
| `biz` | 业务数据（接口元数据 + 校验规则 + 各域业务表） | 业务表加域前缀 |

### 2.2 业务表命名

```
biz.{biz_domain}_{table_name}
```

**示例：**

| 表名 | 说明 |
|------|------|
| `biz.lab_sample_types` | 检验中心 — 样本类型字典 |
| `biz.lab_request_items` | 检验中心 — 检验项目字典 |
| `biz.lab_specimens` | 检验中心 — 标本 |
| `biz.lab_test_reports` | 检验中心 — 检验报告 |
| `biz.img_studies` | 影像中心 — 检查记录 |
| `biz.img_reports` | 影像中心 — 影像报告 |
| `biz.path_specimens` | 病理中心 — 病理标本 |
| `biz.path_reports` | 病理中心 — 病理报告 |
| `biz.ecg_exams` | 心电中心 — 心电检查 |
| `biz.cssd_packages` | 消毒供应中心 — 消毒包 |

### 2.3 共享表（不加域前缀）

这些表属于**平台基础设施**，不隶属于任何单一业务域：

| 表名 | 说明 |
|------|------|
| `biz.interfaces` | 接口定义元数据（含 `biz_domain` 字段区分域） |
| `biz.interface_fields` | 接口参数字段定义 |
| `biz.validation_rules` | 校验规则配置 |
| `biz.validation_logs` | 校验日志记录 |

### 2.4 统一基础字段

所有 `biz` 表（含共享表和业务表）**必须**包含以下字段：

```sql
id            serial PRIMARY KEY,
is_valid      boolean DEFAULT true,         -- 逻辑删除标记
version       int DEFAULT 1,                -- 乐观锁版本号
created_at    timestamptz DEFAULT now(),    -- 创建时间
updated_at    timestamptz DEFAULT now(),    -- 最后修改时间
deleted_at    timestamptz DEFAULT NULL      -- 逻辑删除时间（仅记录）
```

### 2.5 PostgREST 视图

每张业务表通过 `ichse` schema 的视图暴露给 PostgREST，视图自动过滤 `is_valid = true`：

```sql
CREATE VIEW ichse.lab_sample_types AS
SELECT * FROM biz.lab_sample_types WHERE is_valid = true;
```

视图命名规则：`ichse.{biz_domain}_{table_name}`，与 `biz` 中表名一致。

### 2.6 索引命名（阿里规范）

| 前缀 | 含义 | 示例 |
|------|------|------|
| `pk_` | 主键 | `pk_lab_sample_types` |
| `uq_` | 唯一约束 | `uq_lab_sample_types_org_type` |
| `idx_` | 普通索引 | `idx_lab_sample_types_lab_org` |
| `ck_` | CHECK 约束 | `ck_lab_status` |
| `fk_` | 外键 | `fk_lab_report_specimen` |

### 2.7 迁移文件

```
database/postgresql/migrations/
├── 001_schema.sql              # ichse schema + 管理表（共享）
├── 002_auth_and_rls.sql        # 认证授权（共享）
├── ...
├── 020_lab_biz_tables.sql      # 检验中心业务表
├── 021_lab_functions.sql       # 检验中心 PG 函数
├── 030_img_biz_tables.sql      # 影像中心业务表
├── 030_img_functions.sql       # 影像中心 PG 函数
└── ...
```

**规则：**
- 共享模块迁移按原有编号继续
- 每个业务域分配一个号段（LAB: 020-029, IMG: 030-039, PATH: 040-049, ECG: 050-059, CSSD: 060-069）
- 每个业务域至少拆为两张迁移：`{号段}_biz_tables.sql`（建表+视图+种子数据）和 `{号段}_functions.sql`（PG 函数）

---

## 三、接口标识规范（Interface ID）

### 3.1 格式

```
{BIZ_DOMAIN}-{PLATFORM}-{CATEGORY}-{DIR}{SEQ:03d}
```

| 段 | 含义 | 值域 | 示例 |
|----|------|------|------|
| BIZ_DOMAIN | 业务域编码 | `LAB` / `IMG` / `PATH` / `ECG` / `CSSD` | `LAB` |
| PLATFORM | 平台码 | 2-3 大写字母，如 `NX`（南雄） | `NX` |
| CATEGORY | 业务分类码 | 2 大写字母（见下表） | `MD` |
| DIR | 数据流向 | `I`(入站) / `O`(出站) | `O` |
| SEQ | 同组序号 | 3 位零填充，从 `001` 起 | `001` |

**示例：**
- `LAB-NX-MD-O001` — 检验中心-南雄-主数据同步-出站-001
- `IMG-NX-RP-I001` — 影像中心-南雄-报告-入站-001
- `ECG-NX-EX-O001` — 心电中心-南雄-检查-出站-001

### 3.2 分类码表（CATEGORY）

| 编码 | 含义 | 适用域 |
|------|------|--------|
| `MD` | Master Data — 主数据同步（字典对照） | 全部 |
| `SP` | Specimen — 标本采集与送检 | LAB, PATH |
| `RC` | Receive — 标本接收与登记 | LAB, PATH |
| `RP` | Report — 报告管理 | 全部 |
| `CV` | Critical Value — 危急值管理 | LAB, IMG, PATH, ECG |
| `QC` | Quality Control — 质控管理 | LAB |
| `EQ` | Equipment — 设备管理 | 全部 |
| `QR` | Query — 申请/查询 | 全部 |
| `EX` | Exam — 检查记录 | IMG, ECG |
| `PK` | Package — 消毒包管理 | CSSD |
| `ST` | Sterilization — 灭菌流程 | CSSD |

新增分类码时，必须在本表中注册并说明适用域。

### 3.3 `biz.interfaces` 表结构

```sql
CREATE TABLE biz.interfaces (
  id              serial PRIMARY KEY,
  interface_id    text NOT NULL UNIQUE,     -- LAB-NX-MD-O001
  biz_domain      text NOT NULL,            -- LAB / IMG / PATH / ECG / CSSD
  platform        text NOT NULL,            -- NX
  biz_category    text,                     -- A.主数据同步（字典对照）
  category_code   text,                     -- MD
  biz_id          text,                     -- A07
  interface_name  text NOT NULL,            -- 检验样本类型下载
  func_name       text NOT NULL UNIQUE,     -- lab_nx_md_get_sample_type
  direction       text,                     -- 送检方 / 临检中心方
  data_flow       text,                     -- I / O
  http_method     text DEFAULT 'POST',
  url             text,
  description     text,
  status          text DEFAULT 'active',
  -- 统一基础字段
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
```

**关键字段说明：**
- `interface_id`：全局唯一接口标识，格式见 3.1
- `biz_domain`：业务域编码，**必填**，用于前端/脚本按域筛选
- `func_name`：对应的 PG 函数名，格式见第四章

---

## 四、函数命名规范

### 4.1 PG 函数

```
{biz_domain}_{platform}_{category_code}_{biz_id}_{operation}
```

全部小写，段间用下划线连接。

**示例：**
- `lab_nx_md_a07_get_sample_type` — 检验中心-南雄-主数据-A07-获取样本类型
- `img_nx_rp_b03_submit_report` — 影像中心-南雄-报告-B03-提交报告
- `ecg_nx_ex_c01_upload_exam` — 心电中心-南雄-检查-C01-上传检查

**简化规则：** 当 `biz_id` 为纯序号无业务含义时，可省略，如：
- `lab_nx_sp_upload_specimen`（省略 A01）

### 4.2 PostgREST 暴露

函数创建在 `ichse` schema 下，通过 PostgREST RPC 调用：

```sql
CREATE OR REPLACE FUNCTION ichse.lab_nx_md_get_sample_type(json)
RETURNS json AS $$ ... $$ LANGUAGE plpgsql;
```

**暴露路径：** `POST /rpc/lab_nx_md_get_sample_type`

### 4.3 Python services 路由

`services/routes/gateway.py` 统一入口：
```
POST /rest/{func_name}
```

Tyk listen_path 格式：
```
/api/{platform}/{biz_domain}/{category_lower}/{direction_slug}/{operation}
```

---

## 五、API 注册规范

### 5.1 数据模型

API 定义以 `ichse.api_definitions` (PG) 为权威源。Tyk 是运行时执行引擎。

```
biz.interfaces (服务元数据)
  │  interface_id 关联
  ▼
ichse.api_definitions (API 定义，PG 权威源)
  │  POST /tyk/apis/
  ▼
Tyk Gateway (运行时)
```

### 5.2 API 注册方式

**一键注册**（从接口管理页发起）：
1. 选择 `biz.interfaces` 中的接口
2. 调用 `POST /admin/register-api` → INSERT `api_definitions` + POST Tyk

**手动注册**（从 API 定义页发起）：
1. 填写 API 定义表单
2. 写 `api_definitions` + POST Tyk

### 5.3 启动注册

Python services 启动时，从 PG 读取所有 `status='active'` 的 API，幂等 POST 到 Tyk。不写 JSON 文件，不挂载目录。

### 5.4 已废弃

- `generate_tyk_apis.py` — 删除，不再生成 JSON 文件
- `api-definitions/` 目录 — 删除，加入 `.gitignore`
- Tyk apps 目录挂载 — 不再需要

---

## 六、前端规范

### 6.1 页面目录结构

```
src/pages/
├── dashboard/                    # 系统仪表板（共享）
├── business/                     # 业务总览入口（共享）
│   ├── lab/                      # 检验中心
│   │   ├── sample-types/         #   样本类型字典
│   │   ├── request-items/        #   检验项目字典
│   │   ├── specimens/            #   标本管理
│   │   ├── reports/              #   报告管理
│   │   ├── quality-control/      #   质控管理
│   │   └── devices/              #   设备管理
│   ├── img/                      # 影像中心
│   │   ├── studies/
│   │   ├── reports/
│   │   └── devices/
│   ├── path/                     # 病理中心
│   ├── ecg/                      # 心电中心
│   └── cssd/                     # 消毒供应中心
├── apis/                         # API 定义（共享，PG权威源+Tyk状态）
├── interfaces/                   # 接口管理（共享，查看biz.interfaces+一键注册）
├── keys/                         # 密钥管理（共享）
├── gateway/                      # 网关管理（共享）
├── validation-rules/             # 校验规则管理（共享）
├── users/                        # 用户管理（共享）
├── audit/                        # 审计日志（共享）
├── security/                     # 安全策略（共享）
├── settings/                     # 系统设置（共享）
└── login/                        # 登录（共享）
```

**规则：**
- 业务数据管理页面：`src/pages/business/{biz_domain}/{resource}/index.tsx`
- 共享功能页面：`src/pages/{feature}/index.tsx`
- 每个页面组件一个目录，入口文件为 `index.tsx`

### 6.2 路由规范

```typescript
// 业务数据页
/business/{biz_domain}/{resource}    // 如 /business/lab/sample-types

// 共享功能页（保持现有路由不变）
/apis                                  // API 服务
/keys                                  // 密钥管理
/validation-rules                      // 校验规则
/users                                 // 用户管理
/audit                                 // 审计日志
...
```

### 6.3 菜单结构

```
系统仪表板  (system_admin, security_admin)
业务仪表板  (audit_admin, business_user, viewer)
  ├── 检验中心  → /business/lab
  ├── 影像中心  → /business/img
  ├── 病理中心  → /business/path
  ├── 心电中心  → /business/ecg
  └── 消毒供应  → /business/cssd
网关管理    (system_admin)
API 服务    (system_admin, business_user)
密钥管理    (system_admin, business_user)
历史记录    (all)
校验规则    (system_admin, security_admin)
用户管理    (system_admin, security_admin)
审计日志    (system_admin, audit_admin)
安全策略    (security_admin)
系统设置    (all)
```

业务仪表板下按 `biz_domain` 展示二级菜单，仅显示当前用户有权限的业务域。

### 6.4 Provider 数据源

```typescript
// src/providers/data.ts
// 业务数据统一走 ichseDb provider（PostgREST）
// 按 biz_domain 参数化查询

// 示例：获取检验中心样本类型
const { data } = await ichseDb.getList('lab_sample_types', {
  filters: [{ field: 'lab_org', operator: 'eq', value: orgCode }],
});
```

**规则：** PostgREST 视图名即 resource 名，前端 `getList` 的 resource 参数与视图名一致。

---

## 七、Python 服务规范

### 7.1 目录结构

```
services/
├── main.py                       # FastAPI 入口（共享）
├── config.py                     # 环境配置（共享）
├── requirements.txt              # 依赖（共享）
├── engine/                       # 校验引擎（共享）
│   ├── __init__.py
│   ├── validator.py              #   ValidationEngine + BaseValidator
│   ├── regex_validator.py
│   ├── domain_validator.py
│   └── cross_field_validator.py
├── loader/                       # 规则加载（共享）
│   ├── __init__.py
│   └── rule_loader.py            #   Redis → PG fallback
├── sink/                         # 日志写入（共享）
│   ├── __init__.py
│   ├── log_writer.py             #   异步写 Redis 队列
│   └── batch_flusher.py          #   定时批量刷 PG
├── routes/                       # HTTP 路由（共享）
│   ├── __init__.py
│   ├── gateway.py                #   POST /rest/{func_name} 统一入口
│   └── admin.py                  #   POST /admin/refresh-rules
├── plugins/                      # 协议适配（共享）
│   └── __init__.py               #   未来 SOAP 等
└── scripts/                      # 数据导入/生成脚本
    ├── lab/
    │   ├── import_interfaces.py  #   从 SQLite 导入接口元数据
    │   ├── generate_test_data.py #   生成测试数据并调 Tyk
    ├── img/
    │   ├── import_interfaces.py
    │   ├── generate_test_data.py
        ├── path/
    ├── ecg/
    └── cssd/
```

**规则：**
- `engine/`、`loader/`、`sink/`、`routes/`、`plugins/` 是**共享模块**，不对任何业务域做特化
- `scripts/` 按业务域分目录：`scripts/{biz_domain}/`
- 每个业务域的脚本结构一致：`import_interfaces.py` + `generate_test_data.py`- 共享脚本工具函数抽取到 `services/utils/` 或 `services/scripts/common.py`

### 7.2 校验引擎规则

校验引擎**不感知业务域**。它只认 `interface_id` → 加载规则 → 执行校验。

```
请求 → Tyk → services (gateway.py)
              → 1. 根据 URL 解析 func_name
              → 2. 查 biz.interfaces 获取 interface_id
              → 3. ValidationEngine.validate(interface_id, payload)
              → 4. 通过 → PostgREST → PG
              → 5. 失败 → 返回 400 + errors
              → 6. 异步写校验日志
```

---

## 八、测试数据规范

### 8.1 目录结构

```
test-data/
├── lab/
│   ├── interfaces.sql           # 接口元数据种子数据
│   ├── seed.sql                 # 业务表种子数据（样本类型等）
│   └── payloads/                # 校验测试用例
│       ├── valid/               #   合法请求
│       └── invalid/             #   非法请求
├── img/
├── path/
├── ecg/
└── cssd/
```

### 8.2 测试数据文件命名

```
{interface_id}_{case_name}.json
```

示例：
- `test-data/lab/payloads/valid/LAB-NX-MD-O001_sample_type_ok.json`
- `test-data/lab/payloads/invalid/LAB-NX-MD-O001_empty_center_org.json`

---

## 九、共享与业务专属边界清单

### 共享模块（不加业务前缀）

| 模块 | 说明 |
|------|------|
| 校验引擎 `engine/` | 正则/值域/跨字段校验，逻辑完全通用 |
| 规则加载 `loader/` | 从 Redis 加载规则，与业务无关 |
| 日志写入 `sink/` | 异步日志写入 Redis + 批量刷 PG |
| `routes/gateway.py` | 统一入口 `/rest/{func_name}` |
| `routes/admin.py` | 规则刷新 `/admin/refresh-rules` |
| `biz.interfaces` | 接口元数据表，通过 `biz_domain` 字段区分 |
| `biz.interface_fields` | 参数字段表 |
| `biz.validation_rules` | 校验规则表 |
| `biz.validation_logs` | 校验日志表 |
| `ichse.users` | 用户表 |
| `ichse.api_definitions` | API 定义管理表 |
| `ichse.api_keys` | 密钥管理表 |
| Tyk 网关管理 | API 定义/密钥 CRUD |
| 认证授权 | 登录/RBAC/角色 |
| 审计日志 | 操作审计 |
| 安全配置 | 安全策略 |

### 业务专属模块（必须加 `{biz_domain}` 前缀）

| 模块 | 前缀位置 | 示例 |
|------|---------|------|
| 业务数据表 | `biz.{biz_domain}_*` | `biz.lab_sample_types` |
| PG 函数 | `ichse.{biz_domain}_*` | `ichse.lab_nx_md_get_sample_type` |
| 接口 ID | `{BIZ_DOMAIN}-*` | `LAB-NX-MD-O001` |
| API 注册 | `POST /admin/register-api` | 一键注册到 `ichse.api_definitions` + Tyk |
| 导入脚本 | `scripts/{biz_domain}/` | `scripts/lab/import_interfaces.py` |
| 测试数据 | `test-data/{biz_domain}/` | `test-data/lab/seed.sql` |
| 前端业务页 | `pages/business/{biz_domain}/` | `pages/business/lab/sample-types/` |
| 前端路由 | `/business/{biz_domain}/*` | `/business/lab/sample-types` |

---

## 十、新业务域接入清单

当接入一个新业务域时，按以下顺序执行：

1. **[ ] 注册业务域编码**：在本文档第一章确认编码（如 `IMG`），无冲突则注册
2. **[ ] 申请分类码**：确认需要新增的 `CATEGORY` 码（如 IMG 新增 `EX`），在 3.2 表注册
3. **[ ] 建业务表**：`database/postgresql/migrations/{号段}_img_biz_tables.sql`
   - DDL：`biz.img_*` 表
   - PostgREST 视图：`ichse.img_*`
   - 种子数据（如有）
4. **[ ] 建 PG 函数**：`database/postgresql/migrations/{号段}_img_functions.sql`
   - `ichse.img_nx_*` 函数
5. **[ ] 导入接口元数据**：编写 `services/scripts/img/import_interfaces.py`，插入 `biz.interfaces`（带 `biz_domain='IMG'`）
6. **[ ] 注册 API**：在接口管理页一键注册，或通过 API 定义页手动注册
7. **[ ] 前端业务页面**：`src/pages/business/img/{resource}/index.tsx`
8. **[ ] 前端路由和菜单**：在 `App.tsx` 注册路由，菜单增加影像中心入口
9. **[ ] 测试数据**：`test-data/img/` 目录和种子数据
10. **[ ] 校验规则配置**：在前端校验规则页为 IMG 接口配置规则

---

## 十一、命名速查表

| 层级 | 格式 | 示例 |
|------|------|------|
| 业务域编码 | 大写英文 3-4 字母 | `LAB`, `IMG`, `PATH`, `ECG`, `CSSD` |
| 业务表 | `biz.{domain}_{table}` | `biz.lab_sample_types` |
| PostgREST 视图 | `ichse.{domain}_{table}` | `ichse.lab_sample_types` |
| PG 函数 | `ichse.{domain}_{platform}_{cat}_{bizid}_{op}` | `ichse.lab_nx_md_a07_get_sample_type` |
| 接口 ID | `{DOMAIN}-{PLAT}-{CAT}-{DIR}{SEQ}` | `LAB-NX-MD-O001` |
| Tyk API ID | `ichse-{interface_id.lower()}` | `ichse-lab-nx-md-o001` |
| Tyk listen_path | `/api/{plat}/{domain}/{cat}/{dir}/{op}` | `/api/nx/lab/md/centerljzx/uploadSampleType` |
| Python 脚本 | `services/scripts/{domain}/{purpose}.py` | `services/scripts/lab/import_interfaces.py` |
| 前端路由 | `/business/{domain}/{resource}` | `/business/lab/sample-types` |
| 前端页面 | `src/pages/business/{domain}/{resource}/` | `src/pages/business/lab/sample-types/` |
| 测试数据 | `test-data/{domain}/` | `test-data/lab/payloads/` |

---

## 五、文件组织规范

### 5.1 目录结构

```
.
├── README.md                  # 项目入口
├── CONTEXT.md                 # 领域语言（skill 期望，勿改名）
├── CLAUDE.md                  # Agent 行为指南
│
├── docs/
│   ├── conventions.md         # 本文件 — 开发规范
│   ├── architecture.md        # 架构总览
│   ├── security.md            # 安全合规
│   │
│   ├── adr/                   # 架构决策记录（skill 期望）
│   │   └── NNNN-slug.md
│   │
│   ├── agents/                # Agent 配置
│   │   └── subject.md
│   │
│   └── designs/               # 设计文档
│       ├── subject.md         #   设计（不加日期，活的文档）
│       └── plans/             #   实施计划
│           └── YYYY-MM-DD-slug.md  #   计划（加日期，时间点快照）
│
├── dev-logs/
│   ├── README.md              # 日志规范
│   ├── YYYY-MM-DD-slug.md     # 阶段/版本总结
│   └── vX.Y-summary.md        # 版本总结
│
├── database/
│   └── postgresql/migrations/ # 迁移文件（按序号命名）
```

### 5.2 命名规则

| 类型 | 目录 | 命名格式 | 示例 |
|------|------|---------|------|
| 领域语言 | 根 | `CONTEXT.md` | — |
| Agent 指南 | 根 | `CLAUDE.md` | — |
| 架构决策 | `docs/adr/` | `NNNN-slug.md` | `0001-api-deactivate-no-key-handling.md` |
| 设计文档 | `docs/designs/` | `subject.md` | `database.md` |
| 实施计划 | `docs/designs/plans/` | `YYYY-MM-DD-slug.md` | `2026-06-12-validation-engine.md` |
| 参考规范 | `docs/` | `subject.md` | `conventions.md` |
| 开发日志 | `dev-logs/` | `YYYY-MM-DD-slug.md` | `2026-05-20-phase-summary.md` |

### 5.3 核心原则

1. **设计不加日期，计划加日期** — 设计文档持续更新，计划是时间点快照
2. **全部 kebab-case** — 不用下划线、大写、空格
3. **不加版本号** — 当前版本即文件，旧版本在 git 历史
4. **每个目录单一职责** — 不混放不同类型文件
5. **ADRs + CONTEXT.md 是 skills 的唯一入口** — 其他文档按需引用，不强依赖

### 5.4 禁止事项

- 禁止在根目录新增非标准 `.md` 文件
- 禁止在 `docs/` 根下放设计或计划（必须进子目录）
- 禁止文件名中使用版本号（`v1`, `v2`, `-v2`, `-old`）
- 禁止 `dev-logs/` 放单日/单 bug 碎片日志（只保留阶段/版本总结）

---

## 十二、前端交互规范

### 12.1 表格操作按钮

**规则：表格操作按钮放在表格上方工具栏，不放进行内。**

```
┌────────────────────────────────────────────────┐
│  [新建] [启用] [停用] [删除]                    │  ← 操作按钮在工具栏
├────┬───────────────────────────────────────────┤
│ ☐  │ ID        │ 名称      │ 状态    │ ...     │  ← 首列复选框
├────┼───────────────────────────────────────────┤
│ ☑  │ LAB-...   │ 样本下载   │ active  │ ...     │
│ ☐  │ LAB-...   │ 标本上传   │ inactive│ ...     │
└────┴───────────────────────────────────────────┘
```

**行为：**
- 首列复选框支持单选/多选
- 工具栏按钮根据选中行状态动态启用/禁用（未选中时灰色不可点）
- 批量操作时，选中的行必须状态一致（如不能同时选 active 和 archived 的行点"启用"）
- 单行操作通过选中该行 + 点击工具栏按钮完成，不放行内操作列

**原因：**
- 行内按钮密度过高，多列时表格臃肿
- 批量操作（启用/停用/删除多条）自然兼容
- 操作可见性更高（按钮都在顶部固定位置，不用逐行扫描）
