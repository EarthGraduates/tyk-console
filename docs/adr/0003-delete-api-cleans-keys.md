# ADR-0003: 删除 API 时清理关联密钥

ADR-0001 决定停用 API 时不处理关联密钥（维持不变）。本 ADR 补充**删除**操作的行为。

## 决策

从 PostgreSQL 永久删除 API 定义时，同步清理 Tyk 中该 API 关联的密钥：

- 密钥**只绑了该 API**（独占密钥）→ Tyk DELETE + PostgreSQL DELETE
- 密钥**还绑了其他 API**（共享密钥）→ Tyk PUT 更新 access_rights，移除已删 API 的引用，密钥本身保留

## 理由

删除是永久操作——API 定义和密钥都不可恢复。留下独占密钥没有意义（API 已不存在），且会在 Tyk 中产生垃圾数据。共享密钥保留是因为它仍服务于其他 API。

## 与 ADR-0001 的关系

ADR-0001（停用不处理密钥）维持不变。停用是可恢复操作，密钥应保留以便重新启用时恢复。删除是不可逆操作，密钥必须随之一并清理。

## 后果

- 删除 API 操作变重：需要先 GET `/tyk/keys/` 列表，逐条 GET 检查 access_rights，再 DELETE/PUT 匹配的 key
- 删除确认弹窗需增加密钥清理警告
- api-lifecycle.ts 需新增 `deleteApiWithKeyCleanup()` 方法
