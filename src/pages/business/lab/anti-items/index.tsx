/**
 * 药敏字典 — 只读浏览
 */
import { useState, useEffect, useMemo } from 'react';
import { Table, Input, Card, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface AntiItemRow {
  id: number;
  org_lab: string;
  anti_id: string;
  chinese_name: string;
}

export default function AntiItemsPage() {
  const [data, setData] = useState<AntiItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/db/lab_anti_items?order=id.asc&limit=500')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div style={{ padding: 24 }}><Card title="药敏字典"><Typography.Text type="danger">加载失败: {error}</Typography.Text></Card></div>;

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter(r =>
      r.anti_id?.toLowerCase().includes(s) ||
      r.chinese_name?.toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div style={{ padding: 24 }}>
      <Card title="药敏字典">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索药敏"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 280 }}
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
            { title: '药敏代码', dataIndex: 'anti_id', width: 160 },
            { title: '药敏名称', dataIndex: 'chinese_name', width: 240 },
            { title: '临检机构', dataIndex: 'org_lab', width: 120 },
          ]}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
        />
      </Card>
    </div>
  );
}
