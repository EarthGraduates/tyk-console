/**
 * 接口管理页面
 *
 * biz.interfaces 为服务元数据权威源。支持查看接口详情 + 一键注册 API。
 */
import { Table, Button, Space, Tag, Input, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { HideFromViewer } from '../../providers/permissions';

interface InterfaceRecord {
  id: number;
  interface_id: string;
  biz_domain: string;
  interface_name: string;
  func_name: string;
  category_code: string;
  data_flow: string;
  url: string;
  description: string;
}

const PG_URL = 'http://localhost:3001';

async function fetchInterfaces(): Promise<InterfaceRecord[]> {
  const resp = await fetch(`${PG_URL}/biz_interfaces?order=id.asc`);
  if (!resp.ok) throw new Error('Failed to fetch interfaces');
  return resp.json();
}

export default function InterfacesPage() {
  const [data, setData] = useState<InterfaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [searchText, setSearchText] = useState('');
  const [registering, setRegistering] = useState(false);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchInterfaces()); } catch { message.error('加载失败'); }
    setLoading(false);
  }, [message]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => data.find((r) => r.interface_id === selectedKeys[0]),
    [data, selectedKeys],
  );

  const registerApi = async () => {
    if (!selected) return;
    setRegistering(true);
    try {
      const resp = await fetch(`${window.location.origin}/admin/register-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interface_id: selected.interface_id, auth_mode: 'keyless' }),
      });
      if (resp.ok) {
        message.success(`API 已注册: ${selected.interface_id}`);
      } else {
        const err = await resp.json();
        message.error(`注册失败: ${err.detail || JSON.stringify(err)}`);
      }
    } catch (e: any) {
      message.error(`注册失败: ${e.message}`);
    }
    setRegistering(false);
  };

  const columns = [
    { title: '接口 ID', dataIndex: 'interface_id', key: 'interface_id', ellipsis: true, width: 180 },
    { title: '名称', dataIndex: 'interface_name', key: 'name', ellipsis: true },
    {
      title: '域', dataIndex: 'biz_domain', key: 'domain', width: 70,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '分类', dataIndex: 'category_code', key: 'cat', width: 60,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '方向', key: 'flow', width: 60,
      render: (_: any, r: InterfaceRecord) => r.data_flow === 'O' ? <Tag color="green">出站</Tag> : <Tag color="orange">入站</Tag>,
    },
    { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true, width: 300 },
    { title: '函数', dataIndex: 'func_name', key: 'func', ellipsis: true },
  ];

  const dataSource = useMemo(() => {
    if (!searchText.trim()) return data;
    const s = searchText.toLowerCase();
    return data.filter((r) =>
      r.interface_id?.toLowerCase().includes(s)
      || r.interface_name?.toLowerCase().includes(s)
      || r.func_name?.toLowerCase().includes(s));
  }, [data, searchText]);

  const hasApi = useMemo(() => {
    // We could query api_definitions to check, but for now assume "已注册" if interface_id is linked
    return false; // placeholder
  }, [selected]);

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <HideFromViewer>
          <Space>
            <Button type="primary" icon={<PlusOutlined />}
              disabled={!selected} loading={registering}
              onClick={registerApi}>注册 API</Button>
            {selected && (
              <span style={{ color: '#888' }}>
                选中: {selected.interface_name} ({selected.interface_id})
              </span>
            )}
          </Space>
        </HideFromViewer>
        <Input.Search placeholder="搜索接口 ID、名称、函数" allowClear
          onChange={(e) => setSearchText(e.target.value)} style={{ width: 340 }} />
      </Space>

      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="interface_id"
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys),
        }}
        pagination={{ defaultPageSize: 15, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  );
}
