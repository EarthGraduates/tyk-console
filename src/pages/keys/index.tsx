/**
 * 密钥管理页面
 *
 * @description
 * Tyk API Token 的全生命周期管理界面。
 * - 创建密钥弹窗：选择授权 API + 速率/配额/过期时间配置，成功后展示密钥值（一次性查看）
 * - 编辑密钥：预填已有数据，修改速率/配额/过期
 * - 吊销密钥：确认弹窗后删除
 * - 列表展示：Key ID / 授权 API / 状态标签 / 配额 / 速率 / 有效期
 *
 * ## 设计约束
 * - Tyk 创建密钥必须指定 access_rights（授权 API），已有 API 下拉选择器
 * - 密钥值仅在创建成功时展示一次，关闭后 Tyk 不再返回原始值
 * - 列表数据需逐条查询详情（Tyk 列表接口不返回元数据）
 *
 * @module pages/keys
 */

import { useList, useCreate, useUpdate, useDelete } from '@refinedev/core';
import { Table, Form, Input, InputNumber, Button, Space, Tag, Popconfirm, Modal, DatePicker, Select, App, Typography, Alert } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { HideFromViewer } from '../../providers/permissions';

const { Text } = Typography;

function statusTag(r: any) {
  const expiry = r.expires ? new Date(r.expires * 1000) : null;
  if (expiry && expiry < new Date()) return <Tag color="red">已过期</Tag>;
  if (expiry && expiry.getTime() - Date.now() < 86400000) return <Tag color="orange">即将过期</Tag>;
  return <Tag color="green">有效</Tag>;
}

