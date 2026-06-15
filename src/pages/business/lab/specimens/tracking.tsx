/**
 * 标本状态跟踪 — 按日期/条码查看全流程节点状态
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Table, Card, Input, DatePicker, Space, Tag, Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const SP_STATUS_MAP: Record<string, { color: string; label: string }> = {
  registered: { color: 'default', label: '已登记' },
  received: { color: 'green', label: '已接收' },
  rejected: { color: 'red', label: '已退回' },
};

export default function SpecimenTrackingPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  useEffect(() => {
    let url = '/db/lab_specimen_items?order=id.asc&limit=200';
    if (dateRange) {
      url += `&col_time=gte.${dateRange[0].format('YYYY-MM-DD')}&col_time=lte.${dateRange[1].format('YYYY-MM-DD')}`;
    }
    setLoading(true);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateRange]);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((r: any) =>
      r.doctAdviseNo?.toLowerCase().includes(s) ||
      r.patientName?.toLowerCase().includes(s) ||
      r.patientId?.toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div style={{ padding: 24 }}>
      <Card title="标本状态跟踪">
        <Space style={{ marginBottom: 16 }} wrap>
          <DatePicker.RangePicker
            value={dateRange as any}
            onChange={dates => setDateRange(dates as any)}
          />
          <Input
            placeholder="搜索条码/患者/ID"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 240 }}
          />
        </Space>
        <Typography.Text type="secondary" style={{ marginLeft: 16 }}>
          共 {filtered.length} 条记录
        </Typography.Text>
        <Table
          dataSource={filtered}
          loading={loading}
          rowKey={(r: any) => r.doctAdviseNo || r.id}
          columns={[
            { title: '条码号', dataIndex: 'sp_barcode', width: 160 },
            { title: '患者', dataIndex: 'pt_name', width: 100 },
            { title: '标本类型', dataIndex: 'sp_type', width: 100 },
            { title: '状态', dataIndex: 'sp_status', width: 100,
              render: (v: string) => {
                const s = SP_STATUS_MAP[v] || { color: 'default', label: v || '—' };
                return <Tag color={s.color}>{s.label}</Tag>;
              },
            },
            { title: '采集机构', dataIndex: 'col_org_code', width: 120 },
            { title: '采集者', dataIndex: 'col_name', width: 100 },
            { title: '送检机构', dataIndex: 'sp_describe', width: 120 },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
