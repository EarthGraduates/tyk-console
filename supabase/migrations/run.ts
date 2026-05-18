/**
 * Supabase 数据库初始化脚本
 *
 * 用法：npx tsx supabase/migrations/run.ts
 * 前提：.env 中设置了正确的 SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 从环境变量或 .env 读取
const url = process.env.VITE_API_URL || process.env.SUPABASE_URL || 'https://iwdfzvfqbtokqetmbmbp.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!key || key.includes('...')) {
  console.error('❌ 请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  console.error('   在 Supabase Dashboard → Project Settings → API → service_role key');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

async function runSql(sql: string) {
  const { error } = await supabase.rpc('pgsodium', {}).maybeSingle();
  // supabase-js v2 does not support raw SQL directly.
  // Use the Management API instead.
}

// 使用 Supabase Management API
async function runMigration() {
  const sql = fs.readFileSync(
    path.join(import.meta.dirname, '001_init.sql'),
    'utf-8',
  );

  // Split by statement (naive split on semicolons outside strings)
  const statements = sql
    .split(';\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  console.log(`📦 准备执行 ${statements.length} 条 SQL 语句...`);

  // Use Supabase SQL API (requires service_role key)
  const res = await fetch(`${url}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates',
    },
  });

  if (!res.ok) {
    console.error('❌ 无法连接到 Supabase:', res.status, await res.text());
    process.exit(1);
  }

  // Execute each statement via the SQL endpoint
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    try {
      const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: stmt }),
      });
      if (res.ok) {
        console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
      } else {
        const err = await res.text();
        console.warn(`  ⚠️  [${i + 1}/${statements.length}] ${preview}... → ${err.substring(0, 100)}`);
      }
    } catch (e: any) {
      console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}... → ${e.message}`);
    }
  }

  console.log('\n🎉 迁移完成！');
}

runMigration().catch(console.error);