// ── Create/Edit Key Modal ──
function KeyModal({ open, onClose, editKey }: {
  open: boolean;
  onClose: () => void;
  editKey?: any;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const { mutate: createKey } = useCreate({ resource: 'keys', dataProviderName: 'tyk' });
  const { mutate: updateKey } = useUpdate({ resource: 'keys', dataProviderName: 'tyk' });
  const { result: apiResult } = useList({ resource: 'apis', dataProviderName: 'tyk' });
  const [submitting, setSubmitting] = useState(false);
  const [createdKey, setCreatedKey] = useState<any>(null);

  const apiOptions = (apiResult?.data || []).map((api: any) => ({
    label: `${api.name} (${api.api_id})`,
    value: api.api_id,
  }));

  const onFinish = (values: any) => {
    setSubmitting(true);
    const payload: any = {};
    if (values.rate != null) payload.rate = values.rate;
    if (values.per != null) payload.per = values.per;
    if (values.quota_max != null) payload.quota_max = values.quota_max;
    if (values.expires_at) payload.expires = Math.floor(values.expires_at.valueOf() / 1000);

    if (values.api_id) {
      // 编辑模式：API 没变则保留原有 access_rights（含 api_name 等元数据）
      if (editKey?.access_rights?.[values.api_id]) {
        payload.access_rights = { [values.api_id]: editKey.access_rights[values.api_id] };
      } else {
        const targetApi = (apiResult?.data || []).find((a: any) => a.api_id === values.api_id);
        payload.access_rights = {
          [values.api_id]: {
            api_id: values.api_id,
            api_name: targetApi?.name || values.api_id,
            versions: ['Default'],
          },
        };
      }
    }

    if (editKey) {
      updateKey({ resource: 'keys', id: editKey.key_id, values: payload }, {
        onSuccess: () => { message.success('更新成功'); setSubmitting(false); onClose(); },
        onError: (e: any) => { message.error(`更新失败: ${e.message}`); setSubmitting(false); },
      });
    } else {
      createKey({ resource: 'keys', values: payload }, {
        onSuccess: (data: any) => {
          setSubmitting(false);
          setCreatedKey(data.data);
          message.success('密钥创建成功');
        },
        onError: (e: any) => { message.error(`创建失败: ${e.message}`); setSubmitting(false); },
      });
    }
  };

  const handleClose = () => {
    setCreatedKey(null);
    onClose();
  };

  // 编辑模式下回填表单字段（绕过 antd v5 + React 19 的 initialValues 兼容问题）
  useEffect(() => {
    if (open && editKey) {
      form.setFieldsValue({
        api_id: editKey.access_rights
          ? Object.keys(editKey.access_rights)[0]
          : undefined,
        rate: editKey.rate,
        per: editKey.per,
        quota_max: editKey.quota_max,
        expires_at: editKey.expires > 0
          ? dayjs(editKey.expires * 1000)
          : undefined,
      });
    } else if (open && !editKey) {
      form.resetFields();
    }
  }, [open, editKey, form]);

  return (
    <Modal
      title={(() => {
        if (createdKey) return '密钥创建成功';
        if (editKey) return '编辑密钥';
        return '创建密钥';
      })()}
      open={open}
      onCancel={handleClose}
      width={480}
      footer={null}
      destroyOnClose
    >
      {createdKey ? (
        <div>
          <Alert type="success" showIcon message="密钥已创建" description="请立即复制保存，关闭后将无法再查看密钥值" style={{ marginBottom: 16 }} />
          <Form layout="vertical">
            <Form.Item label="Key ID">
              <InputNumber value={createdKey.key_id} disabled style={{ width: '100%' }} />
              <Text copyable code style={{ display: 'block', marginTop: 8 }}>{createdKey.key_id}</Text>
            </Form.Item>
            {createdKey.key && (
              <Form.Item label="密钥值 (Key)" help="使用此值作为 API 请求的 Authorization 头">
                <Text copyable code style={{ display: 'block', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>{createdKey.key}</Text>
              </Form.Item>
            )}
            {createdKey.api_id && (
              <Form.Item label="授权 API"><Text>{createdKey.api_id}</Text></Form.Item>
            )}
            {createdKey.rate != null && <Form.Item label="速率"><Text>{createdKey.rate}/{createdKey.per}s</Text></Form.Item>}
          </Form>
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button type="primary" onClick={handleClose}>关闭</Button>
          </div>
        </div>
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            api_id: editKey?.access_rights
              ? Object.keys(editKey.access_rights)[0]
              : undefined,
            rate: editKey?.rate,
            per: editKey?.per,
            quota_max: editKey?.quota_max,
            expires_at: editKey?.expires > 0
              ? dayjs(editKey.expires * 1000)
              : undefined,
          }}
        >
          <Form.Item
            label="授权 API"
            name="api_id"
            rules={[{ required: true, message: '请选择授权的 API' }]}
            help="该密钥可以访问哪个 API，必选"
          >
            <Select
              placeholder="选择一个 API"
              options={apiOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="速率 (请求数)" name="rate" help="每秒允许的请求数，留空或 0 表示不限制" rules={[{ type: 'number', min: 0, message: '不能小于 0' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="时间窗口 (s)" name="per" help="速率计算的时间窗口（秒），默认 1 秒" rules={[{ type: 'number', min: 1, message: '至少 1 秒' }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="最大配额" name="quota_max" help="密钥生命周期内允许的总请求数，-1 表示无限制" rules={[{ type: 'number', min: -1, message: '不能小于 -1' }]}><InputNumber min={-1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="过期时间" name="expires_at" help="密钥将在该时间后自动失效，留空表示永不过期"><DatePicker showTime style={{ width: '100%' }} placeholder="留空表示永不过期" /></Form.Item>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editKey ? '保存修改' : '创建密钥'}
              </Button>
            </Space>
          </div>
        </Form>
      )}
    </Modal>
  );
}

// ── List ──
export default function KeyList() {
  const { result, isLoading } = useList({ resource: 'keys', dataProviderName: 'tyk' });
  const { mutate: deleteKey } = useDelete({ resource: 'keys', dataProviderName: 'tyk' });
  const { message } = App.useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [editKey, setEditKey] = useState<any>(null);
  const [searchText, setSearchText] = useState('');

  const openCreate = () => { setEditKey(null); setModalOpen(true); };
  const openEdit = (key: any) => { setEditKey(key); setModalOpen(true); };

  const columns = [
    { title: 'Key ID', dataIndex: 'key_id', key: 'key_id', ellipsis: true, width: 200 },
    {
      title: '授权 API',
      key: 'apis',
      render: (_: any, r: any) => {
        const rights = r.access_rights;
        if (!rights) return <Tag>未知</Tag>;
        return Object.values(rights).map((a: any) => (
          <Tag key={a.api_id} color="blue">{a.api_name || a.api_id}</Tag>
        ));
      },
    },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r) },
    { title: '配额', dataIndex: 'quota_max', key: 'quota', render: (v: number) => v || '∞' },
    { title: '速率', dataIndex: 'rate', key: 'rate', render: (v: number) => v || '∞' },
    { title: '有效期', dataIndex: 'expires', key: 'expires', render: (v: number) => (v ? new Date(v * 1000).toLocaleDateString() : '永久') },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: any) => (
        <HideFromViewer>
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm
              title="确定删除此密钥？"
              placement="left"
              onConfirm={() => {
                deleteKey({ resource: 'keys', id: r.key_id }, {
                  onSuccess: () => message.success('已删除'),
                  onError: (e: any) => message.error(`删除失败: ${e.message}`),
                });
              }}
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        </HideFromViewer>
      ),
    },
  ];

  const dataSource = useMemo(() => {
    const raw = result?.data || [];
    if (!searchText.trim()) return raw;
    const s = searchText.toLowerCase();
    return raw.filter((r: any) => {
      const keyId = (r.key_id || '').toLowerCase();
      const apiName = Object.values(r.access_rights || {}).map((a: any) =>
        (a.api_name || a.api_id || '').toLowerCase()).join(' ');
      return keyId.includes(s) || apiName.includes(s);
    });
  }, [result?.data, searchText]);

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <HideFromViewer>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建密钥</Button>
        </HideFromViewer>
        <Input.Search
          placeholder="搜索 Key ID、授权 API"
          allowClear
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 360 }}
        />
      </Space>
      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="key_id"
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

      <KeyModal open={modalOpen} onClose={() => setModalOpen(false)} editKey={editKey} />
    </div>
  );
}
