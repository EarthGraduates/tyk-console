# 「删除 API 清理密钥」实施计划

> **For Hermes:** 按 task 顺序执行。

**Goal:** 删除 API 时同步清理 Tyk 中关联的密钥。

**Architecture:** api-lifecycle.ts 新增 `deleteApiWithKeyCleanup()`，页面 deleteRecord 调用它。

---

## Task 1: api-lifecycle.ts 新增 deleteApiWithKeyCleanup

**文件:** `src/providers/api-lifecycle.ts`

**逻辑:**
```
deleteApiWithKeyCleanup(apiId, name)
  1. GET /tyk/keys/ → 所有 key ID 列表
  2. 逐条 GET /tyk/keys/{id} → 查 access_rights
  3. 分类:
     - access_rights 只有目标 API → Tyk DELETE key + DB delete key
     - access_rights 有目标 API + 其他 API → PUT key 移除目标 API
  4. Tyk DELETE API
  5. DB DELETE API
  6. Tyk reload
```

**验证:** 函数导出，类型正确

---

## Task 2: 页面 deleteRecord 改用新函数 + 弹窗文字

**文件:** `src/pages/api-records/index.tsx`

**改动:**
- `deleteRecord` 改为 async，调 `deleteApiWithKeyCleanup` + 成功 toast / 失败 toast
- 删除 Popconfirm 文字改为 `删除 API 将同时删除关联的密钥，是否确认？`

**验证:** 弹窗显示新文字

---

## Task 3: ESLint + 浏览器验证

```bash
npx eslint src/providers/api-lifecycle.ts src/pages/api-records/index.tsx
```

浏览器:
1. 创建一个 API + 绑一个 key
2. 删除该 API → key 也被删
3. 共享 key 场景：绑两个 API → 删一个 → key 还在但 access_rights 清理

---

## Task 4: 更新 dev-logs
