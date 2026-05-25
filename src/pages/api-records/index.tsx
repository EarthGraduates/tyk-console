/**
 * 历史 API 记录页面
 *
 * @description
 * 从 PostgreSQL 读取全部 API 定义（active + inactive），DB 为权威源。
 * 创建仅写 DB（sync_status='pending'），Tyk 推送手动触发。
 * 支持：创建 / 编辑 / 停用 / 删除 / 重新启用 / 手动同步。
 *
 * @module api-records
 * @see ADR-0002: PostgreSQL 作为数据权威源
 * @see CONTEXT.md: 术语定义
 */

import { useList, useCreate, useUpdate } from '@refinedev/core';
import { Table, Form, Input, Switch, Button, Space, Modal, Popconfirm, Tag, Tabs, App, Drawer } from 'antd';
import { PlusOutlined, SyncOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { useState, useMemo, useEffect } from 'react';
import { deactivateApi, reactivateApi, syncApiToTyk, deleteApiWithKeyCleanup } from '../../providers/api-lifecycle';
import { HideFromViewer } from '../../providers/permissions';

// ── 创建 Modal ──
function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { mutate: create } = useCreate({ dataProviderName: 'ichseDb' });
  const { message } = App.useApp();
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  const onFinish = (values: any) => {
    setCreating(true);
    const payload = {
      name: values.name,
      api_id: values.api_id,
      active: true,
      use_keyless: values.use_keyless ?? false,
      proxy: {
        listen_path: values.listen_path,
        target_url: values.target_url,
        strip_listen_path: values.strip_listen_path ?? true,
      },
      org_id: 'default',
      auth: values.use_keyless ? {} : { auth_header_name: values.auth_header_name || 'authorization' },
      CORS: {
        enable: values.cors_enable ?? false,
        allowed_origins: values.allowed_origins
          ? values.allowed_origins.split(',').map((s: string) => s.trim())
          : ['*'],
        allowed_methods: values.allowed_methods
          ? values.allowed_methods.split(',').map((s: string) => s.trim())
          : ['GET', 'POST'],
        allowed_headers: values.allowed_headers
          ? values.allowed_headers.split(',').map((s: string) => s.trim())
          : ['*'],
      },
      enable_jwt: values.enable_jwt ?? false,
      disable_rate_limit: values.disable_rate_limit ?? false,
      cache_options: {
        enable_cache: values.enable_cache ?? false,
        cache_timeout: values.cache_timeout || 60,
      },
    };
    create(
      { resource: 'api-records', values: payload },
      {
        onSuccess: () => {
          message.success('API 已保存到数据库（待同步到 Tyk）');
          setCreating(false);
          onClose();
        },
        onError: (e: any) => {
          message.error(`创建失败: ${e.message}`);
          setCreating(false);
        },
      },
    );
  };

  return (
    <Modal title="创建 API" open={open} onCancel={onClose} width={800} footer={null} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ active: true, use_keyless: false, strip_listen_path: true, cache_timeout: 60 }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                    <Input placeholder="例如：用户服务 API" />
                  </Form.Item>
                  <Form.Item name="api_id" label="API ID" rules={[{ required: true }, { pattern: /^[a-z0-9_-]+$/, message: '仅支持小写字母、数字、下划线和连字符' }]}>
                    <Input placeholder="例如：user-service" />
                  </Form.Item>
                </Space>
              ),
            },
            {
              key: 'route',
              label: '路由配置',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Form.Item name="listen_path" label="监听路径" rules={[{ required: true }, { pattern: /^\/[\w\-/]*\/$/, message: '必须以 / 开头和结尾' }]}>
                    <Input placeholder="/my-api/" />
                  </Form.Item>
                  <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }, { type: 'url' }]}>
                    <Input placeholder="http://upstream" />
                  </Form.Item>
                  <Form.Item name="strip_listen_path" label="剥离路径" valuePropName="checked"><Switch /></Form.Item>
                </Space>
              ),
            },
            {
              key: 'auth',
              label: '认证',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Form.Item name="use_keyless" label="免认证 (Keyless)" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="auth_header_name" label="认证头"><Input placeholder="authorization" /></Form.Item>
                  <Form.Item name="enable_jwt" label="启用 JWT" valuePropName="checked"><Switch /></Form.Item>
                </Space>
              ),
            },
            {
              key: 'cors',
              label: 'CORS',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Form.Item name="cors_enable" label="启用 CORS" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="allowed_origins" label="允许域名"><Input placeholder="*" /></Form.Item>
                  <Form.Item name="allowed_methods" label="允许方法"><Input placeholder="GET, POST" /></Form.Item>
                  <Form.Item name="allowed_headers" label="允许头"><Input placeholder="*" /></Form.Item>
                </Space>
              ),
            },
            {
              key: 'rate',
              label: '速率限制',
              children: (
                <Form.Item name="disable_rate_limit" label="禁用限流" valuePropName="checked"><Switch /></Form.Item>
              ),
            },
            {
              key: 'cache',
              label: '缓存',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Form.Item name="enable_cache" label="启用缓存" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="cache_timeout" label="超时(s)" rules={[{ type: 'number', min: 1, max: 86400 }]}>
                    <Input type="number" placeholder="60" />
                  </Form.Item>
                </Space>
              ),
            },
          ]}
        />
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={creating}>创建 API</Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
}

