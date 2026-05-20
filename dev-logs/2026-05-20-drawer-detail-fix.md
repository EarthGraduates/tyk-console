# Dev Log — 2026-05-20 (Bug #2): 服务详情改为 Drawer 弹出

## 问题

点击服务列表"详情"按钮发生路由跳转，跳转后页面空白。

## 根因分析

两个问题叠加：

1. **路由跳转体验差**：`navigate('/apis/${api_id}')` 跳转到新路由，但 Refine 的 resource 路由没有正确映射 `/apis/:id` → `ApiShow`，导致页面空白。

2. **方案改为 Drawer 弹出**：不跳路由，在当前页右侧弹出 Drawer 展示详情更合理。

## 修复内容

### `src/pages/apis/index.tsx`
- 移除 `useNavigate` 导入
- 新增 `detailId` 状态 + `useOne` 查询
- 修改"详情"按钮 onClick：`navigate()` → `setDetailId()`
- 新增 `<Drawer>` 展示 API 详情 JSON
- 删除 `ApiShow` 组件（路由跳转页方案废弃）

### `src/App.tsx`
- 移除 `ApiShow` 导入和 `/apis/:id` 路由

### 踩坑
- `useOne` 返回 `{ query, result }`，不是 `{ data, isLoading }`（与 `useList` 不同）
- 正确用法：`const { query } = useOne(...)`，数据在 `query.data.data`

## 验证

- ESLint: 0 errors, 0 warnings
- 浏览器实测：点击"详情" → Drawer 弹出 → 显示完整 JSON → 关闭 → 列表不受影响
