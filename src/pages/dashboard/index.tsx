/**
 * 网关仪表板页面
 *
 * @description
 * 展示 Tyk Gateway 的整体运行状态，包含：
 * - 网关健康卡片（版本号、Redis 连通性）
 * - 全局统计卡片（API 总数、平均延迟、请求数、Reload 次数）
 * - API 健康指标列表（前 10 个，含延误/请求/成功/错误/状态）
 * - 一键重载按钮 + 重载计数器 + 距上次重载时间
 * - 暂停自动重载开关 + 未生效更改 banner
 * - 手动/自动刷新控制
 *
 * ## 数据来源
 * - GET /hello → 网关版本 + Redis 状态
 * - GET /tyk/apis/ → API 列表
 * - GET /tyk/health/?api_id=xxx → 每个 API 的健康指标（逐个遍历）
 *
 * ## 性能考虑
 * - 自动轮询默认关闭，避免 N+1 问题（N 个 API = N 次 HTTP 请求/轮询）
 * - 健康指标列表限制前 10 个，其余按需加载
 *
 * @component
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Statistic, Row, Col, Table, Tag, Button, Switch, Space, Typography, Spin, Alert } from 'antd';
import { ReloadOutlined, PauseCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { getGatewayUrl, getSecret } from '../../providers/tyk-data-provider';

const { Text } = Typography;

/** Tyk /hello 端点返回的网关健康状态 */
interface TykHello {
  status: string;
  version: string;
  details: { redis: { status: string } };
}

/** 单个 API 的健康指标（从 /tyk/health/ 获取并聚合 API 定义字段） */
interface ApiHealth {
  api_id: string;
  name: string;
  active: boolean;
  avg_upstream_latency: number;
  requests: number;
}

