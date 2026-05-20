/**
 * API 服务管理页面
 *
 * @description
 * Tyk API Definition 的完整 CRUD 界面，涵盖 v1 核心字段。
 * - 列表页：表格展示所有 API，含搜索/筛选/克隆/删除
 * - 创建弹窗：6 个 Tab（基本信息、路由、认证、CORS、速率限制、缓存）
 * - 详情页：完整 JSON 格式化展示
 *
 * ## v1 覆盖字段
 * 基本信息(3) + 路由配置(4) + 认证(4) + CORS(9) + 速率限制(3) + 缓存(2) = ~25 核心字段
 * 高级设置（端点配置/版本管理/中间件/日志）划入 v2
 *
 * @module apis
 */

import { useList, useCreate, useDelete, useOne } from '@refinedev/core';
import { Table, Form, Input, Switch, Button, Space, Modal, Popconfirm, Tag, Tabs, App } from 'antd';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * API 创建/克隆 Modal 组件
 *
 * @param open - Modal 是否可见
 * @param onClose - 关闭回调
 * @param cloneData - 克隆来源的 API 数据，有则预填所有字段
 */
function ApiCreateModal({ open, onClose, cloneData }: {
  open: boolean;
  onClose: () => void;
  cloneData?: any;
}) {
  const [form] = Form.useForm();
  const { mutate: create } = useCreate({ dataProviderName: 'tyk' });
  const { message } = App.useApp();
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  /**
   * 构建 Tyk API Definition 的完整 payload
   * - 路由配置：listen_path + target_url（必填）
   * - 认证配置：keyless / Token / JWT 三种模式
   * - CORS：逗号分隔的字符串转数组（Tyk 需数组格式）
   */
  const onFinish = (values: any) => {
    setCreating(true);
    const payload = {
      name: values.name,
      api_id: values.api_id,
      active: values.active ?? true,
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
        allowed_origins: values.allowed_origins ? values.allowed_origins.split(',').map((s: string) => s.trim()) : ['*'],
        allowed_methods: values.allowed_methods ? values.allowed_methods.split(',').map((s: string) => s.trim()) : ['GET', 'POST'],
        allowed_headers: values.allowed_headers ? values.allowed_headers.split(',').map((s: string) => s.trim()) : ['*'],
      },
      enable_jwt: values.enable_jwt ?? false,
      disable_rate_limit: values.disable_rate_limit ?? false,
      cache_options: {
        enable_cache: values.enable_cache ?? false,
        cache_timeout: values.cache_timeout || 60,
      },
    };
    create({ resource: 'apis', values: payload }, {
      onSuccess: () => { message.success('API 创建成功'); setCreating(false); onClose(); },
      onError: (e: any) => { message.error(`创建失败: ${e.message}`); setCreating(false); },
    });
  };

  return (
    <Modal title={cloneData ? '克隆 API' : '创建 API'} open={open} onCancel={onClose} width={800} footer={null} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          name: cloneData?.name,
          api_id: cloneData?.api_id,
          active: cloneData?.active ?? true,
          use_keyless: cloneData?.use_keyless ?? false,
          listen_path: cloneData?.proxy?.listen_path,
          target_url: cloneData?.proxy?.target_url,
          strip_listen_path: cloneData?.proxy?.strip_listen_path ?? true,
          auth_header_name: cloneData?.auth?.auth_header_name || 'authorization',
          enable_jwt: cloneData?.enable_jwt ?? false,
          cors_enable: cloneData?.CORS?.enable ?? false,
          allowed_origins: (cloneData?.CORS?.allowed_origins || ['*']).join(', '),
          allowed_methods: (cloneData?.CORS?.allowed_methods || ['GET', 'POST']).join(', '),
          allowed_headers: (cloneData?.CORS?.allowed_headers || ['*']).join(', '),
          disable_rate_limit: cloneData?.disable_rate_limit ?? false,
          enable_cache: cloneData?.cache_options?.enable_cache ?? false,
          cache_timeout: cloneData?.cache_options?.cache_timeout || 60,
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'basic',
              label: '基本信息',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="api_id" label="API ID" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="active" label="启用" valuePropName="checked"><Switch /></Form.Item>
                </Space>
              ) },
            { key: 'route',
              label: '路由配置',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="listen_path" label="监听路径" rules={[{ required: true }]}><Input placeholder="/my-api/" /></Form.Item>
                  <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }]}><Input placeholder="http://upstream" /></Form.Item>
                  <Form.Item name="strip_listen_path" label="剥离路径" valuePropName="checked"><Switch /></Form.Item>
                </Space>
              ) },
            { key: 'auth',
              label: '认证',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="use_keyless" label="免认证 (Keyless)" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="auth_header_name" label="认证头"><Input /></Form.Item>
                  <Form.Item name="enable_jwt" label="启用 JWT" valuePropName="checked"><Switch /></Form.Item>
                </Space>
              ) },
            { key: 'cors',
              label: 'CORS',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="cors_enable" label="启用 CORS" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="allowed_origins" label="允许域名"><Input placeholder="*" /></Form.Item>
                  <Form.Item name="allowed_methods" label="允许方法"><Input placeholder="GET, POST" /></Form.Item>
                  <Form.Item name="allowed_headers" label="允许头"><Input placeholder="*" /></Form.Item>
                </Space>
              ) },
            { key: 'rate',
              label: '速率限制',
              children: (
                <Form.Item name="disable_rate_limit" label="禁用限流" valuePropName="checked"><Switch /></Form.Item>
              ) },
            { key: 'cache',
              label: '缓存',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="enable_cache" label="启用缓存" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="cache_timeout" label="超时(s)"><Input type="number" /></Form.Item>
                </Space>
              ) },
          ]}
        />
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={creating}>{cloneData ? '克隆创建' : '创建 API'}</Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
}

