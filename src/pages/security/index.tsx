/**
 * 安全策略页
 *
 * security_admin 专属配置页。
 * 读写 PostgreSQL security_config 表，DB 不可达时降级为 localStorage。
 */

import { useState, useEffect } from 'react';
import {
  Card, Form, InputNumber, Select, Button, Space, Typography, Divider, message, Row, Col, Spin,
} from 'antd';
import { SaveOutlined, LockOutlined, LogoutOutlined } from '@ant-design/icons';
import { securityConfigDb, sessionsDb, type SecurityConfig, type SessionRecord } from '../../providers/ichse-db';

const { Text, Title } = Typography;

const DEFAULTS: SecurityConfig = {
  password_min_length: 8,
  password_require_upper: true,
  password_require_digit: true,
  password_require_special: false,
  lockout_threshold: 5,
  lockout_duration_minutes: 30,
  session_timeout_hours: 8,
  rate_limit_per_minute: 100,
  max_concurrent_sessions: 0,
};

function loadLocalFallback(): SecurityConfig {
  try {
    const stored = localStorage.getItem('ichse_security_config');
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export default function SecurityPage() {
  const [config, setConfig] = useState<SecurityConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dbOk, setDbOk] = useState(true);
  const [form] = Form.useForm();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await securityConfigDb.get();
        setConfig(cfg);
        form.setFieldsValue(cfg);
        setDbOk(true);
      } catch {
        const fallback = loadLocalFallback();
        setConfig(fallback);
        form.setFieldsValue(fallback);
        setDbOk(false);
        message.warning('无法连接数据库，已加载本地缓存配置');
      } finally {
        setLoading(false);
      }
    })();
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await securityConfigDb.set(config);
      // 同步一份到 localStorage 作为离线缓存
      localStorage.setItem('ichse_security_config', JSON.stringify(config));
      message.success('安全策略已保存到数据库');
    } catch (e: any) {
      // DB 保存失败，降级到 localStorage
      localStorage.setItem('ichse_security_config', JSON.stringify(config));
      message.warning(`数据库保存失败，已保存到本地缓存: ${e.message || ''}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULTS);
    form.setFieldsValue(DEFAULTS);
    message.info('已恢复默认配置（未保存）');
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const list = await sessionsDb.listActive();
      setSessions(list);
    } catch (e: any) {
      message.error(`加载会话列表失败: ${e.message || ''}`);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await sessionsDb.revoke(sessionId);
      message.success('已强制下线该会话');
      loadSessions();
    } catch (e: any) {
      message.error(`撤销会话失败: ${e.message || ''}`);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '40vh auto' }} />;

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4}><LockOutlined /> 安全策略配置</Title>
          <Text type="secondary">
            {dbOk
              ? '配置存储在 PostgreSQL security_config 表中，login() / db_pre_request() / manage_user() 实时读取。'
              : '⚠ 数据库不可达，当前显示本地缓存。保存将写入 localStorage，恢复连接后需手动同步。'}
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
            <Col span={8}>
              <Text>会话超时（小时）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={1} max={72}
                value={config.session_timeout_hours}
                onChange={v => setConfig(c => ({ ...c, session_timeout_hours: v ?? 8 }))}
              />
              <Text type="secondary">JWT token 有效期</Text>
            </Col>
            <Col span={8}>
              <Text>速率限制（次/分钟）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={10} max={10000}
                value={config.rate_limit_per_minute}
                onChange={v => setConfig(c => ({ ...c, rate_limit_per_minute: v ?? 100 }))}
              />
              <Text type="secondary">每用户每分钟最大 API 请求数</Text>
            </Col>
            <Col span={8}>
              <Text>最大并发会话数</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={0} max={100}
                value={config.max_concurrent_sessions}
                onChange={v => setConfig(c => ({ ...c, max_concurrent_sessions: v ?? 0 }))}
              />
              <Text type="secondary">0 表示不限制，超过则挤占最早会话</Text>
            </Col>
          </Row>
        </Card>

        <Card
          title="活跃会话"
          extra={<Button size="small" onClick={loadSessions} loading={sessionsLoading}>刷新</Button>}
        >
          {sessions.length === 0 ? (
            <Text type="secondary">{sessionsLoading ? '加载中...' : '点击"刷新"查看当前活跃会话'}</Text>
          ) : (
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>用户</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>角色</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>IP</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>登录时间</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>过期时间</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.session_id}>
                      <td style={{ padding: '4px 8px' }}>{s.user_email}</td>
                      <td style={{ padding: '4px 8px' }}>{s.user_role}</td>
                      <td style={{ padding: '4px 8px' }}>{s.client_ip || '-'}</td>
                      <td style={{ padding: '4px 8px' }}>{new Date(s.created_at).toLocaleString()}</td>
                      <td style={{ padding: '4px 8px' }}>{new Date(s.expires_at).toLocaleString()}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <Button
                          size="small"
                          danger
                          icon={<LogoutOutlined />}
                          onClick={() => handleRevokeSession(s.session_id)}
                        >
                          强制下线
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Divider />
        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存配置</Button>
          <Button onClick={handleReset}>恢复默认</Button>
        </Space>
      </Space>
    </div>
  );
}
