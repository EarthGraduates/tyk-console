import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";
import { Table, Form, InputNumber, Button, Space, Tag, Popconfirm, Modal, DatePicker, Select, App, Typography, Alert } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

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
  const { mutate: createKey } = useCreate({ resource: "keys", dataProviderName: "tyk" });
  const { mutate: updateKey } = useUpdate({ resource: "keys", dataProviderName: "tyk" });
  const { result: apiResult } = useList({ resource: "apis", dataProviderName: "tyk" });
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
      const targetApi = (apiResult?.data || []).find((a: any) => a.api_id === values.api_id);
      payload.access_rights = {
        [values.api_id]: {
          api_id: values.api_id,
          api_name: targetApi?.name || values.api_id,
          versions: ["Default"],
        },
      };
    }

    if (editKey) {
      updateKey({ resource: "keys", id: editKey.key_id, values: payload }, {
        onSuccess: () => { message.success("更新成功"); setSubmitting(false); onClose(); },
        onError: (e: any) => { message.error("更新失败: " + e.message); setSubmitting(false); },
      });
    } else {
      createKey({ resource: "keys", values: payload }, {
        onSuccess: (data: any) => {
          setSubmitting(false);
          setCreatedKey(data.data);
          message.success("密钥创建成功");
        },
        onError: (e: any) => { message.error("创建失败: " + e.message); setSubmitting(false); },
      });
    }
  };

  const handleClose = () => {
    setCreatedKey(null);
    onClose();
  };

  return (
    <Modal
      title={createdKey ? "密钥创建成功" : (editKey ? "编辑密钥" : "创建密钥")}
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
              <InputNumber value={createdKey.key_id} disabled style={{ width: "100%" }} />
              <Text copyable code style={{ display: "block", marginTop: 4 }}>{createdKey.key_id}</Text>
            </Form.Item>
            {createdKey.key && (
              <Form.Item label="密钥值 (Key)" help="使用此值作为 API 请求的 Authorization 头">
                <Text copyable code style={{ display: "block", padding: 8, background: "#f5f5f5", borderRadius: 4 }}>{createdKey.key}</Text>
              </Form.Item>
            )}
            {createdKey.api_id && (
              <Form.Item label="授权 API"><Text>{createdKey.api_id}</Text></Form.Item>
            )}
            {createdKey.rate != null && <Form.Item label="速率"><Text>{createdKey.rate}/{createdKey.per}s</Text></Form.Item>}
          </Form>
          <div style={{ textAlign: "right", marginTop: 16 }}>
            <Button type="primary" onClick={handleClose}>关闭</Button>
          </div>
        </div>
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            rate: editKey?.rate,
            per: editKey?.per,
            quota_max: editKey?.quota_max,
            expires_at: editKey?.expires ? new Date(editKey.expires * 1000) : undefined,
          }}
        >
          <Form.Item label="授权 API" name="api_id" rules={[{ required: true, message: "请选择授权的 API" }]}
            help="该密钥可以访问哪个 API，必选">
            <Select
              placeholder="选择一个 API"
              options={apiOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="速率 (请求数)" name="rate" help="每秒允许的请求数，留空或 0 表示不限制"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="时间窗口 (s)" name="per" help="速率计算的时间窗口（秒），默认 1 秒"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="最大配额" name="quota_max" help="密钥生命周期内允许的总请求数，-1 表示无限制"><InputNumber min={-1} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="过期时间" name="expires_at" help="密钥将在该时间后自动失效，留空表示永不过期"><DatePicker showTime style={{ width: "100%" }} /></Form.Item>
          <div style={{ textAlign: "right" }}>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editKey ? "保存修改" : "创建密钥"}
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
  const { result, isLoading } = useList({ resource: "keys", dataProviderName: "tyk" });
  const { mutate: deleteKey } = useDelete({ resource: "keys", dataProviderName: "tyk" });
  const { message } = App.useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [editKey, setEditKey] = useState<any>(null);

  const openCreate = () => { setEditKey(null); setModalOpen(true); };
  const openEdit = (key: any) => { setEditKey(key); setModalOpen(true); };

  const columns = [
    { title: "Key ID", dataIndex: "key_id", key: "key_id", ellipsis: true, width: 200 },
    {
      title: "授权 API",
      key: "apis",
      render: (_: any, r: any) => {
        const rights = r.access_rights;
        if (!rights) return <Tag>未知</Tag>;
        return Object.values(rights).map((a: any) => (
          <Tag key={a.api_id} color="blue">{a.api_name || a.api_id}</Tag>
        ));
      },
    },
    { title: "状态", key: "status", render: (_: any, r: any) => statusTag(r) },
    { title: "配额", dataIndex: "quota_max", key: "quota", render: (v: number) => v || "∞" },
    { title: "速率", dataIndex: "rate", key: "rate", render: (v: number) => v || "∞" },
    { title: "有效期", dataIndex: "expires", key: "expires", render: (v: number) => v ? new Date(v * 1000).toLocaleDateString() : "永久" },
    {
      title: "操作",
      key: "actions",
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定吊销此密钥？" placement="left" onConfirm={() => {
            deleteKey({ resource: "keys", id: r.key_id }, {
              onSuccess: () => message.success("已吊销"),
              onError: (e: any) => message.error("吊销失败: " + e.message),
            });
          }}>
            <Button size="small" danger>吊销</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建密钥</Button>
      </Space>
      <Table dataSource={result?.data || []} columns={columns} rowKey="key_id" loading={isLoading} size="small" />

      <KeyModal open={modalOpen} onClose={() => setModalOpen(false)} editKey={editKey} />
    </div>
  );
}
