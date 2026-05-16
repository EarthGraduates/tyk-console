/**
 * 多数据源 Provider 导出
 *
 * @description
 * - `dataProvider`: Supabase 单 provider（向后兼容现有 Refine 配置）
 * - `dataProviderMap`: 双 provider 映射
 *   - `default` → Supabase（用户认证）
 *   - `tyk` → Tyk Gateway（API 管理 / 密钥 CRUD）
 *
 * @module providers/data
 */

import { dataProvider as supabaseDataProvider } from '@refinedev/supabase';
import { supabaseClient } from './supabase-client';
import { tykDataProvider } from './tyk-data-provider';

export const dataProvider = supabaseDataProvider(supabaseClient);

export const dataProviderMap = {
  default: supabaseDataProvider(supabaseClient),
  tyk: tykDataProvider,
};
