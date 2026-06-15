/**
 * 检验项目字典 — 只读浏览
 */
import { useState, useEffect, useMemo } from 'react';
import { Table, Input, Card, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface RequestItemRow {
  id: number;
  org_lab: string;
  req_item_code: string;
  req_item_name: string;
  compose_type?: string;
  sp_type?: string;
}

export default function RequestItemsPage() {
  const [data, setData] = useState<RequestItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/db/lab_request_items?order=id.asc&limit=500')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div style={{ padding: 24 }}><Card title="检验项目字典"><Typography.Text type="danger">加载失败: {error}</Typography.Text></Card></div>;

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter(r =>
      r.req_item_code?.toLowerCase().includes(s) ||
      r.req_item_name?.toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div style={{ padding: 24 }}>
      <Card title="检验项目字典">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索检验项目"
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
            { title: '项目代码', dataIndex: 'req_item_code', width: 160 },
            { title: '项目名称', dataIndex: 'req_item_name', width: 240 },
            { title: '组合类型', dataIndex: 'compose_type', width: 100 },
            { title: '标本类型', dataIndex: 'sp_type', width: 120 },
            { title: '临检机构', dataIndex: 'org_lab', width: 120 },
          ]}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
        />
      </Card>
    </div>
  );
}
