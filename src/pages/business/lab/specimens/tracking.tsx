/**
 * 标本状态跟踪 — 按日期/条码查看全流程节点状态
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Table, Card, Input, DatePicker, Space, Tag, Typography, Timeline,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { labSpecimenDb, labReportDb } from '../../../../providers/lab-db';

const REC_STATUS_MAP: Record<string, { color: string; label: string }> = {
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
    const params: any = {};
    if (dateRange) {
      params.startDate = dateRange[0].format('YYYY-MM-DD');
      params.endDate = dateRange[1].format('YYYY-MM-DD');
    }
    setLoading(true);
    labSpecimenDb.getReceiveStatus(params)
      .then(res => setData(res?.dataInfoList || []))
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
            { title: '条码号', dataIndex: 'doctAdviseNo', width: 160 },
            { title: '患者', dataIndex: 'patientName', width: 100 },
            { title: '标本类型', dataIndex: 'sampleType', width: 100 },
            { title: '标本状态', dataIndex: 'sampleStatus', width: 100,
              render: (v: string) => {
                const s = REC_STATUS_MAP[v] || { color: 'default', label: v || '—' };
                return <Tag color={s.color}>{s.label}</Tag>;
              },
            },
            { title: '接收时间', dataIndex: 'receiveTime', width: 170 },
            { title: '接收者', dataIndex: 'receiver', width: 100 },
            { title: '采集机构', dataIndex: 'collectingOrgCode', width: 120 },
            { title: '采集者', dataIndex: 'executorName', width: 100 },
            { title: '备注', dataIndex: 'examinaim', width: 150, render: (v: string) => v || '—' },
          ]}
          expandable={{
            expandedRowRender: (record: any) => (
              <Timeline
                items={[
                  { color: 'green', children: `条码登记: ${record.doctAdviseNo}` },
                  ...(record.receiveTime ? [{ color: 'blue', children: `标本接收: ${record.receiveTime} (${record.receiver || '—'})` }] : []),
                  ...(record.sampleStatus === 'rejected' ? [{ color: 'red', children: `已退回: ${record.rejectReason || ''}` }] : []),
                ]}
              />
            ),
          }}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
