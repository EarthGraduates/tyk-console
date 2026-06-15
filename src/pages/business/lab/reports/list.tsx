/**
 * 报告列表 — 按条码/日期/患者查询已发布的检验报告
 */
import { useState, useEffect, useMemo } from 'react';
import { Table, Card, Input, Space, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { labReportDb } from '../../../../providers/lab-db';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending_first_review: { color: 'blue', label: '待一审' },
  pending_second_review: { color: 'orange', label: '待二审' },
  issued: { color: 'green', label: '已签发' },
  rejected: { color: 'red', label: '已退回' },
  canceled: { color: 'default', label: '已撤销' },
};

export default function ReportListPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/db/lab_test_reports?order=created_at.desc&limit=200')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((r: any) =>
      r.sp_barcode?.toLowerCase().includes(s) ||
      r.pt_name?.toLowerCase().includes(s) ||
      r.rpt_id?.toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div style={{ padding: 24 }}>
      <Card title="检验报告列表">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索条码/报告ID/患者"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 300 }}
          />
        </Space>
        <Typography.Text type="secondary" style={{ marginLeft: 16 }}>
          共 {filtered.length} 条记录
        </Typography.Text>
        <Table
          dataSource={filtered}
          loading={loading}
          rowKey="id"
          columns={[
            { title: '报告 ID', dataIndex: 'rpt_id', width: 180 },
            { title: '条码号', dataIndex: 'sp_barcode', width: 160 },
            { title: '患者', dataIndex: 'pt_name', width: 100 },
            { title: '标本类型', dataIndex: 'sp_type', width: 100 },
            { title: '送检机构', dataIndex: 'org_sending_name', width: 140 },
            { title: '状态', dataIndex: 'rpt_status', width: 100,
              render: (v: string) => {
                const s = STATUS_MAP[v] || { color: 'default', label: v };
                return <Tag color={s.color}>{s.label}</Tag>;
              },
            },
            { title: '创建时间', dataIndex: 'created_at', width: 170 },
          ]}
          onRow={record => ({
            onClick: () => navigate(`/business/lab/reports/detail/${record.rpt_id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