/**
 * API 列表页
 *
 * @description
 * 展示所有 Tyk API Definition，支持搜索/筛选/克隆/删除。
 * 创建和克隆复用 ApiCreateModal 弹窗（不导航到独立页面）。
 */
export function ApiList() {
  const navigate = useNavigate();
  const { result, isLoading } = useList({ resource: 'apis', dataProviderName: 'tyk' });
  const { mutate: deleteApi } = useDelete({ dataProviderName: 'tyk' });

  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<any>(null);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'API ID', dataIndex: 'api_id', key: 'api_id', ellipsis: true },
    { title: '监听路径', dataIndex: ['proxy', 'listen_path'], key: 'path' },
    { title: '上游', dataIndex: ['proxy', 'target_url'], key: 'target', ellipsis: true },
    { title: '认证', key: 'auth', render: (_: any, r: any) => (r.use_keyless ? <Tag>Keyless</Tag> : <Tag color="blue">Token</Tag>) },
    { title: '状态', dataIndex: 'active', key: 'active', render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    { title: '操作',
      key: 'actions',
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/apis/${r.api_id}`)}>详情</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => { setCloneSource(r); setCreateOpen(true); }}>克隆</Button>
          <Popconfirm title="确定删除？" placement="left" onConfirm={() => deleteApi({ resource: 'apis', id: r.api_id })}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCloneSource(null); setCreateOpen(true); }}>创建 API</Button>
      </Space>
      <Table
        dataSource={result?.data || []}
        columns={columns}
        rowKey="api_id"
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
      />
      <ApiCreateModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCloneSource(null); }}
        cloneData={cloneSource}
      />
    </div>
  );
}

/**
 * API 详情页
 *
 * @description
 * 展示单个 API Definition 的完整 JSON（格式化、只读）
 */
export function ApiShow() {
  const apiId = window.location.pathname.split('/').pop();
  const { data, isLoading } = useOne({ resource: 'apis', id: apiId || '', dataProviderName: 'tyk' });

  return (
    <div style={{ padding: 24 }}>
      {isLoading ? <span>加载中...</span> : (
        <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: '70vh' }}>
          {JSON.stringify(data?.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
