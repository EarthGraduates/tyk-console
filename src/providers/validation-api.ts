/**
 * PostgREST helpers for biz schema: interfaces, fields, rules
 * @module providers/validation-api
 */

const PG_BASE = import.meta.env.VITE_POSTGREST_URL || 'http://localhost:3001';
const SERVICES_BASE = import.meta.env.VITE_SERVICES_URL || 'http://localhost:8000';

async function pgFetch(path: string, options?: RequestInit) {
  const resp = await fetch(`${PG_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

// ── Interfaces ──

export interface BizInterface {
  id: number;
  interface_id: string;
  platform: string;
  biz_category: string;
  category_code: string;
  func_name: string;
  interface_name: string;
  direction: string;
  data_flow: string;
  status: string;
}

export async function listInterfaces(): Promise<BizInterface[]> {
  return pgFetch('/biz_interface_summary');
}

// ── Fields ──

export interface InterfaceField {
  id: number;
  field_name: string;
  field_path: string;
  field_type: string;
  direction: string;
  required: boolean;
  description: string;
}

export async function listFields(interfaceId: number): Promise<InterfaceField[]> {
  return pgFetch(`/interface_fields?interface_id=eq.${interfaceId}&is_valid=is.true&order=id`);
}

// ── Rules ──

export interface ValidationRule {
  id: number;
  field_id: number;
  rule_type: string;
  rule_config: Record<string, unknown>;
  error_message: string;
  is_active: boolean;
}

export async function listRules(fieldId: number): Promise<ValidationRule[]> {
  return pgFetch(`/validation_rules?field_id=eq.${fieldId}&is_valid=is.true&order=id`);
}

export async function createRule(data: {
  field_id: number;
  rule_type: string;
  rule_config: Record<string, unknown>;
  error_message: string;
}): Promise<ValidationRule> {
  return pgFetch('/validation_rules', {
    method: 'POST',
    body: JSON.stringify({ ...data, is_active: true }),
    headers: { 'Prefer': 'return=representation' },
  });
}

export async function updateRule(
  id: number,
  data: Partial<ValidationRule>,
): Promise<ValidationRule> {
  return pgFetch(`/validation_rules?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    headers: { 'Prefer': 'return=representation' },
  });
}

export async function deleteRule(id: number): Promise<void> {
  await pgFetch(`/validation_rules?id=eq.${id}`, { method: 'PATCH',
    body: JSON.stringify({ is_valid: false, deleted_at: new Date().toISOString() }),
  });
}

export async function refreshRules(): Promise<{ status: string; rules_cached: number }> {
  const resp = await fetch(`${SERVICES_BASE}/admin/refresh-rules`, { method: 'POST' });
  return resp.json();
}
