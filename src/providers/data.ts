import { dataProvider as supabaseDataProvider } from '@refinedev/supabase';
import { supabaseClient } from './supabase-client';
import { tykDataProvider } from './tyk-data-provider';

export const dataProvider = supabaseDataProvider(supabaseClient);

export const dataProviderMap = {
  default: supabaseDataProvider(supabaseClient),
  tyk: tykDataProvider,
};
