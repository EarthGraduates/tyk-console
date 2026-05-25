/**
 * 业务仪表板 — 面向 business_user / audit_admin / viewer
 *
 * 轻量级 API 概览，不含网关控制和重载功能。
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Statistic, Row, Col, Table, Tag, Typography, Space, Spin } from 'antd';
import { ApiOutlined, KeyOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { apiDefinitionsDb, apiKeysDb, type ApiDefinition } from '../../providers/ichse-db';

const { Text } = Typography;

const POLL_INTERVAL = 30000;

export default function BusinessDashboard() {
  const [apis, setApis] = useState<ApiDefinition[]>([]);
  const [keyCount, setKeyCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [apiList, keys] = await Promise.all([
        apiDefinitionsDb.list(),
        apiKeysDb.list(),
      ]);
      setApis(apiList);
      setKeyCount(keys.length);
    } catch (e) {
      console.error('Business dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const activeApis = apis.filter((a) => a.status === 'active');
  const syncedApis = apis.filter((a) => a.sync_status === 'synced');
  const pendingApis = apis.filter((a) => a.sync_status === 'pending');
  const failedApis = apis.filter((a) => a.sync_status === 'failed');

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag>,
    },
    {
      title: '同步',
      dataIndex: 'sync_status',
      key: 'sync_status',
      width: 80,
      render: (s: string) => {
        if (s === 'synced') return <Tag icon={<CheckCircleOutlined />} color="green">已同步</Tag>;
        if (s === 'pending') return <Tag icon={<SyncOutlined spin />} color="orange">待同步</Tag>;
        if (s === 'failed') return <Tag color="red">失败</Tag>;
        return <Tag>{s}</Tag>;
      },
    },
    { title: '监听路径', dataIndex: 'listen_path', key: 'listen_path', ellipsis: true },
    { title: '上游', dataIndex: 'target_url', key: 'target_url', ellipsis: true },
  ];

  if (loading) return <Spin style={{ display: 'block', margin: '40vh auto' }} />;

  return (
    <div style={{ padding: 24 }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Row gutter={16}>
          <Col span={6}>
            <Card><Statistic title="API 总数" value={apis.length} prefix={<ApiOutlined />} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="激活" value={activeApis.length} suffix={`/ ${apis.length}`} styles={{ content: { color: '#3f8600' } }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="密钥数" value={keyCount} prefix={<KeyOutlined />} /></Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="同步状态"
                value={syncedApis.length}
                suffix={failedApis.length > 0 ? ` / 失败 ${failedApis.length}` : ''}
                styles={{ content: { color: failedApis.length > 0 ? '#cf1322' : '#3f8600' } }}
              />
            </Card>
          </Col>
        </Row>
        <Card title="API 服务列表">
          <Table
            dataSource={apis}
            columns={columns}
            rowKey="api_id"
            pagination={{ pageSize: 15, showSizeChanger: false }}
            size="small"
          />
        </Card>
        {pendingApis.length > 0 && (
          <Card>
            <Text type="warning">⚠ 有 {pendingApis.length} 个 API 待同步到 Tyk Gateway</Text>
          </Card>
        )}
      </Space>
    </div>
  );
}
