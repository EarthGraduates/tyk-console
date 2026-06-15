/**
 * 设备管理 — 查看检验设备清单
 */
import { useState, useEffect } from 'react';
import { Table, Card, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { labAdminDb, type LabDeviceInfo } from '../../../../providers/lab-db';

export default function DevicesPage() {
  const [data, setData] = useState<LabDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    labAdminDb.listDevices()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? data.filter(r =>
        r.device_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.device_code?.toLowerCase().includes(search.toLowerCase()))
    : data;

  return (
    <div style={{ padding: 24 }}>
      <Card title="设备管理">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索设备"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 240 }}
          />
        </Space>
        <Typography.Text type="secondary" style={{ marginLeft: 16 }}>
          共 {filtered.length} 台设备
        </Typography.Text>
        <Table
          dataSource={filtered}
          loading={loading}
          rowKey="id"
          columns={[
            { title: '机构', dataIndex: 'org_lab', width: 100 },
            { title: '设备代码', dataIndex: 'device_code', width: 140 },
            { title: '设备名称', dataIndex: 'device_name', width: 180 },
            { title: '型号', dataIndex: 'model', width: 140 },
            { title: '序列号', dataIndex: 'sn', width: 160 },
            { title: '制造商', dataIndex: 'manufacturer', width: 140 },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
