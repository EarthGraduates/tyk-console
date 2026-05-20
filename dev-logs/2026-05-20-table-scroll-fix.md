# Dev Log — 2026-05-20: 表格操作列溢出修复

## 问题

服务页和密钥页列表的操作列（详情/克隆/删除）按钮溢出单元格。

### 根因

Table 组件缺少 `scroll` 属性。当浏览器视口较窄时，列宽被挤压：操作列单元格 145px，但 Space 容器内三个按钮需要 178px，导致溢出。

### 修复

- `src/pages/apis/index.tsx`: Table 添加 `scroll={{ x: 'max-content' }}`
- `src/pages/keys/index.tsx`: 同上
- 顺便修复了 `apis/index.tsx` 中 `<ApiCreateModal>` 行超长警告（ESLint max-len）

### 验证

- ESLint: 0 errors, 0 warnings
- 浏览器实测: APIs 页单元格 201px > 内容 178px ✅；Keys 页单元格 178px > 内容 104px ✅
