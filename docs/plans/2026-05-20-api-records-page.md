# 「历史API记录」页面 实施计划

> **For Hermes:** 按 task 顺序执行，每步写 dev-log。

**Goal:** 新增「历史API记录」页面，从 PostgreSQL 读取全部 API 定义（active + inactive），支持完整 CRUD（DB 优先），创建与同步解耦。

**Architecture:** 新建 `ichse-db-data-provider`（Refine DataProvider 包装 ichse-db.ts），新页面用此 provider。Tyk 推送通过页面按钮手动触发，不走 data provider 自动推送。

**Tech Stack:** Refine v5 + Ant Design v5 + React 19 + TypeScript + PostgREST

---

## Stage 1: DB Data Provider

### Task 1.1: 创建 DB-first DataProvider

**Objective:** 实现 Refine DataProvider 接口，读写 PostgreSQL（PostgREST）

**Files:**
- Create: `src/providers/ichse-db-data-provider.ts`

**代码：**

```typescript
// @ts-nocheck
import type { DataProvider } from '@refinedev/core';
import { apiDefinitionsDb } from './ichse-db';

export const ichseDbDataProvider: DataProvider = {
  getApiUrl: () => '',

  getList: async ({ resource }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.list();
      return { data, total: data.length };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  getOne: async ({ resource, id }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.getByApiId(String(id));
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  create: async ({ resource, variables }) => {
    if (resource === 'api-records') {
      const now = new Date().toISOString();
      const record = {
        api_id: variables.api_id,
        owner_id: 'system',
        name: variables.name,
        listen_path: variables.proxy?.listen_path,
        target_url: variables.proxy?.target_url,
        auth_mode: variables.use_keyless ? 'keyless' : 'token',
        status: 'active' as const,
        sync_status: 'pending' as const,
        definition: variables,
        version: 1,
        created_by: 'system',
        updated_by: 'system',
      };
      const data = await apiDefinitionsDb.create(record);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  update: async ({ resource, id, variables }) => {
    if (resource === 'api-records') {
      const data = await apiDefinitionsDb.update(String(id), {
        ...variables,
        sync_status: 'pending',
      } as any);
      return { data };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  deleteOne: async ({ resource, id }) => {
    if (resource === 'api-records') {
      await apiDefinitionsDb.delete(String(id));
      return { data: { id } };
    }
    throw new Error(`Unknown resource: ${resource}`);
  },

  // 未实现
  createMany: async () => { throw new Error('createMany not implemented'); },
  deleteMany: async () => { throw new Error('deleteMany not implemented'); },
  updateMany: async () => { throw new Error('updateMany not implemented'); },
  custom: async () => { throw new Error('custom not implemented'); },
} as any;
```

**验证：** 文件语法无报错

---

### Task 1.2: 注册新 Provider

**Objective:** 将 ichseDbDataProvider 加入 dataProviderMap，注册 api-records 资源

**Files:**
- Modify: `src/providers/data.ts`
- Modify: `src/App.tsx`

**Step 1: data.ts**

```typescript
import { ichseDbDataProvider } from './ichse-db-data-provider';

export const dataProviderMap = {
  default: supabaseDataProvider(supabaseClient),
  tyk: tykDataProvider,
  ichseDb: ichseDbDataProvider,
};
```

**Step 2: App.tsx — 注册资源**

```typescript
resources={[
  { name: 'apis', meta: { dataProviderName: 'tyk' } },
  { name: 'keys', meta: { dataProviderName: 'tyk' } },
  { name: 'api-records', meta: { dataProviderName: 'ichseDb' } },
]}
```

**验证：** 应用启动无报错，F12 无 console 错误

---

## Stage 2: 页面实现

### Task 2.1: 创建页面骨架 + 表格

**Objective:** 页面表格展示 DB 中所有 API，含状态列

**Files:**
- Create: `src/pages/api-records/index.tsx`

**表格列：**
- 名称 (name)
- API ID (api_id)
- listen_path
- target_url
- 状态 (status): active=绿 / inactive=灰 / archived=橙
- 同步状态 (sync_status): synced=绿 / pending=黄 / failed=红
- 操作：查看 / 编辑 / 停用 / 删除 / 重新启用 / 同步

**验证：** 页面可访问，表格有数据（如 DB 无数据则显示空状态）

---

### Task 2.2: 创建功能

**Objective:** 新建 API（DB only，sync_status=pending）

**实现：** 复用现有 ApiCreateModal，改为调用 `useCreate({ dataProviderName: 'ichseDb' })`

**验证：** 创建后表格新增一行，sync_status 显示「待同步」

---

### Task 2.3: 编辑功能

**Objective:** 编辑 API 定义，更新 DB

**验证：** 编辑后 sync_status 变为 pending

---

### Task 2.4: 停用功能

**Objective:** DB status='inactive' + Tyk DELETE + sync_status='synced'

**实现：**
```typescript
async function deactivate(record) {
  // 1. Tyk DELETE
  await tykFetch(`apis/${record.api_id}`, { method: 'DELETE' });
  // 2. DB 标记 inactive + synced
  await apiDefinitionsDb.update(record.api_id, {
    status: 'inactive',
    sync_status: 'synced',
  });
  // 3. Tyk reload
  await tykFetch('reload/', { method: 'GET' });
}
```

**验证：** 停用后 Tyk 中 API 消失，DB 记录 status=inactive

---

### Task 2.5: 删除功能

**Objective:** DB DELETE（永久删除）

**验证：** 表格中该行消失，PostgreSQL 中记录不存在

---

### Task 2.6: 重新启用

**Objective:** POST 到 Tyk + DB status='active' + sync_status='synced'

**验证：** Tyk 中出现该 API，DB status=active

---

### Task 2.7: 手动同步

**Objective:** 将 sync_status=pending/failed 的 API 推送到 Tyk

**实现：**
```typescript
async function syncToTyk(record) {
  // 1. POST/PUT 到 Tyk
  await tykFetch('apis/', { method: 'POST', body: JSON.stringify(record.definition) });
  // 2. 标记 synced
  await apiDefinitionsDb.markSynced(record.api_id);
  // 3. reload
  await tykFetch('reload/', { method: 'GET' });
}
```

**验证：** sync_status 变为 synced，Tyk 中出现该 API

---

## Stage 3: 路由和菜单

### Task 3.1: 添加路由和菜单

**Files:**
- Modify: `src/App.tsx`

**Step 1: 导入页面**
```typescript
import ApiRecords from './pages/api-records';
```

**Step 2: 添加路由**
```typescript
<Route path="/api-records" element={<ApiRecords />} />
```

**Step 3: 添加菜单**
```typescript
{ key: '/api-records', icon: <HistoryOutlined />, label: '历史记录' },
```

**导入图标:**
```typescript
import { HistoryOutlined } from '@ant-design/icons';
```

---

## Stage 4: 验审

### Task 4.1: ESLint 审查

```bash
npx eslint src/
```
消除所有 errors。

### Task 4.2: 浏览器手动验证

1. 启动环境 → 访问 /api-records
2. 创建 API → 确认 sync_status=pending
3. 手动同步 → 确认 Tyk 中出现
4. 停用 → 确认 Tyk 中消失、DB inactive
5. 重新启用 → 确认 Tyk 中出现、DB active
6. 删除 → 确认 DB 中消失

### Task 4.3: 更新索引

更新 `dev-logs/v1.1-index.md` 和创建 `dev-logs/stage-api-records.md`

---

## 偏差记录（执行后填写）

| 偏差项 | 原因 | 审批 |
|--------|------|:--:|
| — | — | — |
