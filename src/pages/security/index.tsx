/**
 * 安全策略页
 *
 * security_admin 专属配置页。
 * 当前为占位实现，后续 Phase 将持久化到 security_config 表。
 */

import { useState } from 'react';
import {
  Card, Form, InputNumber, Select, Button, Space, Typography, Divider, message, Row, Col,
} from 'antd';
import { SaveOutlined, LockOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface SecurityConfig {
  password_min_length: number;
  password_require_upper: boolean;
  password_require_digit: boolean;
  password_require_special: boolean;
  lockout_threshold: number;
  lockout_duration_minutes: number;
  session_timeout_hours: number;
  rate_limit_per_minute: number;
}

const DEFAULTS: SecurityConfig = {
  password_min_length: 8,
  password_require_upper: true,
  password_require_digit: true,
  password_require_special: false,
  lockout_threshold: 5,
  lockout_duration_minutes: 30,
  session_timeout_hours: 8,
  rate_limit_per_minute: 100,
};

function loadConfig(): SecurityConfig {
  try {
    const stored = localStorage.getItem('ichse_security_config');
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export default function SecurityPage() {
  const [config, setConfig] = useState<SecurityConfig>(loadConfig);
  const [form] = Form.useForm();

  const handleSave = () => {
    localStorage.setItem('ichse_security_config', JSON.stringify(config));
    message.success('安全策略已保存（本地存储）');
  };

  const handleReset = () => {
    setConfig(DEFAULTS);
    form.setFieldsValue(DEFAULTS);
    message.info('已恢复默认配置');
  };

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4}><LockOutlined /> 安全策略配置</Title>
          <Text type="secondary">
            当前配置保存在浏览器本地存储中。后续版本将迁移至数据库持久化并支持审计。
          </Text>
        </div>

        <Card title="密码策略">
          <Form form={form} layout="vertical" initialValues={config}>
            <Form.Item label="最小长度">
              <InputNumber
                min={6} max={32}
                value={config.password_min_length}
                onChange={v => setConfig(c => ({ ...c, password_min_length: v ?? 8 }))}
              />
            </Form.Item>
            <Form.Item label="复杂度要求">
              <Select
                mode="multiple"
                value={[
                  ...(config.password_require_upper ? ['upper'] : []),
                  ...(config.password_require_digit ? ['digit'] : []),
                  ...(config.password_require_special ? ['special'] : []),
                ]}
                onChange={(vals: string[]) => setConfig(c => ({
                  ...c,
                  password_require_upper: vals.includes('upper'),
                  password_require_digit: vals.includes('digit'),
                  password_require_special: vals.includes('special'),
                }))}
                options={[
                  { label: '包含大写字母', value: 'upper' },
                  { label: '包含数字', value: 'digit' },
                  { label: '包含特殊字符', value: 'special' },
                ]}
              />
            </Form.Item>
          </Form>
        </Card>

        <Card title="账户锁定">
          <Row gutter={16}>
            <Col span={12}>
              <Text>失败次数阈值</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={3} max={20}
                value={config.lockout_threshold}
                onChange={v => setConfig(c => ({ ...c, lockout_threshold: v ?? 5 }))}
              />
              <Text type="secondary">连续登录失败达到此次数后锁定账户</Text>
            </Col>
            <Col span={12}>
              <Text>锁定时长（分钟）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={5} max={1440}
                value={config.lockout_duration_minutes}
                onChange={v => setConfig(c => ({ ...c, lockout_duration_minutes: v ?? 30 }))}
              />
              <Text type="secondary">自动解锁前的等待时间</Text>
            </Col>
          </Row>
        </Card>

        <Card title="会话与速率">
          <Row gutter={16}>
            <Col span={12}>
              <Text>会话超时（小时）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={1} max={72}
                value={config.session_timeout_hours}
                onChange={v => setConfig(c => ({ ...c, session_timeout_hours: v ?? 8 }))}
              />
              <Text type="secondary">JWT token 有效期</Text>
            </Col>
            <Col span={12}>
              <Text>速率限制（次/分钟）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={10} max={10000}
                value={config.rate_limit_per_minute}
                onChange={v => setConfig(c => ({ ...c, rate_limit_per_minute: v ?? 100 }))}
              />
              <Text type="secondary">每用户每分钟最大 API 请求数</Text>
            </Col>
          </Row>
        </Card>

        <Divider />
        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存配置</Button>
          <Button onClick={handleReset}>恢复默认</Button>
        </Space>
      </Space>
    </div>
  );
}
