# Stage api-records — 历史API记录页面

> 日期：2026-05-20 | 阶段：V1.1
> 设计来源：`docs/plans/2026-05-20-api-records-page.md`
> 设计阶段产出：CONTEXT.md + ADR-0001 + ADR-0002（grill-with-docs 会话）

---

## 一、执行概述

新增「历史API记录」页面，从 PostgreSQL 读取全部 API 定义（DB 为权威源），创建与 Tyk 同步解耦。

### 执行顺序

| Task | 内容 | 文件 | 结果 |
|:--:|------|------|:--:|
| 1.1 | 创建 DB DataProvider | `src/providers/ichse-db-data-provider.ts` | ✅ |
| 1.2 | 注册 provider + 资源 | `src/providers/data.ts`, `src/App.tsx` | ✅ |
| 2.1-2.7 | 页面完整实现 | `src/pages/api-records/index.tsx` | ✅ |
| 3.1 | 路由 + 菜单 | `src/App.tsx` | ✅ |
| 4.1 | ESLint | `npx eslint src/` | 0 errors, 8 warnings |

---

## 二、新增/修改文件

### 新增

| 文件 | 说明 |
|------|------|
| `src/providers/ichse-db-data-provider.ts` | Refine DataProvider 包装 ichse-db.ts（DB 优先） |
| `src/pages/api-records/index.tsx` | 历史API记录页面（完整 CRUD + 同步/停用/启用） |
| `docs/plans/2026-05-20-api-records-page.md` | 实施计划 |
| `docs/adr/0001-api-deactivate-does-not-handle-keys.md` | ADR-0001 |
| `docs/adr/0002-postgresql-as-source-of-truth.md` | ADR-0002 |
| `CONTEXT.md` | 项目术语表 |

### 修改

| 文件 | 变更 |
|------|------|
| `src/providers/data.ts` | 新增 `ichseDb` provider |
| `src/providers/tyk-data-provider.ts` | `tykFetch` 改为 export |
| `src/App.tsx` | 新增 `api-records` 资源 + 路由 + 菜单项 |

---

## 三、页面功能

| 功能 | 数据流 |
|------|--------|
| **创建** | DB INSERT → sync_status='pending'（不推送 Tyk） |
| **编辑** | DB UPDATE → sync_status='pending' |
| **停用** | Tyk DELETE → DB status='inactive' + sync_status='synced' |
| **删除** | DB DELETE（永久删除） |
| **重新启用** | Tyk POST → DB status='active' + sync_status='synced' |
| **手动同步** | Tyk POST/PUT → DB markSynced |
| **失败重试** | 点击 sync_status='failed' 标签触发 |

### 表格列

名称 | API ID | 监听路径 | 上游 | 认证 | 状态(active/inactive/archived) | 同步状态(synced/pending/failed) | 操作

---

## 四、设计偏差

无偏差 — 严格按设计实施。

---

## 五、待验证

- [ ] 浏览器访问 `/api-records`
- [ ] 创建 API → 确认 sync_status=pending
- [ ] 手动同步 → 确认 Tyk 中出现
- [ ] 停用 → 确认 Tyk 消失、DB inactive
- [ ] 重新启用 → 确认 Tyk 出现、DB active
- [ ] 删除 → 确认 DB 消失