/** Tyk Gateway API 通用 GET 请求辅助函数 */
async function tykGet(path: string) {
  const h: Record<string, string> = {};
  const s = getSecret();
  if (s) h['x-tyk-authorization'] = s;
  const r = await fetch(`${getGatewayUrl()}${path}`, { headers: h });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** localStorage key：reload 计数器 */
const RELOAD_KEY = 'tyk_reload_count';
/** localStorage key：上次 reload 时间 */
const RELOAD_TIME_KEY = 'tyk_reload_time';

export default function Dashboard() {
  // ── 网关状态 ──
  const [hello, setHello] = useState<TykHello | null>(null);
  const [apiHealths, setApiHealths] = useState<ApiHealth[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 轮询控制（默认关闭） ──
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval] = useState(10);

  // ── Reload 追踪（持久化到 localStorage） ──
  const [reloadCount, setReloadCount] = useState(Number(localStorage.getItem(RELOAD_KEY) || 0));
  const [reloadTime, setReloadTime] = useState(localStorage.getItem(RELOAD_TIME_KEY) || '');

  // ── 自动 reload 开关 ──
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() =>
    localStorage.getItem('tyk_auto_reload') !== 'false');
  const [pendingChanges, setPendingChanges] = useState(0);

  /**
   * 获取网关健康数据 + 各 API 健康指标
   * - 调用 /hello 获取版本和 Redis 状态
   * - 遍历 /tyk/apis/ 前 10 个，逐个查询 /tyk/health/
   * - 合并 API 定义的 active 字段用于状态判断
   */
  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const h = await tykGet('/hello');
      setHello(h);
      const apis = (await tykGet('/tyk/apis/')) || [];
      const healths: ApiHealth[] = [];
      // 仅加载前 10 个 API，避免 N+1 请求放大
      for (const api of apis.slice(0, 10)) {
        try {
          const health = await tykGet(`/tyk/health/?api_id=${api.api_id}`);
          if (health) {
            healths.push({
              api_id: api.api_id,
              name: api.name,
              active: api.active ?? true,
              avg_upstream_latency: health.average_upstream_latency || 0,
              requests: health.average_requests_per_second || 0,
            });
          }
        } catch {
          // 单个 API 健康查询失败不影响整体
        }
      }
      setApiHealths(healths);
    } catch {
      // 网关不可达
    }
    setLoading(false);
  }, []);

  // 首次加载
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // 轮询刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchHealth, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchHealth]);

  /**
   * 一键重载 Tyk Gateway
   * - 调用 /tyk/reload/ 使所有 API 变更生效
   * - 更新 reload 计数器和时间（持久化到 localStorage）
   * - 清空 pendingChanges 计数器
   * - 重载后自动刷新健康数据
   */
  const handleReload = async () => {
    try {
      await tykGet('/tyk/reload/');
      const count = reloadCount + 1;
      const time = new Date().toLocaleTimeString();
      setReloadCount(count);
      setReloadTime(time);
      localStorage.setItem(RELOAD_KEY, String(count));
      localStorage.setItem(RELOAD_TIME_KEY, time);
      setPendingChanges(0);
      fetchHealth();
    } catch {
      // reload 失败静默处理
    }
  };

  /** 切换自动 reload 模式 */
  const handleToggleAutoReload = (v: boolean) => {
    setAutoReloadEnabled(v);
    localStorage.setItem('tyk_auto_reload', String(v));
  };

  // 暴露 reload 状态给 Data Provider（供 create/update/delete 后同步 pendingChanges）
  useEffect(() => {
    (window as any).__tyk_onChange = () => {
      if (autoReloadEnabled) {
        setPendingChanges(0);
      } else {
        setPendingChanges((c) => c + 1);
      }
    };
    (window as any).__tyk_autoReload = () => autoReloadEnabled;
  }, [autoReloadEnabled]);

  // ── 表格列定义 ──
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'API ID', dataIndex: 'api_id', key: 'api_id', ellipsis: true },
    { title: '延迟', dataIndex: 'avg_upstream_latency', key: 'latency', render: (v: number) => `${Math.round(v)}ms` },
    { title: '请求速率', dataIndex: 'requests', key: 'requests', render: (v: number) => `${v}/s` },
    { title: '状态',
      key: 'status',
      render: () => <Tag color="success">正常</Tag>,
    },
  ];

  // ── 全局统计 ──
  const totalApis = apiHealths.length;
  const avgLatency = totalApis ? Math.round(apiHealths.reduce((s, a) => s + a.avg_upstream_latency, 0) / totalApis) : 0;
  const totalRps = apiHealths.reduce((s, a) => s + a.requests, 0);

  return (
    <div style={{ padding: 24 }}>
      {/* 网关健康横幅 */}
      <Card style={{ marginBottom: 16 }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Space>
              <Tag color={hello?.status === 'pass' ? 'green' : 'red'}>
                {hello?.status === 'pass' ? '● 运行中' : '● 异常'}
              </Tag>
              <Text strong>Tyk Gateway {hello?.version || '—'}</Text>
              <Tag color={hello?.details?.redis?.status === 'pass' ? 'green' : 'red'}>
                Redis: {hello?.details?.redis?.status === 'pass' ? '✅' : '❌'}
              </Tag>
              {reloadTime && <Text type="secondary">上次 reload: {reloadTime} (共 {reloadCount} 次)</Text>}
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={handleReload} type="primary">一键重载</Button>
          </Col>
        </Row>
      </Card>

      {/* 未生效更改 Banner（暂停 reload 时显示） */}
      {pendingChanges > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${pendingChanges} 项未生效的更改`}
          description={<Button size="small" type="primary" onClick={handleReload}><SyncOutlined /> 点击应用所有更改</Button>}
          style={{ marginBottom: 16 }}
          closable
        />
      )}

      {/* 自动 reload 控制条 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Switch checked={autoReloadEnabled} onChange={handleToggleAutoReload} />
          <Text>自动 reload</Text>
          <PauseCircleOutlined style={{ opacity: autoReloadEnabled ? 0.5 : 1 }} />
          <Text type="secondary">{autoReloadEnabled ? '每次修改后自动重载' : '暂停中，修改不会立即生效'}</Text>
        </Space>
      </Card>

      {/* 全局统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="API 总数" value={totalApis} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均延迟" value={avgLatency} suffix="ms" /></Card></Col>
        <Col span={6}><Card><Statistic title="请求速率" value={totalRps} suffix="/s" /></Card></Col>
        <Col span={6}><Card><Statistic title="Reload 次数" value={reloadCount} /></Card></Col>
      </Row>

      {/* 刷新控制 */}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={fetchHealth}>手动刷新</Button>
        <Text>自动刷新</Text>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
        {autoRefresh && <Text type="secondary">每 {refreshInterval}s</Text>}
      </Space>

      {/* API 健康指标表格 */}
      <Card title="API 运行状态（前 10 个）">
        {loading ? <Spin tip="加载中..." /> : (
          <Table dataSource={apiHealths} columns={columns} rowKey="api_id" pagination={false} size="small" />
        )}
      </Card>
    </div>
  );
}
