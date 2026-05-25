/**
 * 审计日志页
 *
 * audit_admin / system_admin 查看。
 * 服务端分页 + 筛选，支持 CSV 导出。
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Space, DatePicker, Select, Input, Button, Typography,
} from 'antd';
import { SearchOutlined, ExportOutlined } from '@ant-design/icons';
import { auditLogDb, type AuditLogRecord } from '../../providers/ichse-db';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const EVENT_COLORS: Record<string, string> = {
  login: 'green', login_failed: 'red', logout: 'default',
  user_create: 'blue', user_disable: 'orange', user_enable: 'green',
  user_delete: 'red', user_role_change: 'purple',
  api_create: 'blue', api_update: 'orange', api_delete: 'red',
  api_sync: 'cyan', api_status_change: 'orange',
  key_create: 'blue', key_revoke: 'red',
  permission_change: 'purple',
  audit_view: 'default', audit_export: 'default',
  password_change: 'orange',
  session_revoke: 'orange',
  gateway_restart: 'orange', gateway_stop: 'red',
};

const COMMON_EVENT_TYPES = [
  'login', 'login_failed', 'logout',
  'user_create', 'user_disable', 'user_enable', 'user_delete', 'user_role_change',
  'api_create', 'api_update', 'api_delete', 'api_sync', 'api_status_change',
  'key_create', 'key_revoke',
  'audit_view', 'audit_export',
  'password_change',
  'session_revoke',
  'gateway_restart', 'gateway_stop',
  'permission_change',
];

interface QueryParams {
  event_type?: string;
  user_email?: string;
  from?: string;
  to?: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [filters, setFilters] = useState<QueryParams>({});

  const fetchLogs = useCallback(async (p: number, ps: number) => {
    setLoading(true);
    try {
      const offset = (p - 1) * ps;
      const { data, total: t } = await auditLogDb.list({
        ...filters,
        limit: ps,
        offset,
      });
      setLogs(data);
      setTotal(t);
    } catch (e: any) {
      console.error('Audit log fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchLogs(page, pageSize); }, [fetchLogs, page, pageSize]);

  useEffect(() => {
    auditLogDb.eventTypes().then(setEventTypes).catch(() => {});
  }, []);

  const handleQuery = () => {
    setPage(1);
    fetchLogs(1, pageSize);
  };

  const handleExport = () => {
    // 导出当前查询的全部结果（最多 10000 条）
    auditLogDb.list({ ...filters, limit: 10000, offset: 0 }).then(({ data }) => {
      const csv = [
        ['时间', '用户', '角色', '事件', '成功', '目标类型', '目标ID', '详情', 'IP'].join(','),
        ...data.map(l => [
          l.event_time,
          l.user_email || '',
          l.user_role || '',
          l.event_type,
          l.event_success ? '是' : '否',
          l.target_type || '',
          l.target_id || '',
          l.target_detail ? JSON.stringify(l.target_detail).replace(/"/g, '""') : '',
          l.client_ip || '',
        ].map(v => `"${v}"`).join(',')),
      ].join('\n');

      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => {});
  };

  const handleTableChange = (pag: any) => {
    setPage(pag.current);
    setPageSize(pag.pageSize);
  };

  const columns = [
    {
      title: '时间', dataIndex: 'event_time', key: 'event_time', width: 170,
      render: (t: string) => new Date(t).toLocaleString(),
    },
    { title: '用户', dataIndex: 'user_email', key: 'user_email', ellipsis: true, width: 180 },
    {
      title: '角色', dataIndex: 'user_role', key: 'user_role', width: 90,
      render: (r: string) => r ? <Tag>{r}</Tag> : '-',
    },
    {
      title: '事件', dataIndex: 'event_type', key: 'event_type', width: 120,
      render: (t: string) => <Tag color={EVENT_COLORS[t] || 'default'}>{t}</Tag>,
    },
    {
      title: '成功', dataIndex: 'event_success', key: 'event_success', width: 60,
      render: (s: boolean) => s ? <Tag color="green">是</Tag> : <Tag color="red">否</Tag>,
    },
    { title: '目标', dataIndex: 'target_type', key: 'target_type', width: 100 },
    { title: '目标ID', dataIndex: 'target_id', key: 'target_id', ellipsis: true, width: 120 },
    {
      title: '详情', dataIndex: 'target_detail', key: 'target_detail', width: 200,
      render: (d: any) => d ? <Text code style={{ fontSize: 11 }}>{JSON.stringify(d)}</Text> : '-',
    },
    { title: 'IP', dataIndex: 'client_ip', key: 'client_ip', width: 120 },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="审计日志"
        extra={
          <Space>
            <Button icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
            <Button icon={<ExportOutlined />} onClick={handleExport}>导出 CSV</Button>
          </Space>
        }
      >
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            style={{ width: 160 }}
            placeholder="事件类型"
            allowClear
            value={filters.event_type}
            onChange={(v) => setFilters(f => ({ ...f, event_type: v }))}
            options={(eventTypes.length ? eventTypes : COMMON_EVENT_TYPES).map(t => ({ label: t, value: t }))}
          />
          <Input
            style={{ width: 280 }}
            placeholder="按用户邮箱搜索"
            allowClear
            prefix={<SearchOutlined />}
            value={filters.user_email}
            onChange={(e) => setFilters(f => ({ ...f, user_email: e.target.value || undefined }))}
          />
          <RangePicker
            showTime
            onChange={(dates) => {
              setFilters(f => ({
                ...f,
                from: dates?.[0]?.toISOString(),
                to: dates?.[1]?.toISOString(),
              }));
            }}
          />
        </Space>
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          loading={loading}
          onChange={handleTableChange}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          size="small"
          scroll={{ x: 1200 }}
        />
      </Card>
    </div>
  );
}
