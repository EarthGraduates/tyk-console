# V1.4 校验引擎 + 双协议基础 — 开发方案

> 版本：v1.0
> 日期：2026-06-12
> 前置方案：docs/tyk-dual-protocol-architecture.md

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                      前端 (:5173)                             │
│  校验规则管理: CRUD → PostgREST → PG 规则表                    │
│  规则变更后: POST /admin/refresh-rules → services              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    Tyk (:8080)                                │
│  /rest/* → Python services（声明式 JSON 配置）                  │
└──────────────────────────┬───────────────────────────────────┘

┌──────────────────────────▼───────────────────────────────────┐
│                Python FastAPI (services/)                      │
│                                                               │
│  请求 → 从 Redis 读规则 → 校验引擎 → 通过 → PostgREST → PG     │
│                                    → 失败 → 直接返回 400       │
│  结果 → 同步返回客户端 + 异步写 Redis 队列 → 批量刷 PG          │
└──────┬──────────────────────┬───────────────────┬────────────┘
       │                      │                   │
  ┌────▼────┐           ┌─────▼─────┐       ┌─────▼─────┐
  │  Redis  │           │ PostgREST │       │    PG     │
  │ 规则缓存 │           │  (:3001)  │       │  规则表    │
  │ 日志队列 │           └─────┬─────┘       │  业务表    │
  └─────────┘                 │             │  日志表    │
                    ┌─────────▼─────────┐   └───────────┘
                    │  PG 业务表（写入）  │
                    └───────────────────┘
```

**核心原则：**
- PG 只做数据写入，不做业务逻辑
- 校验是独立的中间层服务
- 规则缓存于 Redis，PG 是规则的持久化存储
- 校验日志同步返回 + 异步批量入库

---

## 二、PG 表设计

### 2.0 基础字段约定

所有业务表统一包含：

```sql
-- 每张 biz 表都带这些字段
id            serial PRIMARY KEY,
created_at    timestamptz DEFAULT now(),   -- 写入时间
updated_at    timestamptz DEFAULT now(),   -- 最后修改时间
deleted_at    timestamptz DEFAULT NULL,    -- 删除时间（仅记录时间，不作为状态判断）
is_valid      boolean DEFAULT true,        -- 是否有效，false=逻辑删除
version       int DEFAULT 1                -- 乐观锁版本号，每次 UPDATE 递增
```

逻辑删除：`UPDATE SET is_valid=false, deleted_at=now()`。
查询过滤：`WHERE is_valid=true`。

### 2.1 接口定义表

interface_id 生成规则：`{PLATFORM}-{CATEGORY}-{DIR}{SEQ:03d}`

| 段 | 含义 | 示例 |
|---|------|------|
| PLATFORM | 平台码 2-3 字符 | `NX`=南雄 |
| CATEGORY | 业务分类码 2 字符 | `MD`=主数据, `SP`=标本采集, `RC`=标本接收, `RP`=报告, `CV`=危急值, `QC`=质控, `EQ`=设备, `QR`=查询 |
| DIR | 方向 1 字符 | `I`=入站（数据进入平台）, `O`=出站（数据从平台出去） |
| SEQ | 3 位序号 | 同平台+分类+方向内自增 `001` |

示例：`NX-MD-O001` = 南雄-主数据同步-出站-001（检验样本类型下载）

```sql
CREATE TABLE biz.interfaces (
  id              serial PRIMARY KEY,
  interface_id    text NOT NULL UNIQUE,     -- NX-MD-O001（内部生成）
  platform        text NOT NULL,            -- NX（所属平台）
  biz_category    text,                     -- A.主数据同步（字典对照）
  category_code   text,                     -- MD（分类码）
  biz_id          text,                     -- A07（外部业务ID）
  interface_name  text NOT NULL,            -- 检验样本类型下载
  func_name       text NOT NULL UNIQUE,     -- PG 函数名: nx_md_get_sample_type
  direction       text,                     -- 送检方 / 临检中心方
  data_flow       text,                     -- I=入站 / O=出站
  http_method     text,                     -- POST
  url             text,                     -- 外部原始 URL
  description     text,
  status          text DEFAULT 'active',
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
```

### 2.2 接口参数字段表

```sql
CREATE TABLE biz.interface_fields (
  id              serial PRIMARY KEY,
  interface_id    int REFERENCES biz.interfaces(id),
  field_name      text NOT NULL,   -- centerOrg / sampleType / sampleDescribe ...
  field_path      text,            -- dataInfoList[].sampleType（嵌套路径）
  field_type      text NOT NULL,   -- String / Number / Date / Object / List
  direction       text NOT NULL DEFAULT 'input',  -- input / output
  required        boolean DEFAULT false,
  description     text,
  param_l1        text,            -- 保留 SOAP 层级信息
  param_l2        text,
  param_l3        text,
  param_l4        text,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
```

### 2.3 校验规则表（校验引擎的配置数据源）

```sql
CREATE TABLE biz.validation_rules (
  id              serial PRIMARY KEY,
  field_id        int REFERENCES biz.interface_fields(id) ON DELETE CASCADE,
  rule_type       text NOT NULL,   -- regex | domain | cross_field
  rule_config     jsonb NOT NULL,  -- 规则配置
  error_message   text,            -- 校验失败时的提示信息
  is_active       boolean DEFAULT true,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);

-- rule_config 示例：
-- regex:        {"pattern": "^[A-Z]{2}-[0-9]{3}$"}
-- domain/enum:  {"values": ["01", "02", "03"]}
-- domain/range: {"min": 1, "max": 100}
-- domain/type:  {"type": "string", "max_length": 50}
-- cross_field:  {"relation": "required_if", "target_field": "sampleType",
--                "condition": {"field": "labOrg", "op": "not_null"}}
```

### 2.4 校验日志表

```sql
CREATE TABLE biz.validation_logs (
  id              serial PRIMARY KEY,
  interface_id    int REFERENCES biz.interfaces(id),
  request_id      uuid NOT NULL,
  payload         jsonb,
  result          jsonb,            -- {success, errors: [{field, rule_type, message}]}
  duration_ms     int,
  is_valid        boolean DEFAULT true,
  version         int DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz DEFAULT NULL
);
);
```

---

## 三、校验引擎设计

### 3.1 设计模式：Chain of Responsibility + Strategy

```
                    ┌─────────────────────┐
                    │  ValidationEngine    │  ← 门面，编排整条链
                    │  + validate(payload) │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼───────────────┐
               │               │               │
        ┌──────▼──────┐ ┌─────▼─────┐ ┌───────▼────────┐
        │   Regex      │ │  Domain   │ │   CrossField   │
        │   Validator  │ │ Validator │ │   Validator    │
        └──────────────┘ └───────────┘ └────────────────┘
               │               │               │
               └───────────────┴───────────────┘
                          implements
                    ┌─────────────────────┐
                    │   BaseValidator     │  ← Strategy 接口
                    │  + validate(fields, │
                    │     rules) → errors │
                    └─────────────────────┘
```

**为什么选这个组合：**

| 诉求 | 如何满足 |
|------|---------|
| 新增校验类型 | 加一个 Validator 类，不改任何已有代码（OCP） |
| 单类职责 | 每个 Validator 只管一种规则类型 |
| 性能 | 链式执行，可短路的步骤尽早失败 |
| 可测试 | 每个 Validator 独立单元测试 |
| 可编排 | 校验顺序可调整、可插拔 |

**执行流程：**

```
1. RuleLoader 从 Redis 加载 interface 对应的规则列表
2. ValidationEngine 将 (fields, rules) 依次传入链:

   RegexValidator.validate(fields, rules)
     → 逐字段检查 regex 规则 → 收集 errors
     → 有错误 → 标记问题字段，后续 validator 跳过这些字段

   DomainValidator.validate(remaining_fields, rules)
     → 逐字段检查 enum/range/type 规则 → 收集 errors

   CrossFieldValidator.validate(all_fields, rules)
     → 检查跨字段规则（如 required_if 关系）

3. 汇总 errors → ValidationResult {success, errors[], duration_ms}
```

### 3.2 规则配置定义

```python
from enum import Enum
from dataclasses import dataclass
from typing import Any, Optional

class RuleType(str, Enum):
    REGEX = "regex"
    DOMAIN = "domain"
    CROSS_FIELD = "cross_field"

class DomainSubType(str, Enum):
    ENUM = "enum"        # {"values": ["01", "02", "03"]}
    RANGE = "range"      # {"min": 1, "max": 100}
    TYPE = "type"        # {"type": "string", "max_length": 50}

class CrossFieldRelation(str, Enum):
    REQUIRED_IF = "required_if"     # A 存在时 B 必须存在
    REQUIRED_WITH = "required_with"  # A 和 B 必须同时存在
    GT = "gt"                       # A > B
    GTE = "gte"                     # A >= B

@dataclass
class Rule:
    id: int
    field_name: str
    rule_type: RuleType
    rule_config: dict
    error_message: Optional[str]

@dataclass
class ValidationError:
    field: str
    rule_type: RuleType
    message: str

@dataclass
class ValidationResult:
    success: bool
    errors: list[ValidationError]
    duration_ms: int
```

### 3.3 Validator 实现骨架

```python
from abc import ABC, abstractmethod
import re

class BaseValidator(ABC):
    @abstractmethod
    async def validate(
        self,
        fields: dict[str, Any],
        rules: list[Rule],
        skip_fields: set[str],
    ) -> list[ValidationError]:
        ...


class RegexValidator(BaseValidator):
    async def validate(self, fields, rules, skip_fields):
        errors = []
        regex_rules = [r for r in rules if r.rule_type == RuleType.REGEX]
        for rule in regex_rules:
            if rule.field_name in skip_fields:
                continue
            value = fields.get(rule.field_name)
            if value is None:
                continue
            pattern = rule.rule_config["pattern"]
            if not re.match(pattern, str(value)):
                errors.append(ValidationError(
                    field=rule.field_name,
                    rule_type=RuleType.REGEX,
                    message=rule.error_message or f"不匹配模式: {pattern}"
                ))
                skip_fields.add(rule.field_name)  # 短路：此字段跳过后续校验
        return errors


class DomainValidator(BaseValidator):
    async def validate(self, fields, rules, skip_fields):
        errors = []
        domain_rules = [r for r in rules if r.rule_type == RuleType.DOMAIN]
        for rule in domain_rules:
            if rule.field_name in skip_fields:
                continue
            value = fields.get(rule.field_name)
            if value is None:
                continue
            sub_type = rule.rule_config.get("type")
            if sub_type == "enum":
                if value not in rule.rule_config["values"]:
                    errors.append(ValidationError(
                        field=rule.field_name,
                        rule_type=RuleType.DOMAIN,
                        message=rule.error_message or f"值不在允许范围: {rule.rule_config['values']}"
                    ))
            elif sub_type == "range":
                min_val = rule.rule_config.get("min")
                max_val = rule.rule_config.get("max")
                if (min_val is not None and value < min_val) or \
                   (max_val is not None and value > max_val):
                    errors.append(ValidationError(
                        field=rule.field_name,
                        rule_type=RuleType.DOMAIN,
                        message=rule.error_message or f"值超出范围 [{min_val}, {max_val}]"
                    ))
        return errors


class CrossFieldValidator(BaseValidator):
    async def validate(self, fields, rules, skip_fields):
        errors = []
        cross_rules = [r for r in rules if r.rule_type == RuleType.CROSS_FIELD]
        for rule in cross_rules:
            relation = rule.rule_config["relation"]
            target = rule.rule_config["target_field"]
            if relation == "required_if":
                condition = rule.rule_config["condition"]
                cond_value = fields.get(condition["field"])
                if cond_value is not None and fields.get(target) is None:
                    errors.append(ValidationError(
                        field=target,
                        rule_type=RuleType.CROSS_FIELD,
                        message=rule.error_message or f"{target} 为必填（当 {condition['field']} 存在时）"
                    ))
        return errors


class ValidationEngine:
    def __init__(self, rule_loader: "RuleLoader"):
        self.rule_loader = rule_loader
        self.validators: list[BaseValidator] = [
            RegexValidator(),
            DomainValidator(),
            CrossFieldValidator(),
        ]

    async def validate(
        self, interface_id: str, payload: dict
    ) -> ValidationResult:
        start = time.perf_counter()
        rules = await self.rule_loader.load(interface_id)
        errors: list[ValidationError] = []
        skip_fields: set[str] = set()

        for validator in self.validators:
            errors.extend(
                await validator.validate(payload, rules, skip_fields)
            )

        duration_ms = int((time.perf_counter() - start) * 1000)
        return ValidationResult(
            success=len(errors) == 0,
            errors=errors,
            duration_ms=duration_ms,
        )
```

### 3.4 短路策略

```
Regex 失败 → 标记该字段 → Domain 跳过该字段
  （正则不匹配说明格式已错，值域校验无意义）

Domain 失败 → 不跳过，仅记录错误
  （值域错误不影响跨字段校验）

CrossField 始终执行
  （跨字段关联依赖的是字段存在性，不依赖值正确性）
```

---

## 四、规则同步链路

```
┌──────────┐    保存规则      ┌────────────┐   写入    ┌────────┐
│  前端     │ ──────────────→ │ PostgREST  │ ───────→ │   PG   │
│ 规则管理页 │                │            │          │ 规则表  │
└──────────┘                 └────────────┘          └────────┘
     │                              │
     │ 保存成功后                    │ PG 写入成功后
     │ POST /admin/refresh-rules    │ (规则变更由前端触发)
     │                              │
     └──────────────┬───────────────┘
                    ▼
          ┌─────────────────┐
          │  Python services │
          │  /admin/refresh- │
          │  rules           │
          │  → 从 PG 读取    │
          │  → 写入 Redis    │
          └─────────────────┘
```

**前端保存规则后的调用链：**

```typescript
// 前端保存规则后
await postgrest.saveRule(rule);  // PG 持久化
await fetch("/admin/refresh-rules", { method: "POST" });  // 触发缓存刷新
```

**services 端的 refresh 实现：**

```python
@app.post("/admin/refresh-rules")
async def refresh_rules():
    rules = await pg.fetch_all_rules()        # 全量从 PG 加载
    await redis.set("validation:rules", json.dumps(rules))  # 写 Redis
    return {"status": "ok", "count": len(rules)}
```

---

## 五、校验日志链路

```
请求 → 校验引擎 → ValidationResult
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  同步返回客户端            异步写 Redis 队列
  {code, message, errors}   redis.lpush("validation:logs", log_entry)
                                    │
                                    ▼
                           定时任务（每 5s 或 100 条）
                           → 批量 INSERT INTO biz.validation_logs
```

**优势：**
- 客户端立刻拿到结果，不受日志写入延迟影响
- Redis 队列缓冲，PG 写入不成为瓶颈
- 即使 PG 短暂不可用，日志不丢失（Redis 持久化）

---

## 六、Tyk 声明式配置

```json
{
  "api_id": "ichse-rest-v1",
  "name": "ICHSE REST API v1",
  "listen_path": "/rest/",
  "target_url": "http://services:8000",
  "strip_listen_path": false,
  "use_keyless": false,
  "auth": {
    "auth_header_name": "Authorization"
  },
  "proxy": {
    "preserve_host_header": false
  }
}
```

`listen_path: /rest/` 匹配所有 `/rest/uploadSampleType`、`/rest/submitSpecimen` 等请求，Tyk 剥离 `/rest/` 前缀后转发到 services。

---

## 七、services/ 目录结构

```
services/
├── main.py                  # FastAPI 入口
├── requirements.txt
├── Dockerfile
├── config.py                # 环境变量、Redis/PG 连接
├── engine/
│   ├── __init__.py
│   ├── validator.py         # ValidationEngine + BaseValidator
│   ├── regex_validator.py
│   ├── domain_validator.py
│   └── cross_field_validator.py
├── loader/
│   ├── __init__.py
│   └── rule_loader.py       # 从 Redis 加载规则，Redis miss → PG
├── logging/
│   ├── __init__.py
│   ├── log_writer.py        # 异步写 Redis 队列
│   └── batch_flusher.py     # 定时批量刷 PG
├── routes/
│   ├── __init__.py
│   ├── gateway.py           # POST /rest/{interface} 主入口
│   └── admin.py             # POST /admin/refresh-rules
└── plugins/
    └── __init__.py          # 未来 SOAP 适配等
```

---

## 八、迭代实施计划

每个迭代产出可独立验证的功能增量，后一个迭代在前一个基础上叠加。

---

### Iteration 1: 裸通路 — 无校验、端到端跑通

**目标：** 一个请求从 Tyk → services → PostgREST → PG 写入 → 返回，全链路贯通。不涉及任何校验逻辑。

**交付物：**

- [ ] `docker-compose.yml` 新增 Redis 服务
- [ ] `services/` FastAPI 服务骨架（Dockerfile + main.py + config.py）
- [ ] PG 建表：`biz.interfaces` + `biz.interface_fields`（不建 validation 相关表）
- [ ] routes/gateway.py：`POST /rest/{interface_name}` — 直接转发到 PostgREST `/rpc/{interface_name}`，不做校验
- [ ] Tyk JSON API 定义文件：`apps/ichse-rest-v1.json`
- [ ] 手写 1 个 PG 函数 `api.nx_md_get_sample_type(payload json) RETURNS json`（写入 biz.sample_types 表）
- [ ] 从 SQLite 导入 1 个接口元数据到 PG（只导 `NX-MD-O001` 检验样本类型下载）

**验证方式：**

```bash
# 下载接口 — 传入 centerOrg，返回样本类型列表
curl -X POST http://localhost:8080/rest/nx_md_get_sample_type \
  -H "Content-Type: application/json" \
  -d '{"centerOrg":"ORG001"}'

# 预期：200，返回 {"code":200,"dataInfoList":[{"sampleType":"01","sampleDescribe":"血液",...}]}
```

---

### Iteration 2: 规则数据层 — 可配置、可缓存，校验引擎不接入

**目标：** 前端可以管理校验规则，规则存储 PG，刷新到 Redis。services 能加载规则到内存，但暂不执行校验。通路仍然裸跑。

**交付物：**

- [ ] PG 建表：`biz.validation_rules`
- [ ] SQLite → PG 数据导入脚本（36 个接口 + 参数字段 + 初始规则）
- [ ] routes/admin.py：`POST /admin/refresh-rules` — 从 PG 全量加载规则 → 写 Redis
- [ ] loader/rule_loader.py：`load(interface_id)` — 从 Redis 读取规则（Redis miss 时 fallback PG）
- [ ] 前端规则管理页：接口列表 → 参数字段 → 校验规则 CRUD
- [ ] 前端保存规则后自动调 `/admin/refresh-rules`

**验证方式：**

- 前端创建一条 regex 规则（sampleType 匹配 `^[0-9]{2}$`），保存
- 检查 PG `validation_rules` 表有记录
- 检查 Redis 缓存已刷新
- 裸通路 curl 仍然能通（校验未接入，不影响）

---

### Iteration 3: 校验引擎接入 — 规则生效

**目标：** 校验引擎在通路上生效。规则从 Redis 加载，逐字段校验，失败返回 400，通过继续转发。

**交付物：**

- [ ] engine/ 模块：`BaseValidator` + `RegexValidator` + `DomainValidator` + `CrossFieldValidator`
- [ ] `ValidationEngine` 编排 + 短路策略
- [ ] 改造 `routes/gateway.py`：请求进来 → 调 ValidationEngine.validate() → 失败返回 400 → 通过转发 PostgREST

**验证方式：**

```bash
# 失败用例：sampleType 不匹配正则
curl -X POST ... -d '{"labOrg":"ORG001","dataInfoList":[{"sampleType":"XX","sampleDescribe":"血液"}]}'
# 预期：400 {"code":400,"errors":[{"field":"sampleType","rule_type":"regex","message":"不匹配模式: ^[0-9]{2}$"}]}

# 成功用例：规则通过
curl -X POST ... -d '{"labOrg":"ORG001","dataInfoList":[{"sampleType":"01","sampleDescribe":"血液"}]}'
# 预期：200，数据写入
```

---

### Iteration 4: 校验日志 — 异步记录，不阻塞通路

**目标：** 每次校验结果同步返回 + 异步写 Redis 队列 → 定时批量刷 PG。

**交付物：**

- [ ] PG 建表：`biz.validation_logs`
- [ ] logging/log_writer.py：同步写 Redis 队列 `LPUSH validation:logs`
- [ ] logging/batch_flusher.py：定时任务（每 5s 或攒 100 条）→ 批量 INSERT PG
- [ ] `routes/gateway.py` 集成 log_writer（校验结束后 fire-and-forget，不阻塞返回）

**验证方式：**

- 发几个成功和失败的请求
- 立即能拿到返回
- 等几秒后检查 `biz.validation_logs` 表有记录

---

### 迭代依赖关系

```
Iteration 1 (裸通路) ──→ Iteration 2 (规则数据层)
                              │
                              ▼
                       Iteration 3 (校验引擎接入)
                              │
                              ▼
                       Iteration 4 (校验日志)
```

每个迭代结束时，系统都是可用的：
- I1 结束：接口调用通了，数据能写入
- I2 结束：规则可以在前端管理了
- I3 结束：规则生效，错误请求被拦截
- I4 结束：校验结果有日志可查

---

## 九、范围边界

**本期做：**
- 正则校验（regex pattern）
- 值域校验（enum 枚举值 / range 数值范围 / type 类型+长度）
- 跨字段校验（required_if / required_with / gt / gte）

**本期不做：**
- SOAP 协议适配（架构已预留 plugins/ 目录）
- 自定义校验函数（如调用外部服务校验）
- 校验规则的版本管理与回滚
- 规则导入导出