// ── 编辑 Modal ──
function EditModal({ open, onClose, record }: { open: boolean; onClose: () => void; record: any }) {
  const [form] = Form.useForm();
  const { mutate: update } = useUpdate({ dataProviderName: 'ichseDb' });
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);

  // antd v5 + React 19: initialValues 不可靠，用 useEffect + setFieldsValue 回填
  useEffect(() => {
    if (!open || !record) return;
    const def = typeof record.definition === 'string' ? JSON.parse(record.definition) : record.definition || {};
    form.setFieldsValue({
      name: record.name || '',
      listen_path: def?.proxy?.listen_path || '',
      target_url: def?.proxy?.target_url || '',
      strip_listen_path: def?.proxy?.strip_listen_path ?? true,
      use_keyless: def?.use_keyless ?? false,
      enable_jwt: def?.enable_jwt ?? false,
      cors_enable: def?.CORS?.enable ?? false,
      allowed_origins: (def?.CORS?.allowed_origins || []).join(', '),
      allowed_methods: (def?.CORS?.allowed_methods || []).join(', '),
      allowed_headers: (def?.CORS?.allowed_headers || []).join(', '),
    });
  }, [open, record, form]);

  const onFinish = (values: any) => {
    setSaving(true);
    const def = typeof record?.definition === 'string' ? JSON.parse(record.definition) : record?.definition || {};
    const updatedDef = {
      ...def,
      name: values.name,
      proxy: { ...def.proxy, listen_path: values.listen_path, target_url: values.target_url, strip_listen_path: values.strip_listen_path ?? true },
      use_keyless: values.use_keyless ?? def.use_keyless,
      enable_jwt: values.enable_jwt ?? def.enable_jwt,
      CORS: {
        ...def.CORS,
        enable: values.cors_enable ?? def.CORS?.enable,
        allowed_origins: values.allowed_origins ? values.allowed_origins.split(',').map((s: string) => s.trim()) : def.CORS?.allowed_origins,
        allowed_methods: values.allowed_methods ? values.allowed_methods.split(',').map((s: string) => s.trim()) : def.CORS?.allowed_methods,
        allowed_headers: values.allowed_headers ? values.allowed_headers.split(',').map((s: string) => s.trim()) : def.CORS?.allowed_headers,
      },
    };
    update(
      { resource: 'api-records', id: record.api_id, values: { name: values.name, listen_path: values.listen_path, target_url: values.target_url, definition: updatedDef, sync_status: 'pending' } },
      {
        onSuccess: () => { message.success('已更新（待同步）'); setSaving(false); onClose(); },
        onError: (e: any) => { message.error(`更新失败: ${e.message}`); setSaving(false); },
      },
    );
  };

  return (
    <Modal title={`编辑 — ${record?.name}`} open={open} onCancel={onClose} width={600} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="listen_path" label="监听路径" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
        <Form.Item name="strip_listen_path" label="剥离路径" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="use_keyless" label="免认证" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="enable_jwt" label="JWT" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="cors_enable" label="CORS" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="allowed_origins" label="允许域名"><Input /></Form.Item>
        <Form.Item name="allowed_methods" label="允许方法"><Input /></Form.Item>
        <Form.Item name="allowed_headers" label="允许头"><Input /></Form.Item>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
}

