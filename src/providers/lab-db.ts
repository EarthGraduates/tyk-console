/**
 * LAB 业务数据访问层（PostgREST → PostgreSQL）
 *
 * @description
 * 封装 LAB 业务域所有数据访问：PostgREST 视图查询 + RPC 函数调用。
 * 复用 jwt.ts 的认证头，通过 Vite 代理 /db → localhost:3001。
 *
 * @module providers/lab-db
 */

// @ts-nocheck — 动态 JSON 响应类型较宽泛

import { getAuthHeader } from './jwt';

async function pgRest(method: string, path: string, body?: any, params?: Record<string, string>): Promise<any> {
  const url = new URL(`/db${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers: Record<string, string> = { ...getAuthHeader() };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }
  const res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PostgREST ${method} ${path}: ${res.status} ${err.substring(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── 通用 RPC 调用 ──

export async function labRpc(funcName: string, params: Record<string, unknown>): Promise<any> {
  return await pgRest('POST', '/rpc/' + funcName, { payload: params });
}

// ── 字典类型 ──

export interface LabSampleType {
  id: number;
  org_lab: string;
  sample_type: string;
  sample_describe: string;
  is_valid: boolean;
  created_at: string;
}

export interface LabRequestItem {
  id: number;
  org_lab: string;
  req_item_code: string;
  req_item_name: string;
  compose_type?: string;
  sp_type?: string;
  is_valid: boolean;
  created_at: string;
}

export interface LabTestItem {
  id: number;
  org_lab: string;
  test_id: string;
  chinese_name: string;
  unit?: string;
  method_name?: string;
  sp_type?: string;
  sp_describe?: string;
  is_valid: boolean;
  created_at: string;
}

export interface LabBioItem {
  id: number;
  org_lab: string;
  bio_id: string;
  chinese_name: string;
  is_valid: boolean;
  created_at: string;
}

export interface LabAntiItem {
  id: number;
  org_lab: string;
  anti_id: string;
  chinese_name: string;
  is_valid: boolean;
  created_at: string;
}

// ── 字典 CRUD ──

function dictParams(orgLab?: string): Record<string, string> {
  const p: Record<string, string> = { order: 'id.asc', limit: '500' };
  if (orgLab) p.org_lab = `eq.${orgLab}`;
  return p;
}

export const labDictDb = {
  async sampleTypes(orgLab?: string): Promise<LabSampleType[]> {
    return await pgRest('GET', '/lab_sample_types', null, dictParams(orgLab));
  },
  async requestItems(orgLab?: string): Promise<LabRequestItem[]> {
    return await pgRest('GET', '/lab_request_items', null, dictParams(orgLab));
  },
  async testItems(orgLab?: string): Promise<LabTestItem[]> {
    return await pgRest('GET', '/lab_test_items', null, dictParams(orgLab));
  },
  async bioItems(orgLab?: string): Promise<LabBioItem[]> {
    return await pgRest('GET', '/lab_bio_items', null, dictParams(orgLab));
  },
  async antiItems(orgLab?: string): Promise<LabAntiItem[]> {
    return await pgRest('GET', '/lab_anti_items', null, dictParams(orgLab));
  },
};

// ── 申请表相关 ──

export interface LabApplication {
  id: number;
  application_id: string;
  org_sending: string;
  sp_barcode?: string;
  pt_name?: string;
  pt_sex?: string;
  pt_age?: string;
  pt_id?: string;
  pt_phone?: string;
  pt_type?: string;
  pt_diagnostic?: string;
  pt_bed_no?: string;
  pt_ward_name?: string;
  req_section_name?: string;
  req_mode?: string;
  req_doctor?: string;
  req_time?: string;
  status?: string;
  accept_time?: string;
  send_flag?: number;
  reason?: string;
  col_org_code?: string;
  col_org_name?: string;
  is_valid: boolean;
  created_at: string;
}

export interface LabApplicationItem {
  id: number;
  application_id: number;
  req_item_code: string;
  req_item_name?: string;
  compose_type?: string;
  sp_type?: string;
  req_mode?: string;
  req_doctor?: string;
  preparation_note?: string;
}

export const labApplicationDb = {
  async list(params?: { org_sending?: string; status?: string; doctAdviseNo?: string; startDate?: string; endDate?: string }) {
    return await labRpc('lab_demo_qr_p01_get_application_list', {
      sendingOrg: params?.org_sending ?? null,
      status: params?.status ?? null,
      doctAdviseNo: params?.doctAdviseNo ?? null,
      startDate: params?.startDate ?? null,
      endDate: params?.endDate ?? null,
    });
  },

  async submit(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_qr_p02_submit_application', payload);
  },
};

// ── 标本相关 ──

export const labSpecimenDb = {
  /** D01: 根据条码获取标本详情 */
  async getByBarcode(doctAdviseNo: string) {
    return await labRpc('lab_demo_rc_d01_get_doct_advise_by_barcode', { doctAdviseNo });
  },

  /** D02: 标本接收登记 */
  async receive(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_rc_d02_receive_specimen', payload);
  },

  /** D03: 接收状态查询 */
  async getReceiveStatus(params: Record<string, unknown>) {
    return await labRpc('lab_demo_rc_d03_get_receive_sample_status', params);
  },

  /** D04: 不合格标本查询 */
  async getRejected(params: Record<string, unknown>) {
    return await labRpc('lab_demo_rc_d04_get_sample_back', params);
  },
};

// ── 报告相关 ──

export const labReportDb = {
  /** E01: 上传报告 */
  async submit(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_rp_e01_submit_report', payload);
  },

  /** E03: 查询报告 */
  async getByBarcode(doctAdviseNo: string) {
    return await labRpc('lab_demo_rp_e03_get_lab_report', { doctAdviseNo });
  },

  /** E08: 撤销报告 */
  async cancel(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_rp_e08_cancel_check_for_report', payload);
  },

  /** E09: 查询已撤销报告 */
  async getCanceled(params: Record<string, unknown>) {
    return await labRpc('lab_demo_rp_e09_get_cancel_check_report', params);
  },

  /** E10: 一审 */
  async submitFirstReview(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_rp_e10_submit_first_review', payload);
  },

  /** E11: 二审 */
  async submitSecondReview(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_rp_e11_submit_second_review', payload);
  },

  /** E12: 待审核队列 */
  async getPendingReviews(params: { reviewStage: string; labOrg?: string; startDate?: string; endDate?: string }) {
    return await labRpc('lab_demo_rp_e12_get_pending_reviews', {
      reviewStage: params.reviewStage,
      labOrg: params.labOrg ?? null,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
    });
  },

  /** E13: 审核日志 */
  async getReviewLogs(reportId: string) {
    return await labRpc('lab_demo_rp_e13_get_review_logs', { reportId });
  },
};

// ── 危急值 ──

export const labCriticalValueDb = {
  async list(params: Record<string, unknown>) {
    return await labRpc('lab_demo_cv_f02_get_sample_warn', params);
  },
  async updateFeedback(payload: Record<string, unknown>) {
    return await labRpc('lab_demo_cv_f03_update_warn_feedback', payload);
  },
};

// ── 质控 / 设备（PostgREST 直查） ──

export interface LabQcData {
  id: number;
  org_lab: string;
  qc_type: string;
  qc_date: string;
  instrument_code: string;
  test_item_code: string;
  qc_value: number;
  qc_target: number;
  qc_sd: number;
}

export interface LabDeviceInfo {
  id: number;
  org_lab: string;
  device_code: string;
  device_name: string;
  model?: string;
  sn?: string;
  manufacturer?: string;
}

export const labAdminDb = {
  async listQcData(): Promise<LabQcData[]> {
    return await pgRest('GET', '/lab_qc_data', null, { order: 'qc_date.desc', limit: '500' });
  },
  async listDevices(): Promise<LabDeviceInfo[]> {
    return await pgRest('GET', '/lab_device_info', null, { order: 'id.asc', limit: '500' });
  },
};
