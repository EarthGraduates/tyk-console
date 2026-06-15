# 2026-06-15 检验业务页面 Phase 1 — 全流程页面 + 采集机构分离 + 报告审核

## 概述

完成检验中心全流程业务页面（19 页）+ 采集机构与送检机构分离支持 + 双人报告审核流程。

## Phase 1: 采集机构分离（DB + PG 函数）

- **迁移 `016_lab_collecting_org.sql`**: 给 `biz.lab_applications` 和 `biz.lab_test_reports` 添加 `col_org_code`/`col_org_name` 列
- 更新 P01/P02/E01/E03 四个 PG 函数，读/写采集机构字段
- 标本链路（B02/D01）已原生支持，无需修改

## Phase 2: 报告审核流程（DB + PG 函数 + 接口注册）

- **迁移 `017_lab_review_workflow.sql`**: 
  - 创建 `biz.lab_review_logs` 审核日志表
  - `rpt_status` 添加 CHECK 约束（状态机: pending_first_review → pending_second_review → issued / rejected / canceled）
  - 新建 4 个 PG 函数: E10（一审）、E11（二审，含同人校验+夜班开关）、E12（待审队列）、E13（审核日志）
  - 更新 E01（默认状态 `pending_first_review`）、E08（扩展可撤销状态范围）
  - 注册 4 个新接口: LAB-NX-RP-O004/O005/I005/I006

## Phase 3: 前端业务页面（19 页）

### 3.0 基础设施
- `src/providers/lab-db.ts` — LAB 数据访问层（PostgREST + RPC）
- `src/App.tsx` — MenuItem 支持 children 子菜单，注册全部业务路由

### 页面分组

| 组 | 页面数 | 文件 |
|------|------|------|
| A 字典 | 5 | sample-types, request-items, test-items, bio-items, anti-items |
| B 申请 | 2 | applications/submit, applications/review |
| C 标本 | 3 | specimens/collect, specimens/receive, specimens/tracking |
| D 报告 | 2 | reports/list, reports/detail |
| E 审核 | 4 | reviews/first-review-list, first-review-detail, second-review-list, second-review-detail |
| F 辅助 | 3 | critical-values, quality-control, devices |

### 数据源
- 字典/查看页面: 直接 `fetch('/db/...')` 走 Vite 代理 → PostgREST
- 操作页面（申请/受理/接收/审核）: RPC 调用 `{payload: {...}}` → PG 函数
- CORS: PostgREST 设置 `Access-Control-Allow-Origin: *`

## 当前状态

- 数据库: 迁移已应用，10 条测试数据已就位
- 类别 A（字典页）: 已验证数据加载正常
- 类别 B-F: 代码完成待验证

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
