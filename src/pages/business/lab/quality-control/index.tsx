/**
 * 质控数据 — 查看实验室质控数据
 */
import { useState, useEffect } from 'react';
import { Table, Card, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { labAdminDb, type LabQcData } from '../../../../providers/lab-db';

export default function QualityControlPage() {
  const [data, setData] = useState<LabQcData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    labAdminDb.listQcData()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? data.filter(r =>
        r.test_item_code?.toLowerCase().includes(search.toLowerCase()) ||
        r.instrument_code?.toLowerCase().includes(search.toLowerCase()))
    : data;

  return (
    <div style={{ padding: 24 }}>
      <Card title="质控数据">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索项目/设备"
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
          rowKey="id"
          columns={[
            { title: '机构', dataIndex: 'org_lab', width: 100 },
            { title: '质控类型', dataIndex: 'qc_type', width: 100 },
            { title: '日期', dataIndex: 'qc_date', width: 120 },
            { title: '设备', dataIndex: 'instrument_code', width: 140 },
            { title: '项目', dataIndex: 'test_item_code', width: 140 },
            { title: '质控值', dataIndex: 'qc_value', width: 100 },
            { title: '靶值', dataIndex: 'qc_target', width: 100 },
            { title: 'SD', dataIndex: 'qc_sd', width: 80 },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
