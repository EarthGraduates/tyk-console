# Tyk 双协议接口开发方案 — WebService + RESTful

> 版本：v1.0
> 日期：2026-06-11
> 技术栈：Tyk :8080 + PostgREST :3001 + PostgreSQL :5433 + Python FastAPI

---

## 一、背景

南雄检验中心接口需要同时支持两种协议：

| 协议 | 报文格式 | 已有规范 | 客户端 |
|------|---------|---------|--------|
| **WebService (SOAP)** | XML 信封（appid/method/pwd/param） | 接口明细 DB 中的入参格式 | HIS/LIS 传统系统 |
| **RESTful** | JSON body | 需要新增 | 现代 Web/移动端 |

当前技术栈：
- Tyk (:8080) — API 网关
- PostgREST (:3001) — PostgreSQL 自动 REST API
- PostgreSQL (:5433) — 业务逻辑（存储过程/函数）

---

## 二、核心矛盾

| | WebService (SOAP) | RESTful |
|---|---|---|
| 报文格式 | XML 信封 | JSON body |
| 业务数据来源 | param 层内嵌 XML | 直接 JSON |
| PostgREST 支持 | 不原生支持 XML | 原生支持 JSON |
| Tyk 支持 | 透传 XML 没问题 | 原生支持 |

PostgREST 只能输出 JSON，所以 SOAP 信封的装拆必须在到达 PostgREST 之前完成。

---

## 三、推荐方案：PostgREST + 协议适配层 + Tyk 双路由

### 架构图

```
                    ┌─────────────────────────────────┐
                    │          Tyk (:8080)             │
                    │  /rest/*  →  JSON  →  适配层     │
                    │  /ws/*    →  SOAP  →  适配层     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │      协议适配层 (Python FastAPI)  │
                    │  SOAP: 拆信封→JSON→调PG函数→装信封 │
                    │  REST: 透传 JSON → PostgREST     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │      PostgREST (:3001)           │
                    │      /rpc/interface_xxx          │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     PostgreSQL (:5433)           │
                    │     业务逻辑 = 存储过程/函数       │
                    └──────────────────────────────────┘
```

### 各层职责

#### PostgreSQL — 唯一业务逻辑层

每个接口对应一个 PostgreSQL 函数，入参出参都是 JSON。**只写一份业务逻辑。**

```sql
-- 示例：送检登记
CREATE FUNCTION api.submit_specimen(payload json) RETURNS json AS $$
  -- 解析、校验、写入、返回
$$ LANGUAGE plpgsql;
```

PostgREST 自动暴露为 `POST /rpc/submit_specimen`。

#### 协议适配层（Python FastAPI）— 薄层，只做格式转换

```
REST 请求进来：
  Tyk → 适配层 → 透传 JSON → PostgREST → 返回 JSON → 适配层 → Tyk

SOAP 请求进来：
  Tyk → 适配层 → 解析 XML 信封 → 提取 param → 调 PostgREST
                → 拿到 JSON 结果 → 装回 SOAP 信封 → 返回 XML → Tyk
```

关键：适配层**不写业务逻辑**，只做三件事：
1. SOAP 信封装拆（XML ↔ JSON）
2. appid/pwd 校验（或交给 Tyk 做）
3. 调用 PostgREST，原样透传结果

#### Tyk — 统一网关

两条 API 定义，共享认证、限流、日志：

| Tyk API | 路径 | Content-Type | 后端 |
|---------|------|-------------|------|
| REST | `/rest/{interface}` | `application/json` | 适配层 → PostgREST |
| WebService | `/ws/{interface}` | `text/xml` | 适配层 → PostgREST |

---

## 四、SOAP 信封格式（对齐现有规范）

接口明细 DB 里的入参结构：

```xml
<soap:Envelope>
  <soap:Body>
    <request>
      <appid>platlisBase</appid>
      <method>submitSpecimen</method>
      <pwd>bsoft</pwd>
      <param>
        <!-- 这里才是业务数据，对应 param_l2/param_l3 层级 -->
        <sendingOrg>机构代码</sendingOrg>
        <centerOrg>检验中心代码</centerOrg>
        <dataInfoList>
          <doctAdviseNo>条码号</doctAdviseNo>
          ...
        </dataInfoList>
      </param>
    </request>
  </soap:Body>
</soap:Envelope>
```

REST 版本直接去掉信封，body 就是 `param` 对应的 JSON：

```json
{
  "sendingOrg": "机构代码",
  "centerOrg": "检验中心代码",
  "dataInfoList": [...]
}
```

适配层的工作就是 **`<param>...</param>` ↔ `{...}`** 的转换。

---

## 五、备选方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A: 适配层 + PostgREST（推荐）** | 业务逻辑只写一次；PostgREST 自动生成 REST API；适配层极薄 | 多一个服务 |
| B: 纯 PostgREST + Tyk 脚本 | 无额外服务 | Tyk JS/Go 插件处理 SOAP 很痛苦；复杂 XML 解析不靠谱 |
| C: Python 全栈（不用 PostgREST） | 完全控制 | 手写所有接口 CRUD；放弃 PostgREST 的自动 API 生成 |
| D: PostgREST 双实例 | 不需要适配层 | PostgREST 不支持 XML，根本做不到 |

---

## 六、开发建议顺序

1. **先做 PostgREST + PG 函数**（REST 就通了）
2. **用 curl 测通 REST 路径**（Tyk → 适配层透传 → PostgREST）
3. **再加 SOAP 信封装拆**（适配层加约 200 行代码）
4. **Tyk 配两条 API**（`/rest/*` 和 `/ws/*`）

这样 REST 可以立刻用，SOAP 同一天就能跟上。

---

## 七、核心原则

> **PostgreSQL 函数是唯一业务逻辑 → PostgREST 自动暴露 REST → 适配层只做 XML/JSON 互转**
