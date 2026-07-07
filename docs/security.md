# Security Compliance Design — China Cybersecurity Level-3 Protection (等保 2.0 三级)

> **English abstract:** This document describes the security architecture of Tyk Console, designed to comply with GB/T 22239-2019 Level-3 (China's Cybersecurity Multi-Level Protection Scheme, also known as "等保 2.0 三级"). It covers identity authentication, access control (three-role separation / 三员分立), security auditing with HMAC integrity, mandatory access control (MAC) with 4 security levels, and healthcare data protection per GB/T 39725-2020. The implementation leverages PostgreSQL Row-Level Security (RLS), column-level views, pgjwt for JWT authentication, pgcrypto for bcrypt password hashing, and an append-only audit log table.
>
> **本文档描述 Tyk Console 的安全架构设计，符合 GB/T 22239-2019 三级标准（等保 2.0 三级）。**

---

**Project**: Tyk Console (tyk-console)
**Standard**: GB/T 22239-2019 — Information Security Technology — Baseline for Classified Protection of Cybersecurity (Level 3)
**Industry Supplement**: GB/T 39725-2020 — Health and Medical Data Security Guidelines
**Version**: v2.0 / 2026-07-07

---

## Overall Architecture / 总体架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器 (React SPA)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ 系统管理员 │ │ 安全管理 │ │ 审计管理 │  ← 三员分立  │
│  │ Dashboard │ │ 安全策略 │ │ 审计日志 │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│  ┌──────────┐ ┌──────────┐                          │
│  │ 业务用户  │ │ 只读用户  │  ← 业务角色              │
│  │ API CRUD │ │ 仪表板    │                          │
│  └──────────┘ └──────────┘                          │
├─────────────────────────────────────────────────────┤
│              PostgREST (JWT 验证 + 路由)             │
│         PGRST_JWT_SECRET + db_pre_request            │
├─────────────────────────────────────────────────────┤
│              PostgreSQL 17 (数据 + 权限)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ RLS 策略 │ │ 列级视图 │ │ 审计日志 │             │
│  │ (行级)   │ │ (列级)   │ │ (HMAC)   │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ pgjwt    │ │ pgcrypto │ │ 速率限制 │             │
│  │ JWT 签发 │ │ 密码哈希 │ │ 滑动窗口 │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└─────────────────────────────────────────────────────┘
```

---

## 1. Network Perimeter Security / 8.1.3 安全区域边界

### 8.1.3.2 访问控制（网络层权限）

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 在网络边界根据访问控制策略设置规则，默认拒绝 | 由部署环境的 Tyk API 网关统一管理网络层 ACL，所有入站流量经网关策略过滤 |
| b | 删除多余/无效规则，规则数量最小化 | 同上，网关策略运维层面控制 |
| c | 对源地址、目的地址、源端口、目的端口、协议等检查 | 同上 |
| d | 根据会话状态提供明确的允许/拒绝 | 同上 |
| e | 基于应用协议和内容的访问控制 | 同上，Tyk Gateway 支持应用层路由和认证策略 |

> 网络层访问控制由 Tyk Gateway + 部署环境防火墙共同实现，不在本应用代码范围内。

### 8.1.3.5 安全审计（网络层审计）

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 网络边界/重要节点审计，覆盖每个用户 | Tyk Gateway 自带请求日志，记录所有 API 调用 |
| b | 审计记录含日期时间、用户、事件类型、是否成功等 | Tyk Gateway logs + 应用层 `audit_log` 表联动 |
| c | 审计记录保护、定期备份 | `audit_log` 表 append-only（不可修改/删除），PostgreSQL 备份策略覆盖 |
| d | 远程访问行为单独审计 | 网络层由堡垒机/VPN 日志覆盖，应用层由 `audit_log` 的 `client_ip` 字段记录 |

---

## 2. Secure Computing Environment / 8.1.4 安全计算环境 (Core)

### 8.1.4.2 访问控制（系统/应用层权限）

这是权限系统设计的核心依据，逐条落实：

#### a) 应对登录的用户分配账户和权限

**落实**: 每个用户有独立账户（`ichse.users`），登录后分配角色和权限。

```
ichse.users 表结构:
  id (UUID PK)         — 唯一标识
  email (UNIQUE)       — 登录标识
  phone (UNIQUE)       — 登录标识（中国用户习惯）
  display_name         — 显示名称
  role                 — 业务角色（5 种）
  password_hash        — bcrypt 哈希
  status               — 账户状态（active/disabled/locked）
  secret_level         — 安全标记（等保 8.1.4.2g）
  last_login_at        — 最近登录时间
  password_changed_at  — 最近改密时间
  failed_attempts      — 登录失败计数
  locked_until         — 锁定到期时间
```

#### b) 应重命名或删除默认账户，修改默认账户的默认口令

**落实**:
- 生产环境不存在 `dev_admin` 角色（仅在开发库存在）
- PostgreSQL 默认 `postgres` 用户不使用（Alpine 镜像以 `ichse` 替代）
- 种子账号创建后须立即修改密码

#### c) 应及时删除或停用多余的、过期的账户，避免共享账户

**落实**:
- `status` 字段支持 `disabled`（禁用）和 `locked`（锁定）
- 系统管理员可禁用/删除账户
- 连续 5 次登录失败自动锁定 30 分钟
- 每用户独立账户，无共享账号设计

#### d) 应授予管理用户所需的最小权限，实现管理用户的权限分离（核心：三员分立）

**落实**: 5 角色模型，严格权限分离。

| 操作 | system_admin | security_admin | audit_admin | business_user | viewer |
|------|:--:|:--:|:--:|:--:|:--:|
| 服务器/系统配置 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 用户账号 CRUD | ✓ | ✗ | ✗ | ✗ | ✗ |
| 角色/权限分配 | ✗ | ✓ | ✗ | ✗ | ✗ |
| 安全策略配置 | ✗ | ✓ | ✗ | ✗ | ✗ |
| 审计日志查看 | ✗ | ✗ | ✓ | ✗ | ✗ |
| API 定义 CRUD | ✗ | ✗ | ✗ | ✓ | ✗ |
| 密钥 CRUD | ✗ | ✗ | ✗ | ✓ | ✗ |
| 业务数据查看 | ✗ | ✗ | ✗ | ✓ | ✓ |

**三员隔离原则**:
- 系统管理员：只能看到系统层面数据（服务器状态、用户账号状态），**绝对不能看到业务数据**
- 安全管理员：只能看到安全策略和权限配置，**绝对不能看到业务数据**
- 审计管理员：只能看到审计日志，**绝对不能看到原始业务数据**

**技术实现**:
- PostgreSQL RLS（行级安全）策略：三员角色对 `api_definitions`、`api_keys`、`api_definition_log` 表无任何访问权限
- 列级视图：`users_sysadmin_view`（屏蔽密码哈希和角色）、`users_secadmin_view`（屏蔽密码哈希和登录信息）、`users_biz_view`（只显示业务用户）

```sql
-- RLS 示例：业务数据仅 business_user 和 viewer 可读
CREATE POLICY ad_select ON ichse.api_definitions
FOR SELECT TO authenticated
USING (ichse.is_role('business_user') OR ichse.is_role('viewer'));

-- 列级视图示例：sysadmin 不可见 password_hash 和 role
CREATE VIEW ichse.users_sysadmin_view AS
SELECT id, email, phone, display_name, is_system,
       status, last_login_at, failed_attempts, locked_until,
       password_changed_at, created_at
FROM ichse.users;
```

#### e) 应由授权主体配置访问控制策略，访问控制策略规定主体对客体的访问规则

**落实**: 安全管理员（security_admin）是唯一的授权主体，负责：
- 给用户分配角色（将 user 提升为 business_user 等）
- 设置用户安全标记（secret_level）
- 配置安全策略

三员互相不能修改对方的权限：
- 系统管理员能创建/禁用账号，但不能分配角色
- 安全管理员能分配角色，但不能创建账号
- 审计管理员只能查看日志，不能修改任何配置

#### f) 访问控制的粒度应达到主体为用户级或进程级，客体为文件、数据库表级

**落实**:
- 主体粒度：**用户级**——每个用户的 JWT 包含 `sub`（用户 UUID）、`biz_role`、`secret_level`
- 客体粒度：**数据库表级**——PostgreSQL RLS 策略覆盖全部 5 张业务表
- 列级控制：通过视图实现不同角色可见不同列

#### g) 应对重要主体和客体设置安全标记，并控制主体对有安全标记信息资源的访问

**落实**: 强制访问控制（MAC），四级安全标记。

| 标记 | 含义 | 示例 |
|------|------|------|
| `公开` | 可对外发布的信息 | 公开 API 文档 |
| `内部` | 内部工作信息 | 内部管理 API |
| `敏感` | 涉及个人隐私/商业秘密 | 含用户数据的 API |
| `机密` | 涉及国家安全/核心商业机密 | 核心业务系统 API |

**用户标记**: `ichse.users.secret_level`
**数据标记**: `ichse.api_definitions.secret_level`、`ichse.api_keys.secret_level`

**MAC 规则**: 用户的安全等级必须 **≥** 数据的安全等级才能访问。

```sql
-- 安全等级比较函数
CREATE FUNCTION ichse.secret_level_compare(user_level TEXT, data_level TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
    SELECT CASE user_level
        WHEN '机密' THEN CASE data_level
            WHEN '机密' THEN 1 WHEN '敏感' THEN 1 WHEN '内部' THEN 1 WHEN '公开' THEN 1 END
        WHEN '敏感' THEN CASE data_level
            WHEN '机密' THEN -1 WHEN '敏感' THEN 1 WHEN '内部' THEN 1 WHEN '公开' THEN 1 END
        ...
    END;
$$;
```

### 8.1.4.3 安全审计（系统/应用层审计，核心）

#### a) 应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计

**落实**: 独立的 `ichse.audit_log` 表，记录全部用户操作。

| 事件分类 | event_type | 说明 |
|---------|-----------|------|
| 认证 | `login`, `logout`, `login_failed`, `password_change` | 所有登录行为 |
| 用户管理 | `user_create`, `user_disable`, `user_enable`, `user_delete`, `user_role_change` | 账号生命周期 |
| 权限管理 | `permission_change`, `role_config_change` | 安全管理员操作 |
| API 管理 | `api_create`, `api_update`, `api_delete`, `api_sync`, `api_status_change` | 业务操作 |
| 密钥管理 | `key_create`, `key_revoke`, `key_expire` | 密钥生命周期 |
| 系统配置 | `config_change`, `gateway_restart`, `gateway_stop` | 系统管理员操作 |
| 审计操作 | `audit_view`, `audit_export` | 审计管理员操作 |

#### b) 审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息

**落实**: `audit_log` 表完整字段：

```
event_time      TIMESTAMPTZ    — 日期和时间
user_id         UUID           — 用户
user_email      TEXT           — 用户邮箱（冗余，方便查询）
user_role       TEXT           — 操作时的角色快照
event_type      TEXT           — 事件类型
event_success   BOOLEAN        — 是否成功
target_type     TEXT           — 操作对象类型（user/api_definition/api_key/config）
target_id       TEXT           — 操作对象标识
target_detail   JSONB          — 操作对象描述
changes         JSONB          — 变更内容（before/after diff）
error_message   TEXT           — 失败原因
client_ip       TEXT           — 客户端 IP
user_agent      TEXT           — User-Agent
```

#### c) 应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等

**落实**:
- **append-only**: RLS 策略禁止任何人 UPDATE/DELETE `audit_log`
- **HMAC 防篡改**: 每条记录写入时自动计算 HMAC-SHA256 签名
- **写入隔离**: 仅通过 `write_audit_log()` SECURITY DEFINER 函数写入，绕过 RLS
- **备份**: PostgreSQL 定期备份策略覆盖 `audit_log` 表
- **留存 ≥ 6 年**: 符合医疗行业要求（《医疗卫生机构网络安全管理办法》）

```sql
-- HMAC 防篡改
v_hmac := encode(
    hmac(v_row_data::BYTEA, current_setting('app.jwt_secret')::BYTEA, 'sha256'),
    'hex'
);

-- RLS：任何人不可修改/删除审计日志
-- 仅 audit_admin 可 SELECT
CREATE POLICY al_select ON ichse.audit_log
FOR SELECT TO authenticated
USING (ichse.is_role('audit_admin'));
```

#### d) 应对审计进程进行保护，防止未经授权的中断

**落实**:
- `write_audit_log()` 函数使用 `SECURITY DEFINER`，以函数 owner 身份运行
- 审计日志写入在业务操作同一事务中完成，保证一致性
- 审计管理员仅可查看日志（SELECT），不可修改/删除
- 审计日志表受 PostgreSQL 事务保护，无法被绕过

---

## 3. Security Management Center / 8.1.5 安全管理中心

### 8.1.5.1 系统管理

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 对系统管理员进行身份鉴别，只允许通过特定界面进行系统管理操作，并对操作进行审计 | `system_admin` 角色登录后只能看到系统管理相关页面（系统仪表板、网关管理、用户账号管理），所有操作写入 `audit_log` |

**系统管理员可见页面**:
- 系统仪表板（CPU/内存/Redis/Gateway 状态）
- 网关管理（Docker 容器生命周期）
- 用户管理（创建/禁用/删除账号）
- 系统配置

**系统管理员不可见**:
- 业务 API 定义和密钥
- 业务变更日志
- 审计日志
- 安全策略配置

### 8.1.5.2 审计管理

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 对审计管理员进行身份鉴别，只允许通过特定界面进行安全审计操作，并对操作进行审计 | `audit_admin` 角色登录后只能看到审计日志页，所有操作写入 `audit_log` |

**审计管理员可见**: 审计日志（全部事件类型），支持查询、筛选、导出
**审计管理员不可见**: 业务数据原始内容、系统配置、安全策略、任何管理员密码

**脱敏要求**: 审计日志中涉及业务数据的部分进行脱敏处理（日志中不显示患者姓名等敏感字段，仅显示记录 ID）

### 8.1.5.3 安全管理

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 对安全管理员进行身份鉴别，只允许通过特定界面进行安全管理操作，并对操作进行审计 | `security_admin` 角色登录后只能看到安全策略页面和用户角色分配，所有操作写入 `audit_log` |
| b | 通过安全管理员对安全策略进行配置，包括安全参数设置、主体/客体安全标记、授权、可信验证策略 | 安全管理员负责：用户角色分配、安全标记设置、访问控制策略配置 |

**安全管理员可见**: 用户角色列表、权限配置、安全标记、安全告警
**安全管理员不可见**: 业务数据、系统底层配置、审计日志

---

## 4. Security Personnel Management / 8.1.7 安全管理人员

### 8.1.7.2 人员配备

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 应配备一定数量的系统管理员、审计管理员和安全管理员 | 系统支持三种管理角色的独立账户 |
| b | 应配备专职安全管理员，不可兼任 | 技术层面强制：`security_admin` 角色不能访问系统管理和审计管理功能，一个账户只能有一种管理角色 |

---

## 5. Security Operations / 8.1.10 安全运维管理

### 8.1.10.6 网络和系统安全管理

| 条款 | 要求 | 落实方案 |
|------|------|---------|
| a | 划分不同的管理员角色，明确责任和权限 | 5 角色模型（三员 + 业务用户 + 只读） |
| b | 指定专门部门或人员进行账户管理 | `system_admin` 负责账户创建/删除，`security_admin` 负责权限分配 |
| c | 建立安全管理制度（账户管理、配置管理、日志管理、口令更新等） | `password_changed_at` 字段支持强制定期改密；`audit_log` 记录所有操作 |
| e | 详细记录运维操作日志 | `audit_log.changes` (JSONB) 记录每次变更的 before/after diff |
| g | 严格控制变更性运维，经过审批才可操作，保留不可更改审计日志 | RLS 策略确保审计日志不可修改/删除 |

---

## 6. Authentication Mechanism / 认证机制设计

### JWT 认证流程

```
1. 用户提交 手机号/邮箱 + 密码
2. PostgREST POST /rpc/login → PostgreSQL login() 函数
3. login() 校验 bcrypt 密码哈希（pgcrypto）
4. 校验通过 → pgjwt.sign() 签发 JWT
5. JWT 包含:
   - role: "authenticated" (PostgREST PG 角色)
   - sub: 用户 UUID
   - biz_role: 业务角色
   - email/phone/display_name
   - secret_level: 安全标记
   - iat/exp: 签发/过期时间
6. 前端存储 JWT，每次请求带 Authorization: Bearer <jwt>
7. PostgREST 验证 JWT 签名 → SET LOCAL ROLE authenticated
8. db_pre_request() 运行：解析 JWT claims → 检查用户状态 → 设置会话变量 → 速率限制
9. RLS 策略根据 app.role / app.user_id / app.secret_level 控制数据访问
```

### 密码安全

- 算法: bcrypt (Blowfish)，通过 `pgcrypto.crypt(password, gen_salt('bf'))`
- 锁定策略: 连续 5 次失败 → 自动锁定 30 分钟
- 强制定期改密: `password_changed_at` 字段支持（Phase 2 实现检查逻辑）

### 会话安全

- JWT 有效期: 8 小时
- 无 refresh token（过期后重新登录）
- Token 存储在浏览器 localStorage
- 登出时清除 localStorage

---

## 7. Healthcare Industry Compliance / 医疗行业补充合规

### GB/T 39725-2020《健康医疗数据安全指南》

| 要求 | 落实 |
|------|------|
| 数据分级授权 | 4 级安全标记（公开/内部/敏感/机密）+ MAC 控制 |
| 操作留痕 | 全部操作写入 `audit_log` |
| 日志留存 ≥ 6 年 | `audit_log` 表按月分区，PG 备份策略 ≥ 6 年 |
| 数据脱敏 | 审计日志中敏感字段（患者姓名等）仅存记录 ID |

---

## 8. Technical Implementation / 技术实现清单

### 数据库对象

| 对象 | 类型 | 用途 |
|------|------|------|
| `ichse.users` | 表 | 用户账户（14 列，3 CHECK 约束） |
| `ichse.api_definitions` | 表 | API 定义（含 secret_level） |
| `ichse.api_keys` | 表 | 密钥管理（含 secret_level） |
| `ichse.api_definition_log` | 表 | API 变更快照（回滚用） |
| `ichse.audit_log` | 表 | 安全审计日志（append-only + HMAC） |
| `ichse.rate_limit` | 表 | 用户级速率限制 |
| `ichse.users_sysadmin_view` | 视图 | 系统管理员列级视图 |
| `ichse.users_secadmin_view` | 视图 | 安全管理员列级视图 |
| `ichse.users_biz_view` | 视图 | 业务用户列级视图 |
| `ichse.login()` | 函数 | 密码登录（pgjwt 签发 JWT） |
| `ichse.login_with_code()` | 函数 | 验证码登录（预留） |
| `ichse.db_pre_request()` | 函数 | PostgREST 预处理钩子 |
| `ichse.write_audit_log()` | 函数 | 审计日志写入（SECURITY DEFINER） |
| `ichse.sign()` | 函数 | pgjwt JWT 签发 |
| `ichse.verify()` | 函数 | pgjwt JWT 验证 |
| `ichse.secret_level_compare()` | 函数 | 安全等级 MAC 比较 |
| `ichse.is_role()` | 函数 | 角色判断辅助 |
| `ichse.base64url_encode()` | 函数 | Base64URL 编码 |

### RLS 策略（11 条）

| 表 | SELECT | INSERT | UPDATE | DELETE |
|----|--------|--------|--------|--------|
| `api_definitions` | business_user, viewer | business_user | business_user | business_user |
| `api_keys` | business_user, viewer | business_user | business_user | business_user |
| `api_definition_log` | business_user, viewer | business_user | — | — |
| `audit_log` | audit_admin | —（仅函数写入） | — | — |
| `users` | —（仅视图+函数） | — | — | — |

### 角色-页面矩阵

| 页面 | system_admin | security_admin | audit_admin | business_user | viewer |
|------|:--:|:--:|:--:|:--:|:--:|
| 系统仪表板 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 业务仪表板 | ✗ | ✗ | ✗ | ✓ | ✓ |
| 网关管理 | ✓ | ✗ | ✗ | ✗ | ✗ |
| API 服务 | ✗ | ✗ | ✗ | ✓ | ✓(只读) |
| 密钥管理 | ✗ | ✗ | ✗ | ✓ | ✓(只读) |
| 历史记录 | ✗ | ✗ | ✗ | ✓ | ✓(只读) |
| 系统设置 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 用户管理 | ✓(账号CRUD) | ✓(角色分配) | ✗ | ✗ | ✗ |
| 审计日志 | ✗ | ✗ | ✓ | ✗ | ✗ |
| 安全策略 | ✗ | ✓ | ✗ | ✗ | ✗ |

---

## 9. Verification Commands / 验证命令

```bash
# 测试各角色登录
TOKEN=$(docker exec ichse-postgres psql -U ichse -d ichse -t -A \
  -c "SELECT ichse.login('dev_biz@ichse.local', 'Test1234!');" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 测试认证
printf -v header "Bearer %s" "$TOKEN"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "$header" \
  http://localhost:3001/api_definitions
```

## Test Accounts / 测试账号

| 角色 | 邮箱 | 密码 | 安全等级 |
|------|------|------|---------|
| 系统管理员 | dev_admin@ichse.local | Test1234! | 机密 |
| 安全管理员 | dev_sec@ichse.local | Test1234! | 机密 |
| 审计管理员 | dev_audit@ichse.local | Test1234! | 机密 |
| 业务用户 | dev_biz@ichse.local | Test1234! | 内部 |
| 只读用户 | dev_viewer@ichse.local | Test1234! | 内部 |

> **生产部署前必须删除所有 dev 账号，修改 JWT secret。**
