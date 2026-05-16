import { useState } from 'react';
import { Card, Form, Input, Button, Space, Typography, App } from 'antd';
import { CheckCircleOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';

const { Text } = Typography;

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [showSecret, setShowSecret] = useState(false);
  const { message } = App.useApp();

  const onFinish = (values: any) => {
    localStorage.setItem('tyk_gateway_url', values.gatewayUrl);
    localStorage.setItem('tyk_secret', values.secret);
    localStorage.setItem('tyk_docker_url', values.dockerUrl || 'http://localhost:3001');
    localStorage.setItem('tyk_refresh_interval', String(values.refreshInterval || 10));
    message.success('配置已保存');
  };

  const testConnection = async () => {
    const gw = form.getFieldValue('gatewayUrl') || 'http://localhost:8080';
    const secret = form.getFieldValue('secret') || '';
    try {
      const res = await fetch(`${gw}/hello`, {
        headers: secret ? { 'x-tyk-authorization': secret } : {},
      });
      const data = await res.json();
      if (data.status === 'pass') {
        message.success(`连接成功 — Tyk ${data.version}`);
      } else {
        message.warning(`连接成功但状态异常: ${data.status}`);
      }
    } catch {
      message.error('无法连接到 Tyk Gateway，请检查地址');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <Card title="⚙ 网关配置">
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            gatewayUrl: localStorage.getItem('tyk_gateway_url') || 'http://localhost:8080',
            secret: localStorage.getItem('tyk_secret') || '',
            dockerUrl: localStorage.getItem('tyk_docker_url') || 'http://localhost:3001',
            refreshInterval: Number(localStorage.getItem('tyk_refresh_interval') || 10),
          }}
        >
          <Form.Item label="Tyk Gateway 地址" name="gatewayUrl">
            <Input placeholder="http://localhost:8080" />
          </Form.Item>

          <Form.Item
            label="API Secret"
            name="secret"
            help={
              <Text type="warning">⚠ Secret 存储在浏览器 localStorage，仅适用于内网/开发环境</Text>
          }
          >
            <Input
              type={showSecret ? 'text' : 'password'}
              placeholder="x-tyk-authorization 值"
              suffix={
                <Button type="text" size="small" onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </Button>
              }
            />
          </Form.Item>

          <Form.Item label="Docker 管理服务地址" name="dockerUrl">
            <Input placeholder="http://localhost:3001" />
          </Form.Item>

          <Form.Item label="轮询间隔 (秒)" name="refreshInterval">
            <Input type="number" min={5} max={300} />
          </Form.Item>

          <Space>
            <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />}>
              保存配置
            </Button>
            <Button onClick={testConnection}>测试连接</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
