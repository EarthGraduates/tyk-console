# 数据库迁移指引

## 方式一：Supabase Dashboard SQL Editor（推荐）

1. 打开 https://supabase.com/dashboard/project/iwdfzvfqbtokqetmbmbp
2. 左侧菜单 → SQL Editor
3. 新建查询，粘贴 `supabase/migrations/001_init.sql` 全部内容
4. 点击 Run

## 方式二：命令行（需要 service_role key）

```bash
# 1. 从 Supabase Dashboard → Project Settings → API → service_role key 获取密钥
# 2. 设置环境变量
export SUPABASE_URL=https://iwdfzvfqbtokqetmbmbp.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJhbG...你的service_role_key

# 3. 运行迁移
npx tsx supabase/migrations/run.ts
```
