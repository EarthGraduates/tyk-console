/**
 * 登录页
 *
 * 三种登录方式：密码 / 验证码 / 扫码（Phase 1 仅实现密码登录，其余预留）
 *
 * @module pages/login
 */

import { useState } from 'react';
import { Card, Form, Input, Button, Tabs, Space, Typography, message, Alert } from 'antd';
import { LockOutlined, MobileOutlined, MailOutlined, QrcodeOutlined, MessageOutlined } from '@ant-design/icons';
import { useLogin } from '@refinedev/core';

const { Text } = Typography;

type LoginMode = 'password' | 'code' | 'qrcode';

export default function LoginPage() {
  const { mutate: login } = useLogin();
  const [mode, setMode] = useState<LoginMode>('password');
  const [loading, setLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState(false);

  const handleSubmit = async (values: Record<string, string>) => {
    setLoading(true);
    try {
      await login(values);
    } catch (err: any) {
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}
    >
      <Card
        style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
        styles={{ body: { padding: '32px 32px 24px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Text strong style={{ fontSize: 22, color: 'rgba(0,0,0,0.85)' }}>
            ichse 管理中心
          </Text>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">API 网关资产管理共享中心</Text>
          </div>
        </div>

        <Tabs
          activeKey={mode}
          onChange={(key) => setMode(key as LoginMode)}
          centered
          items={[
            { key: 'password', label: <span><LockOutlined /> 密码</span> },
            { key: 'code', label: <span><MessageOutlined /> 验证码</span> },
            { key: 'qrcode', label: <span><QrcodeOutlined /> 扫码</span> },
          ]}
        />

        {mode === 'password' && (
          <Form
            name="login-password"
            onFinish={handleSubmit}
            layout="vertical"
            size="large"
            initialValues={{ email: 'dev_biz@ichse.local' }}
          >
            <Form.Item
              name="email"
              label="手机号 / 邮箱"
              rules={[{ required: true, message: '请输入手机号或邮箱' }]}
            >
              <Input prefix={<MobileOutlined />} placeholder="手机号或邮箱" />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>

            {forgotStep && (
              <Alert
                message="请联系管理员重置密码"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                登录
              </Button>
            </Form.Item>
          </Form>
        )}

        {mode === 'code' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Text type="secondary">验证码登录功能开发中...</Text>
          </div>
        )}

        {mode === 'qrcode' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Text type="secondary">扫码登录功能开发中...</Text>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <Space style={{ width: '100%', justifyContent: 'center' }}>
            <Button type="link" size="small" onClick={() => setForgotStep(!forgotStep)}>
              忘记密码
            </Button>
          </Space>
        </div>
      </Card>
    </div>
  );
}
