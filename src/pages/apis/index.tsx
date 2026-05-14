import { List, Create, Edit, Show } from "@refinedev/antd";
import { useList, useCreate, useUpdate, useDelete, useOne, useShow } from "@refinedev/core";
import { Table, Form, Input, Switch, Select, Tabs, Button, Space, Modal, Popconfirm, Tag, message } from "antd";
import { PlusOutlined, CopyOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";

// ── List ──
export function ApiList() {
  const navigate = useNavigate();
  const { data, isLoading } = useList({ resource: "apis", dataProviderName: "tyk" });

  const columns = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "API ID", dataIndex: "api_id", key: "api_id", ellipsis: true },
    { title: "监听路径", dataIndex: ["proxy", "listen_path"], key: "path" },
    { title: "上游", dataIndex: ["proxy", "target_url"], key: "target", ellipsis: true },
    {
      title: "认证",
      key: "auth",
      render: (_: any, r: any) => r.use_keyless ? <Tag>Keyless</Tag> : <Tag color="blue">Token</Tag>,
    },
    {
      title: "状态",
      dataIndex: "active",
      key: "active",
      render: (v: boolean) => v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/apis/show/${r.api_id}`)}>详情</Button>
          <Button size="small" onClick={() => navigate(`/apis/edit/${r.api_id}`)}>编辑</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => {
            localStorage.setItem("clone_api", JSON.stringify(r));
            navigate("/apis/create?clone=true");
          }}>克隆</Button>
          <Popconfirm title="确定删除？" onConfirm={() => {
            message.info("删除功能需通过 Data Provider");
          }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/apis/create")}>
          创建 API
        </Button>
      </Space>
      <Table dataSource={data?.data || []} columns={columns} rowKey="api_id" loading={isLoading} size="small" />
    </div>
  );
}

// ── Create ──
export function ApiCreate() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { mutate: create } = useCreate({ dataProviderName: "tyk" });

  // Check if cloning
  const query = new URLSearchParams(window.location.search);
  const cloneData = query.get("clone") ? JSON.parse(localStorage.getItem("clone_api") || "{}") : null;

  const onFinish = (values: any) => {
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
      auth: values.use_keyless ? {} : { auth_header_name: values.auth_header_name || "authorization" },
      CORS: {
        enable: values.cors_enable ?? false,
        allowed_origins: values.allowed_origins ? values.allowed_origins.split(",").map((s: string) => s.trim()) : ["*"],
        allowed_methods: values.allowed_methods ? values.allowed_methods.split(",").map((s: string) => s.trim()) : ["GET", "POST"],
        allowed_headers: values.allowed_headers ? values.allowed_headers.split(",").map((s: string) => s.trim()) : ["*"],
      },
      enable_jwt: values.enable_jwt ?? false,
      disable_rate_limit: values.disable_rate_limit ?? false,
      cache_options: {
        enable_cache: values.enable_cache ?? false,
        cache_timeout: values.cache_timeout || 60,
      },
    };
    create({ resource: "apis", values: payload }, {
      onSuccess: () => { message.success("API 创建成功"); navigate("/apis"); },
      onError: (e: any) => message.error("创建失败: " + e.message),
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <Tabs items={[
        { key: "basic", label: "基本信息", children: (
          <>
            <Form.Item name="name" label="名称" rules={[{ required: true }]} initialValue={cloneData?.name}><Input /></Form.Item>
            <Form.Item name="api_id" label="API ID" rules={[{ required: true }]} initialValue={cloneData?.api_id}><Input /></Form.Item>
            <Form.Item name="active" label="启用" initialValue={cloneData?.active ?? true} valuePropName="checked"><Switch /></Form.Item>
          </>
        ) },
        { key: "route", label: "路由配置", children: (
          <>
            <Form.Item name="listen_path" label="监听路径" rules={[{ required: true }]} initialValue={cloneData?.proxy?.listen_path}><Input placeholder="/my-api/" /></Form.Item>
            <Form.Item name="target_url" label="上游 URL" rules={[{ required: true }]} initialValue={cloneData?.proxy?.target_url}><Input placeholder="http://upstream" /></Form.Item>
            <Form.Item name="strip_listen_path" label="剥离路径" initialValue={cloneData?.proxy?.strip_listen_path ?? true} valuePropName="checked"><Switch /></Form.Item>
          </>
        ) },
        { key: "auth", label: "认证", children: (
          <>
            <Form.Item name="use_keyless" label="免认证 (Keyless)" initialValue={cloneData?.use_keyless ?? false} valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="auth_header_name" label="认证头" initialValue={cloneData?.auth?.auth_header_name || "authorization"}><Input /></Form.Item>
            <Form.Item name="enable_jwt" label="启用 JWT" initialValue={cloneData?.enable_jwt ?? false} valuePropName="checked"><Switch /></Form.Item>
          </>
        ) },
        { key: "cors", label: "CORS", children: (
          <>
            <Form.Item name="cors_enable" label="启用 CORS" initialValue={cloneData?.CORS?.enable ?? false} valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="allowed_origins" label="允许域名" initialValue={(cloneData?.CORS?.allowed_origins || ["*"]).join(", ")}><Input placeholder="*" /></Form.Item>
            <Form.Item name="allowed_methods" label="允许方法" initialValue={(cloneData?.CORS?.allowed_methods || ["GET", "POST"]).join(", ")}><Input placeholder="GET, POST" /></Form.Item>
            <Form.Item name="allowed_headers" label="允许头" initialValue={(cloneData?.CORS?.allowed_headers || ["*"]).join(", ")}><Input placeholder="*" /></Form.Item>
          </>
        ) },
        { key: "rate", label: "速率限制", children: (
          <>
            <Form.Item name="disable_rate_limit" label="禁用限流" initialValue={cloneData?.disable_rate_limit ?? false} valuePropName="checked"><Switch /></Form.Item>
          </>
        ) },
        { key: "cache", label: "缓存", children: (
          <>
            <Form.Item name="enable_cache" label="启用缓存" initialValue={cloneData?.cache_options?.enable_cache ?? false} valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="cache_timeout" label="超时(s)" initialValue={cloneData?.cache_options?.cache_timeout || 60}><Input type="number" /></Form.Item>
          </>
        ) },
      ]} />
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Button type="primary" htmlType="submit" size="large">创建 API</Button>
      </Form>
    </div>
  );
}

// ── Edit ──
export function ApiEdit() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const { mutate: update } = useUpdate({ dataProviderName: "tyk" });

  // Get the api_id from URL — simplified: we'll use form directly
  const apiId = window.location.pathname.split("/").pop();

  const { data, isLoading } = useOne({ resource: "apis", id: apiId || "", dataProviderName: "tyk" });

  if (isLoading) return <div style={{ padding: 24 }}>加载中...</div>;

  const api = data?.data;

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...api,
          listen_path: api?.proxy?.listen_path,
          target_url: api?.proxy?.target_url,
        }}
        onFinish={(values: any) => {
          update({
            resource: "apis",
            id: apiId!,
            values: { ...api, ...values, proxy: { ...api?.proxy, listen_path: values.listen_path, target_url: values.target_url } },
          }, {
            onSuccess: () => { message.success("更新成功"); navigate("/apis"); },
            onError: (e: any) => message.error("更新失败: " + e.message),
          });
        }}
      >
        <Space style={{ marginBottom: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="listen_path" label="监听路径"><Input /></Form.Item>
          <Form.Item name="target_url" label="上游 URL"><Input /></Form.Item>
          <Form.Item name="active" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Space>
        <Button type="primary" htmlType="submit">保存修改</Button>
      </Form>
    </div>
  );
}

// ── Show (detail) ──
export function ApiShow() {
  const apiId = window.location.pathname.split("/").pop();
  const { data, isLoading } = useOne({ resource: "apis", id: apiId || "", dataProviderName: "tyk" });

  return (
    <div style={{ padding: 24 }}>
      {isLoading ? <span>加载中...</span> : (
        <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, overflow: "auto", maxHeight: "70vh" }}>
          {JSON.stringify(data?.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
