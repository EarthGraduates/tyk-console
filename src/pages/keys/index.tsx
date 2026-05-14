import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";
import { Table, Form, Input, Select, InputNumber, Button, Space, Tag, Popconfirm, Modal, DatePicker, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";

function statusTag(r: any) {
  const expiry = r.expires ? new Date(r.expires * 1000) : null;
  if (expiry && expiry < new Date()) return <Tag color="red">已过期</Tag>;
  if (expiry && expiry.getTime() - Date.now() < 86400000) return <Tag color="orange">即将过期</Tag>;
  return <Tag color="green">有效</Tag>;
}

export default function KeyList() {
  const { data, isLoading } = useList({ resource: "keys", dataProviderName: "tyk" });
  const { mutate: createKey } = useCreate({ dataProviderName: "tyk" });
  const { mutate: updateKey } = useUpdate({ dataProviderName: "tyk" });
  const { mutate: deleteKey } = useDelete({ dataProviderName: "tyk" });

  const columns = [
    { title: "Key ID", dataIndex: "key_id", key: "key_id", ellipsis: true, width: 200 },
    {
      title: "状态",
      key: "status",
      render: (_: any, r: any) => statusTag(r),
    },
    { title: "配额", dataIndex: "quota_max", key: "quota", render: (v: number) => v || "∞" },
    { title: "速率", dataIndex: "rate", key: "rate", render: (v: number) => v || "∞" },
    {
      title: "有效期",
      dataIndex: "expires",
      key: "expires",
      render: (v: number) => v ? new Date(v * 1000).toLocaleDateString() : "永久",
    },
    {
      title: "操作",
      key: "actions",
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => {
            Modal.info({
              title: "编辑密钥",
              content: (
                <Form layout="vertical" style={{ marginTop: 16 }} onFinish={(v: any) => {
                  const payload: any = {
                    rate: v.rate,
                    per: v.per,
                    quota_max: v.quota_max,
                  };
                  if (v.expires_at) payload.expires = Math.floor(v.expires_at.valueOf() / 1000);
                  updateKey({ resource: "keys", id: r.key_id, values: payload }, {
                    onSuccess: () => { message.success("更新成功"); Modal.destroyAll(); },
                    onError: (e: any) => message.error("更新失败: " + e.message),
                  });
                }}>
                  <Form.Item label="速率 (per)" name="rate"><InputNumber min={0} /></Form.Item>
                  <Form.Item label="时间窗口 (s)" name="per"><InputNumber min={1} /></Form.Item>
                  <Form.Item label="最大配额" name="quota_max"><InputNumber min={0} /></Form.Item>
                  <Form.Item label="过期时间" name="expires_at"><DatePicker showTime /></Form.Item>
                  <Button type="primary" htmlType="submit">保存</Button>
                </Form>
              ),
              width: 500,
            });
          }}>编辑</Button>
          <Popconfirm title="确定吊销此密钥？" onConfirm={() => {
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          Modal.info({
            title: "创建密钥",
            content: (
              <Form layout="vertical" style={{ marginTop: 16 }} onFinish={(v: any) => {
                const payload: any = {};
                if (v.rate) payload.rate = v.rate;
                if (v.per) payload.per = v.per;
                if (v.quota_max) payload.quota_max = v.quota_max;
                if (v.expires_at) payload.expires = Math.floor(v.expires_at.valueOf() / 1000);
                createKey({ resource: "keys", values: payload }, {
                  onSuccess: () => { message.success("密钥创建成功"); Modal.destroyAll(); },
                  onError: (e: any) => message.error("创建失败: " + e.message),
                });
              }}>
                <Form.Item label="速率 (请求数)" name="rate"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="时间窗口 (s)" name="per"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="最大配额" name="quota_max"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="过期时间" name="expires_at"><DatePicker showTime style={{ width: "100%" }} /></Form.Item>
                <Button type="primary" htmlType="submit">创建</Button>
              </Form>
            ),
            width: 500,
          });
        }}>创建密钥</Button>
      </Space>
      <Table dataSource={data?.data || []} columns={columns} rowKey="key_id" loading={isLoading} size="small" />
    </div>
  );
}
