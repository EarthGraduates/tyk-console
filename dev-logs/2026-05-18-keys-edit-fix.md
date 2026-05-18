# 开发日志 — 2026-05-18 密钥编辑弹窗修复

> 项目：ichse-asset-share-center (Tyk Gateway OSS 管理界面 v1)
> 仓库：git@github.com:EarthGraduates/ichse-asset-share-center.git
> Commit: 7254ffe

---

## 一、Bug 描述

密钥列表页的「编辑」按钮，点击后弹窗要么直接崩溃（React 白屏），要么表单字段全部空白无法提交。

## 二、根因分析（洋葱结构 — 3 层）

### 2.1 外层：`api_id` 未填入 initialValues

`initialValues` 没有从 `editKey.access_rights` 提取 `api_id`，但表单里 `api_id` 字段标记了 `required: true`。编辑时下拉框为空，校验不通过，无法提交。

### 2.2 中层：antd v5 + React 19 兼容问题导致 initialValues 失效

antd v5 仅支持 React 16-18。在 React 19 下，`Modal destroyOnClose` + `Form initialValues` 组合失效，编辑模式下所有字段都是空的。需改用 `useEffect` + `form.setFieldsValue` 主动回填。

### 2.3 里层：`new Date()` 传入 DatePicker 导致 React 崩溃

antd v5 DatePicker 底层是 dayjs。`form.setFieldsValue({ expires_at: new Date(...) })` 在 React 19 环境下直接抛出异常，React 卸载整个 App。官方警告也提示：`antd v5 support React is 16 ~ 18`。**解法：导入 dayjs，传 `dayjs(timestamp)` 代替 `new Date(timestamp)`。**

### 2.4 附加：`access_rights` 在编辑提交时可能丢失

`onFinish` 中只有 `values.api_id` 存在时才构建 `access_rights`。修复后，编辑模式如果 API 没变，保留原有 `access_rights`（含 api_name 等元数据）。

## 三、修改清单

**文件**：`src/pages/keys/index.tsx`（+40/-10）

| 位置 | 修改 |
|------|------|
| import | 新增 `useEffect`、`dayjs` |
| initialValues | 加 `api_id` 回填 + `expires > 0` 保护 + `dayjs()` |
| useEffect（新增） | `form.setFieldsValue` 主动回填编辑数据 |
| onFinish | 编辑分支保留原 `access_rights` |

## 四、验证结果

- ESLint: 0 errors ✅
- 浏览器：编辑弹窗正常弹出，5 个字段全部正确回填 ✅
  - 授权 API: Tyk Test Keyless API (keyless)
  - 速率: 100
  - 时间窗口: 60
  - 最大配额: 10000
  - 过期时间: 2030-01-01 08:00:00

## 五、教训

1. **antd v5 + React 19 是已知不兼容组合**，Form/Modal/DatePicker 都可能出问题。dayjs > Date，useEffect > initialValues。
2. **浏览器手动点一下比自动化验证快 10 倍**。自动化工具的竞态、截图失败等额外耗时远超手点。
3. **洋葱 Bug 不要一层一层修**：先完整分析所有层级，一次性改完再测，避免多轮迭代。
