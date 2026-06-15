# 2026-06-15 检验业务页面 Phase 1 — 全流程页面 + 采集机构分离 + 报告审核

## 概述

完成检验中心全流程业务页面（19 页），覆盖从字典维护到标本流转再到报告审核的完整链路。同时支持采集机构与送检机构分离，引入双人报告审核流程。

## Phase 1: 采集机构分离（DB + PG 函数）

业务需求：采集机构（采样点）与送检机构（申请单位）是不同实体，需要在申请和报告层面分别记录。

- **迁移 `016_lab_collecting_org.sql`**: 给 `biz.lab_applications` 和 `biz.lab_test_reports` 添加 `col_org_code`/`col_org_name` 列
- 更新 P01（插入申请）、P02（查询申请）、E01（插入报告）、E03（更新报告）四个 PG 函数，读/写采集机构字段
- 标本链路（B02/D01）已原生支持，无需修改

## Phase 2: 报告审核流程（DB + PG 函数 + 接口注册）

业务需求：报告需经双人审核（一审 + 二审）方可签发，同人不得一审二审兼任，夜间值班时可通过开关放宽限制。

- **迁移 `017_lab_review_workflow.sql`**:
  - 创建 `biz.lab_review_logs` 审核日志表
  - `rpt_status` 添加 CHECK 约束，状态机: `pending_first_review → pending_second_review → issued / rejected / canceled`
  - 新建 4 个 PG 函数:
    - E10（一审）：提交一审结果，通过后状态变为 `pending_second_review`
    - E11（二审）：提交二审结果，含同人校验 + 夜班开关，通过后状态变为 `issued`
    - E12（待审队列）：按状态查询待一审/二审报告列表
    - E13（审核日志）：按报告 ID 查询审核历史
  - 更新 E01（默认状态 `pending_first_review`）、E08（扩展可撤销状态范围）
  - 注册 4 个新接口: LAB-NX-RP-O004/O005/I005/I006

## Phase 3: 前端业务页面（19 页）

### 3.0 基础设施

- `src/providers/lab-db.ts` — LAB 数据访问层（PostgREST + RPC，Vite proxy `/db`）
- `src/App.tsx` — MenuItem 支持 children 子菜单，注册全部业务路由，按角色过滤

### 页面分组

#### A 组 — 字典管理（5 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 样本类型字典 | `/business/lab/sample-types` | `/db/lab_sample_types` |
| 检验项目字典 | `/business/lab/request-items` | `/db/lab_request_items` |
| 报告项目字典 | `/business/lab/test-items` | `/db/lab_test_items` |
| 细菌字典 | `/business/lab/bio-items` | `/db/lab_bio_items` |
| 药敏字典 | `/business/lab/anti-items` | `/db/lab_anti_items` |

#### B 组 — 申请管理（2 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 检验申请 | `/business/lab/applications/submit` | P02 RPC |
| 申请受理 | `/business/lab/applications/review` | P01/P02 RPC |

#### C 组 — 标本管理（3 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 样本采集确认 | `/business/lab/specimens/collect` | P01/P02 RPC |
| 标本接收登记 | `/business/lab/specimens/receive` | D01/D02 RPC |
| 标本状态跟踪 | `/business/lab/specimens/tracking` | `/db/lab_specimen_items` |

#### D 组 — 报告管理（2 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 报告列表 | `/business/lab/reports/list` | `/db/lab_test_reports` |
| 报告详情 | `/business/lab/reports/detail/:rptId` | `/db/lab_test_reports` + E13 |

#### E 组 — 报告审核（4 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 一审列表 | `/business/lab/reviews/first-review` | E12 RPC |
| 一审详情 | `/business/lab/reviews/first-review/:rptId` | `/db/` + E10 RPC |
| 二审列表 | `/business/lab/reviews/second-review` | E12 RPC |
| 二审详情 | `/business/lab/reviews/second-review/:rptId` | `/db/` + E11 RPC |

#### F 组 — 辅助功能（3 页）

| 页面 | 路由 | 数据源 |
|------|------|------|
| 危急值管理 | `/business/lab/critical-values` | F02 RPC |
| 质控数据 | `/business/lab/quality-control` | `/db/lab_qc_data` |
| 设备管理 | `/business/lab/devices` | `/db/lab_device_info` |

### 数据源策略

- **字典/查看页面**: 直接 `fetch('/db/...')` 走 Vite 代理 → PostgREST
- **操作页面**（申请/受理/接收/审核）: RPC 调用 `{payload: {...}}` → PG 函数
- CORS: PostgREST 设置 `Access-Control-Allow-Origin: *`

## 角色权限

当前全部使用 `business_user`，后续需细化为：

- 送检医师：提交申请
- 采样护士：采集确认
- 中心技师：标本接收、报告编制
- 中心审核员：一审/二审

## 文件清单

```
新建:
  database/postgresql/migrations/016_lab_collecting_org.sql
  database/postgresql/migrations/017_lab_review_workflow.sql
  src/providers/lab-db.ts
  src/pages/business/lab/... (19 页面文件)

修改:
  src/App.tsx (+129/-13)
```

## 已知待做

- 角色细化：拆分为送检医师/采样护士/中心技师/中心审核员
- 报告模板配置页面（`/center/config/report-template`，设计文档 P20）
- HIS 双向对接（Phase 3）
- 图文报告上传/查看（Phase 3）
