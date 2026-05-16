import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Space, Tag, Typography, Modal, Spin, Alert } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined, CloudServerOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface GatewayStatus {
  running: boolean;
  status: string;
  startedAt: string;
  version: string;
  ports: string;
}

function getDockerUrl() {
  return localStorage.getItem('tyk_docker_url') || 'http://localhost:3001';
}

async function dockerGet(path: string) {
  try {
    const r = await fetch(`${getDockerUrl()}${path}`);
    return await r.json();
  } catch {
    return null;
  }
}

async function dockerPost(path: string) {
  const r = await fetch(`${getDockerUrl()}${path}`, { method: 'POST' });
  return await r.json();
}

export default function GatewayPage() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dockerDown, setDockerDown] = useState(false);
  const [operating, setOperating] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    const s = await dockerGet('/api/gateway/status');
    if (s) {
      setStatus(s);
      setDockerDown(false);
    } else {
      setDockerDown(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleAction = async (action: string) => {
    Modal.confirm({
      title: `确认${action}`,
      content: `确定要${action} Tyk Gateway 吗？${action === '停止' ? '停止后所有 API 将不可用。' : ''}`,
      onOk: async () => {
        setOperating(true);
        const map: Record<string, string> = { 启动: 'start', 停止: 'stop', 重启: 'restart' };
        await dockerPost(`/api/gateway/${map[action]}`);
        await new Promise((r) => setTimeout(r, 2000)); // wait for container state
        await fetchStatus();
        setOperating(false);
      },
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <Title level={4}><CloudServerOutlined /> 网关管理</Title>

      {dockerDown && !loading && (
        <Alert
          type="warning"
          showIcon
          message="Docker 管理服务不可用"
          description="网关管理功能暂时无法使用，API 管理和仪表板不受影响。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        {loading ? <Spin /> : status ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space>
              <Tag color={status.running ? 'green' : 'red'}>
                {status.running ? '● 运行中' : '● 已停止'}
              </Tag>
              <Text strong>{status.status}</Text>
            </Space>
            <div>
              <Text type="secondary">Tyk 版本 </Text>
              <Text strong>{status.version || '—'}</Text>
            </div>
            <div>
              <Text type="secondary">端口 </Text>
              <Text>{status.ports || '—'}</Text>
            </div>
            <div>
              <Text type="secondary">启动时间 </Text>
              <Text>{status.startedAt ? new Date(status.startedAt).toLocaleString() : '—'}</Text>
            </div>
          </Space>
        ) : null}
      </Card>

      <Space>
        <Button
          icon={<PlayCircleOutlined />}
          onClick={() => handleAction('启动')}
          loading={operating}
          disabled={dockerDown || status?.running}
        >
          启动
        </Button>
        <Button
          icon={<PauseCircleOutlined />}
          danger
          onClick={() => handleAction('停止')}
          loading={operating}
          disabled={dockerDown || !status?.running}
        >
          停止
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => handleAction('重启')}
          loading={operating}
          disabled={dockerDown || !status?.running}
        >
          重启
        </Button>
        <Button icon={<ReloadOutlined />} onClick={fetchStatus} disabled={dockerDown}>
          刷新状态
        </Button>
      </Space>
    </div>
  );
}
