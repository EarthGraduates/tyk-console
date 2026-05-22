/**
 * 多数据源 Provider 导出
 *
 * - `default` → ichseDb（PostgREST，带 JWT 认证）
 * - `tyk` → Tyk Gateway（API 管理 / 密钥 CRUD）
 *
 * @module providers/data
 */

import { ichseDbDataProvider } from './ichse-db-data-provider';
import { tykDataProvider } from './tyk-data-provider';

export const dataProvider = ichseDbDataProvider;

export const dataProviderMap = {
  default: ichseDbDataProvider,
  tyk: tykDataProvider,
  ichseDb: ichseDbDataProvider,
};
