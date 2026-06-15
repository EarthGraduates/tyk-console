# 2026-06-15 检验业务页面 Phase 1 — 全流程页面 + 采集机构分离 + 报告审核

## 概述

完成检验中心全流程业务页面（19 页）+ 采集机构与送检机构分离支持 + 双人报告审核流程。

## 完成内容

### 数据库层

| 迁移 | 内容 |
|------|------|
| `016_lab_collecting_org.sql` | `biz.lab_applications` / `biz.lab_test_reports` 加 `col_org_code` + `col_org_name`；更新 P01/P02/E01/E03 函数 |
| `017_lab_review_workflow.sql` | 创建 `biz.lab_review_logs` 审核日志表；`rpt_status` CHECK 约束；新建 E10/E11/E12/E13 函数；更新 E01/E08；注册 4 个新接口 |

审核状态机: `pending_first_review → pending_second_review → issued / rejected / canceled`

### 前端层 — 19 个业务页面

| 组 | 页面 | 路由 | 数据源 | 状态 |
|------|------|------|------|:---:|
| A | 样本类型字典 | `/business/lab/sample-types` | `/db/lab_sample_types` | ✅ |
| A | 检验项目字典 | `/business/lab/request-items` | `/db/lab_request_items` | ✅ |
| A | 报告项目字典 | `/business/lab/test-items` | `/db/lab_test_items` | ✅ |
| A | 细菌字典 | `/business/lab/bio-items` | `/db/lab_bio_items` | ✅ |
| A | 药敏字典 | `/business/lab/anti-items` | `/db/lab_anti_items` | ✅ |
| B | 检验申请 | `/business/lab/applications/submit` | P02 RPC | ✅ |
| B | 申请受理 | `/business/lab/applications/review` | P01/P02 RPC | ✅ |
| C | 样本采集确认 | `/business/lab/specimens/collect` | P01/P02 RPC | ✅ |
| C | 标本接收登记 | `/business/lab/specimens/receive` | D01/D02 RPC | ✅ |
| C | 标本状态跟踪 | `/business/lab/specimens/tracking` | `/db/lab_specimen_items` | ✅ |
| D | 报告列表 | `/business/lab/reports/list` | `/db/lab_test_reports` | ✅ |
| D | 报告详情 | `/business/lab/reports/detail/:rptId` | `/db/lab_test_reports` + E13 | ✅ |
| E | 一审列表 | `/business/lab/reviews/first-review` | E12 RPC | ✅ |
| E | 一审详情 | `/business/lab/reviews/first-review/:rptId` | `/db/` + E10 RPC | ✅ |
| E | 二审列表 | `/business/lab/reviews/second-review` | E12 RPC | ✅ |
| E | 二审详情 | `/business/lab/reviews/second-review/:rptId` | `/db/` + E11 RPC | ✅ |
| F | 危急值管理 | `/business/lab/critical-values` | F02 RPC | ✅ |
| F | 质控数据 | `/business/lab/quality-control` | `/db/lab_qc_data` | ✅ |
| F | 设备管理 | `/business/lab/devices` | `/db/lab_device_info` | ✅ |

### 基础设施

- `src/providers/lab-db.ts` — Lab 数据访问层（PostgREST + RPC，Vite proxy `/db`）
- `src/App.tsx` — 菜单支持嵌套子菜单，注册全部业务路由，按角色过滤

## 验证结果

- 全部 19 页数据通路已验证（通过 Vite proxy `/db`）
- 审核流程端到端测试通过：提交一审 → 二审队列 → 同人校验拒绝 → 不同人审核 → 签发
- 测试数据: 10 条字典/申请/报告/标本，33 条标本明细，5 条危急值/质控/设备

## 已知待做

- 角色细化：当前全部用 `business_user`，待拆分为送检医师/采样护士/中心技师/中心审核员
- 报告模板配置页面（`/center/config/report-template`，设计文档 P20）
- HIS 双向对接（Phase 3）
- 图文报告上传/查看（Phase 3）

## 提交

```
7e200d3 feat: add full-process business pages, collecting-org separation, and report review workflow
5a7369d fix: switch remaining pages from direct localhost:3001 to Vite /db proxy
```
