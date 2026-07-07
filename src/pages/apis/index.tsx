/**
 * API 定义页面
 *
 * PG api_definitions 为权威源，Tyk 状态为辅助。
 * 遵循 conventions.md §十二: 操作按钮在工具栏，行选择操作。
 */
import { useList, useCreate, useUpdate } from '@refinedev/core';
import { Table, Form, Input, Switch, Button, Space, Modal, Popconfirm, Tag, Tabs, App } from 'antd';
import { PlusOutlined, SyncOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { HideFromViewer } from '../../providers/permissions';

// ── helpers ──
async function callAdmin(path: string, method = 'POST', body?: any) {
  const resp = await fetch(`${window.location.origin}/admin${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

// ── Create Modal ──
function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { mutate: create } = useCreate({ dataProviderName: 'ichseDb' });
  const { message } = App.useApp();
  const [creating, setCreating] = useState(false);

  const onFinish = (values: any) => {
    setCreating(true);
    const payload = {
      name: values.name, api_id: values.api_id,
      listen_path: values.listen_path, target_url: values.target_url,
      auth_mode: values.use_keyless ? 'keyless' : 'standard',
      status: 'active', sync_status: 'pending',
      definition: {
        name: values.name, api_id: values.api_id,
        active: true, use_keyless: values.use_keyless ?? false,
        proxy: { listen_path: values.listen_path, target_url: values.target_url,
                 strip_listen_path: values.strip_listen_path ?? true },
        version_data: { not_versioned: true, versions: { Default: { name: 'Default', use_extended_paths: true } } },
      },
    };
    create({ resource: 'api-records', values: payload }, {
      onSuccess: () => { message.success('API 已保存'); setCreating(false); onClose(); },
      onError: (e: any) => { message.error(`创建失败: ${e.message}`); setCreating(false); },
    });
  };

  return (
    <Modal title="创建 API" open={open} onCancel={onClose} width={700} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={onFinish}
        initialValues={{ strip_listen_path: true }}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如：检验样本类型下载" /></Form.Item>
          <Form.Item name="api_id" label="API ID" rules={[{ required: true, pattern: /^[a-z0-9_-]+$/, message: '仅支持小写字母、数字、下划线和连字符' }]}><Input placeholder="例如：ichse-lab-demo-md-i001" /></Form.Item>
          <Form.Item name="listen_path" label="监听路径" rules={[{ required: true, pattern: /^\/[\w\-/]*\/$/, message: '必须以 / 开头和结尾' }]}><Input placeholder="/api/..." /></Form.Item>
          <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }]}><Input placeholder="http://services:8000" /></Form.Item>
          <Form.Item name="strip_listen_path" label="剥离路径" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="use_keyless" label="免认证 (Keyless)" valuePropName="checked"><Switch /></Form.Item>
        </Space>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit" loading={creating}>创建 API</Button></Space>
        </div>
      </Form>
    </Modal>
  );
}

// ── Edit Modal ──
function EditModal({ open, onClose, record }: { open: boolean; onClose: () => void; record: any }) {
  const [form] = Form.useForm();
  const { mutate: update } = useUpdate({ dataProviderName: 'ichseDb' });
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    form.setFieldsValue({
      name: record.name || '', api_id: record.api_id || '',
      listen_path: record.listen_path || '', target_url: record.target_url || '',
      use_keyless: record.auth_mode === 'keyless',
    });
  }, [open, record, form]);

  const onFinish = (values: any) => {
    setSaving(true);
    update({ resource: 'api-records', id: record.api_id, values: {
      name: values.name, listen_path: values.listen_path, target_url: values.target_url,
      auth_mode: values.use_keyless ? 'keyless' : 'standard', sync_status: 'pending',
    }}, {
      onSuccess: () => { message.success('已更新'); setSaving(false); onClose(); },
      onError: (e: any) => { message.error(`更新失败: ${e.message}`); setSaving(false); },
    });
  };

  return (
    <Modal title={`编辑 — ${record?.name}`} open={open} onCancel={onClose} width={500} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="listen_path" label="监听路径" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="use_keyless" label="免认证" valuePropName="checked"><Switch /></Form.Item>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>保存</Button></Space>
        </div>
      </Form>
    </Modal>
  );
}

// ── Page ──
export default function ApiList() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [searchText, setSearchText] = useState('');
  const [tykStatuses, setTykStatuses] = useState<Record<string, string>>({});
  const { message } = App.useApp();

  const { result, query } = useList({ resource: 'api-records', dataProviderName: 'ichseDb' });
  const isLoading = query.isLoading;
  const refetch = () => query.refetch();

  // Fetch Tyk status for all APIs
  const fetchTykStatus = useCallback(async () => {
    try {
      const resp = await fetch(`http://localhost:8080/tyk/apis/`, {
        headers: { 'x-tyk-authorization': 'foo' },
      });
      const tykApis: any[] = await resp.json();
      const map: Record<string, string> = {};
      tykApis.forEach((a: any) => { map[a.api_id] = 'running'; });
      setTykStatuses(map);
    } catch { /* Tyk unreachable — ignore */ }
  }, []);

  useEffect(() => { fetchTykStatus(); }, [fetchTykStatus]);

  const selectedRecord = useMemo(() => {
    const data = result?.data || [];
    return data.find((r: any) => r.api_id === selectedKeys[0]);
  }, [result?.data, selectedKeys]);

  // ── Actions ──
  const syncToTyk = async (apiId: string) => {
    try {
      await callAdmin(`/sync-to-tyk/${apiId}`);
      message.success('同步成功');
      refetch(); fetchTykStatus();
    } catch (e: any) { message.error(`同步失败: ${e.message}`); }
  };

  const deactivate = async (apiId: string) => {
    try {
      await callAdmin(`/sync-to-tyk/${apiId}`, 'DELETE');
      await fetch(`http://localhost:3001/api-records?api_id=eq.${apiId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'inactive', sync_status: 'synced' }),
      });
      message.success('已停用');
      refetch(); fetchTykStatus();
    } catch (e: any) { message.error(`停用失败: ${e.message}`); }
  };

  const reactivate = async (apiId: string) => {
    try {
      const resp = await fetch(`http://localhost:3001/api-records?api_id=eq.${apiId}`, { headers: { Accept: 'application/json' } });
      const rows = await resp.json();
      if (!rows.length) throw new Error('API not found');
      const def = rows[0].definition;
      await callAdmin(`/sync-to-tyk/${apiId}`);
      await fetch(`http://localhost:3001/api-records?api_id=eq.${apiId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'active', sync_status: 'synced' }),
      });
      message.success('已重新启用');
      refetch(); fetchTykStatus();
    } catch (e: any) { message.error(`启用失败: ${e.message}`); }
  };

  const deleteRecord = async (apiId: string) => {
    try {
      await callAdmin(`/sync-to-tyk/${apiId}`, 'DELETE');
      await fetch(`http://localhost:3001/api-records?api_id=eq.${apiId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'archived', sync_status: 'synced' }),
      });
      message.success('已删除');
      refetch(); fetchTykStatus();
    } catch (e: any) { message.error(`删除失败: ${e.message}`); }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'API ID', dataIndex: 'api_id', key: 'api_id', ellipsis: true },
    { title: '监听路径', dataIndex: 'listen_path', key: 'path', ellipsis: true },
    { title: '上游', dataIndex: 'target_url', key: 'target', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => v === 'active' ? <Tag color="green">启用</Tag> : v === 'inactive' ? <Tag color="default">停用</Tag> : <Tag color="orange">{v}</Tag>,
    },
    {
      title: 'Tyk', key: 'tyk', width: 80,
      render: (_: any, r: any) => tykStatuses[r.api_id] ? <Tag color="cyan">运行中</Tag> : <Tag color="default">未同步</Tag>,
    },
    {
      title: '同步', dataIndex: 'sync_status', key: 'sync', width: 80,
      render: (v: string) => v === 'synced' ? <Tag color="green">已同步</Tag> : v === 'pending' ? <Tag color="gold">待同步</Tag> : v === 'failed' ? <Tag color="red">失败</Tag> : <Tag>{v}</Tag>,
    },
  ];

  const dataSource = useMemo(() => {
    const raw = result?.data || [];
    if (!searchText.trim()) return raw;
    const s = searchText.toLowerCase();
    return raw.filter((r: any) =>
      (r.name || '').toLowerCase().includes(s) || (r.api_id || '').toLowerCase().includes(s));
  }, [result?.data, searchText]);

  return (
    <div style={{ padding: 24 }}>
      {/* Toolbar */}
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <HideFromViewer>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
            <Button disabled={!selectedRecord} onClick={() => { setEditRecord(selectedRecord); setEditOpen(true); }}>编辑</Button>
            <Button icon={<SyncOutlined />} disabled={!selectedRecord} onClick={() => syncToTyk(selectedRecord?.api_id)}>同步到 Tyk</Button>
            <Button icon={<PlayCircleOutlined />} disabled={!selectedRecord || selectedRecord?.status === 'active'}
              onClick={() => reactivate(selectedRecord?.api_id)}>启用</Button>
            <Button icon={<StopOutlined />} disabled={!selectedRecord || selectedRecord?.status !== 'active'}
              onClick={() => deactivate(selectedRecord?.api_id)}>停用</Button>
            <Popconfirm title={`确定删除「${selectedRecord?.name}」？不可恢复。`}
              onConfirm={() => deleteRecord(selectedRecord?.api_id)} disabled={!selectedRecord}>
              <Button danger disabled={!selectedRecord}>删除</Button>
            </Popconfirm>
          </Space>
        </HideFromViewer>
        <Input.Search placeholder="搜索名称、API ID" allowClear onChange={(e) => setSearchText(e.target.value)} style={{ width: 300 }} />
      </Space>

      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="api_id"
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys),
        }}
        pagination={{ defaultPageSize: 15, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditModal open={editOpen} onClose={() => setEditOpen(false)} record={editRecord} />
    </div>
  );
}
