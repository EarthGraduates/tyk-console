/**
 * 样本类型字典 — 只读浏览
 */
import { useState, useEffect, useMemo } from 'react';
import { Table, Input, Card, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface SampleTypeRow {
  id: number;
  org_lab: string;
  sample_type: string;
  sample_describe: string;
}

export default function SampleTypesPage() {
  const [data, setData] = useState<SampleTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/db/lab_sample_types?order=id.asc&limit=500')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div style={{ padding: 24 }}><Card title="样本类型字典"><Typography.Text type="danger">加载失败: {error}</Typography.Text></Card></div>;

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter(r =>
      r.sample_type?.toLowerCase().includes(s) ||
      r.sample_describe?.toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div style={{ padding: 24 }}>
      <Card title="样本类型字典">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索样本类型"
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
            { title: '样本代码', dataIndex: 'sample_type', width: 160 },
            { title: '样本描述', dataIndex: 'sample_describe', width: 200 },
            { title: '临检机构', dataIndex: 'org_lab', width: 120 },
          ]}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
        />
      </Card>
    </div>
  );
}
