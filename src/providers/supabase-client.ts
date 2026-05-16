/**
 * Supabase 客户端单例
 *
 * @description
 * 通过 @refinedev/supabase 的 createClient 创建 Supabase 客户端，
 * 配置 public schema + 持久化 session。
 *
 * @module providers/supabase-client
 */

import { createClient } from '@refinedev/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './constants';

export const supabaseClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: true,
    },
  },
);