// ── 页面主体 ──
export default function ApiRecords() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const { message } = App.useApp();

  const { result, query, isLoading } = useList({ resource: 'api-records', dataProviderName: 'ichseDb' });

  // ── 停用：Tyk DELETE + DB inactive ──
  const deactivate = async (record: any) => {
    const res = await deactivateApi(record);
    if (res.success) {
      message.success(`「${record.name}」已停用`);
      query.refetch();
    } else {
      message.error(res.error || '停用失败');
    }
  };

  // ── 删除：清理密钥 + Tyk DELETE + DB 永久删除 ──
  const deleteRecord = async (record: any) => {
    const res = await deleteApiWithKeyCleanup(record);
    if (res.success) {
      message.success(`「${record.name}」已删除`);
      query.refetch();
    } else {
      message.error(res.error || '删除失败');
    }
  };

  // ── 重新启用：POST Tyk + DB active ──
  const reactivate = async (record: any) => {
    const res = await reactivateApi(record);
    if (res.success) {
      message.success(`「${record.name}」已重新启用`);
      query.refetch();
    } else {
      message.error(res.error || '启用失败');
    }
  };

  // ── 手动同步：POST/PUT Tyk + markSynced ──
  const syncToTyk = async (record: any) => {
    const res = await syncApiToTyk(record);
    if (res.success) {
      message.success(`「${record.name}」已同步到 Tyk`);
      query.refetch();
    } else {
      message.error(res.error || '同步失败');
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'API ID', dataIndex: 'api_id', key: 'api_id', ellipsis: true },
    { title: '监听路径', dataIndex: 'listen_path', key: 'path' },
    { title: '上游', dataIndex: 'target_url', key: 'target', ellipsis: true },
    {
      title: '认证',
      key: 'auth',
      render: (_: any, r: any) => {
        const def = typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition || {};
        return def.use_keyless ? <Tag>Keyless</Tag> : <Tag color="blue">Token</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => {
        if (v === 'active') return <Tag color="green">启用</Tag>;
        if (v === 'inactive') return <Tag color="default">停用</Tag>;
        return <Tag color="orange">{v}</Tag>;
      },
    },
    {
      title: '同步状态',
      dataIndex: 'sync_status',
      key: 'sync_status',
      render: (v: string, r: any) => {
        if (v === 'synced') return <Tag color="green">已同步</Tag>;
        if (v === 'pending') return <Tag color="gold">待同步</Tag>;
        if (v === 'failed') {
          return (
            <Popconfirm title={r.sync_error || '未知错误'} onConfirm={() => syncToTyk(r)} okText="重试">
              <Tag color="red" style={{ cursor: 'pointer' }}>失败 — 点此重试</Tag>
            </Popconfirm>
          );
        }
        return <Tag>{v || '—'}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" onClick={() => setDetailId(r.api_id)}>详情</Button>
          <HideFromViewer>
            <Button size="small" onClick={() => setEditRecord(r)}>编辑</Button>
            {r.status !== 'inactive' && r.sync_status !== 'synced' && (
              <Button size="small" icon={<SyncOutlined />} onClick={() => syncToTyk(r)}>同步</Button>
            )}
            {r.status === 'inactive' && (
              <Button size="small" icon={<PlayCircleOutlined />} onClick={() => reactivate(r)}>启用</Button>
            )}
            {r.status !== 'inactive' && (
              <Popconfirm title={`确定停用「${r.name}」？可从历史记录中重新启用。`} onConfirm={() => deactivate(r)}>
                <Button size="small" icon={<StopOutlined />}>停用</Button>
              </Popconfirm>
            )}
            <Popconfirm title={`确定删除「${r.name}」？将同时删除关联的密钥，不可恢复。`} onConfirm={() => deleteRecord(r)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </HideFromViewer>
        </Space>
      ),
    },
  ];

  const dataSource = useMemo(() => {
    const raw = result?.data || [];
    if (!searchText.trim()) return raw;
    const s = searchText.toLowerCase();
    return raw.filter((r: any) =>
      (r.name || '').toLowerCase().includes(s)
      || (r.api_id || '').toLowerCase().includes(s)
      || (r.listen_path || '').toLowerCase().includes(s)
      || (r.target_url || '').toLowerCase().includes(s));
  }, [result?.data, searchText]);

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <HideFromViewer>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建 API</Button>
        </HideFromViewer>
        <Input.Search
          placeholder="搜索名称、API ID、路径、上游"
          allowClear
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 360 }}
        />
      </Space>
      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="api_id"
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editRecord && <EditModal open={!!editRecord} onClose={() => setEditRecord(null)} record={editRecord} />}
      <Drawer
        title={`API 详情 — ${detailId}`}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        size="large"
      >
        {detailId && (
          <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: '70vh', fontSize: 13 }}>
            {JSON.stringify(result?.data?.find((r: any) => r.api_id === detailId) || {}, null, 2)}
          </pre>
        )}
      </Drawer>
    </div>
  );
}
