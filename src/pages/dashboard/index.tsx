import { useState, useEffect, useCallback } from "react";
import { Card, Statistic, Row, Col, Table, Tag, Button, Switch, Space, Typography, Spin, Alert } from "antd";
import { ReloadOutlined, PauseCircleOutlined, SyncOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

interface TykHello {
  status: string;
  version: string;
  details: { redis: { status: string } };
}

interface ApiHealth {
  api_id: string;
  name: string;
  avg_upstream_latency: number;
  requests: number;
  success: number;
  error: number;
}

import { getGatewayUrl, getSecret } from "../../providers/tyk-data-provider";

async function tykGet(path: string) {
  const h: Record<string, string> = {};
  const s = getSecret(); if (s) h["x-tyk-authorization"] = s;
  const r = await fetch(`${getGatewayUrl()}${path}`, { headers: h });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ──── Reload state (shared via window for now) ────
const RELOAD_KEY = "tyk_reload_count";
const RELOAD_TIME_KEY = "tyk_reload_time";

export default function Dashboard() {
  const [hello, setHello] = useState<TykHello | null>(null);
  const [apiHealths, setApiHealths] = useState<ApiHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10);

  // reload tracking
  const [reloadCount, setReloadCount] = useState(Number(localStorage.getItem(RELOAD_KEY) || 0));
  const [reloadTime, setReloadTime] = useState(localStorage.getItem(RELOAD_TIME_KEY) || "");

  // auto-reload switch
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() => {
    return localStorage.getItem("tyk_auto_reload") !== "false"; // default on
  });
  const [pendingChanges, setPendingChanges] = useState(0);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const h = await tykGet("/hello");
      setHello(h);
      // Fetch health for all APIs
      const apis = await tykGet("/tyk/apis/") || [];
      const healths: ApiHealth[] = [];
      for (const api of apis.slice(0, 10)) { // first 10 only
        try {
          const health = await tykGet(`/tyk/health/?api_id=${api.api_id}`);
          if (health) {
            healths.push({
              api_id: api.api_id,
              name: api.name,
              avg_upstream_latency: health.average_upstream_latency || 0,
              requests: health.requests || 0,
              success: health.success || 0,
              error: health.error || 0,
            });
          }
        } catch { /* skip */ }
      }
      setApiHealths(healths);
    } catch { /* gateway down */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchHealth, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchHealth]);

  // ── Reload ──
  const handleReload = async () => {
    try {
      await tykGet("/tyk/reload/");
      const count = reloadCount + 1;
      const time = new Date().toLocaleTimeString();
      setReloadCount(count);
      setReloadTime(time);
      localStorage.setItem(RELOAD_KEY, String(count));
      localStorage.setItem(RELOAD_TIME_KEY, time);
      setPendingChanges(0);
      fetchHealth();
    } catch { /* */ }
  };

  const handleToggleAutoReload = (v: boolean) => {
    setAutoReloadEnabled(v);
    localStorage.setItem("tyk_auto_reload", String(v));
  };

  // expose to Data Provider
  useEffect(() => {
    (window as any).__tyk_onChange = () => {
      if (autoReloadEnabled) {
        setPendingChanges(0);
      } else {
        setPendingChanges(c => c + 1);
      }
    };
    (window as any).__tyk_autoReload = () => autoReloadEnabled;
  }, [autoReloadEnabled]);

  const columns = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "API ID", dataIndex: "api_id", key: "api_id", ellipsis: true },
    { title: "延迟", dataIndex: "avg_upstream_latency", key: "latency", render: (v: number) => `${v}ms` },
    { title: "请求", dataIndex: "requests", key: "requests" },
    { title: "成功", dataIndex: "success", key: "success", render: (v: number) => <Tag color="green">{v}</Tag> },
    { title: "错误", dataIndex: "error", key: "error", render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <Tag>0</Tag> },
    { title: "状态", key: "status", render: (_: any, r: ApiHealth) => r.error > 0 ? <Tag color="warning">⚠</Tag> : <Tag color="success">🟢</Tag> },
  ];

  // ── Stats ──
  const totalApis = apiHealths.length;
  const avgLatency = totalApis ? Math.round(apiHealths.reduce((s, a) => s + a.avg_upstream_latency, 0) / totalApis) : 0;
  const totalRequests = apiHealths.reduce((s, a) => s + a.requests, 0);

  return (
    <div style={{ padding: 24 }}>
      {/* Health Banner */}
      <Card style={{ marginBottom: 16 }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Space>
              <Tag color={hello?.status === "pass" ? "green" : "red"}>
                {hello?.status === "pass" ? "● 运行中" : "● 异常"}
              </Tag>
              <Text strong>Tyk Gateway {hello?.version || "—"}</Text>
              <Tag color={hello?.details?.redis?.status === "pass" ? "green" : "red"}>
                Redis: {hello?.details?.redis?.status === "pass" ? "✅" : "❌"}
              </Tag>
              {reloadTime && <Text type="secondary">上次 reload: {reloadTime} (共 {reloadCount} 次)</Text>}
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={handleReload} type="primary">
              一键重载
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Pending changes banner */}
      {pendingChanges > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${pendingChanges} 项未生效的更改`}
          description={
            <Button size="small" type="primary" onClick={handleReload}>
              <SyncOutlined /> 点击应用所有更改
            </Button>
          }
          style={{ marginBottom: 16 }}
          closable
        />
      )}

      {/* Auto-reload control */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Switch checked={autoReloadEnabled} onChange={handleToggleAutoReload} />
          <Text>自动 reload</Text>
          <PauseCircleOutlined style={{ opacity: autoReloadEnabled ? 0.5 : 1 }} />
          <Text type="secondary">{autoReloadEnabled ? "每次修改后自动重载" : "暂停中，修改不会立即生效"}</Text>
        </Space>
      </Card>

      {/* Global Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="API 总数" value={totalApis} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均延迟" value={avgLatency} suffix="ms" /></Card></Col>
        <Col span={6}><Card><Statistic title="总请求数" value={totalRequests} /></Card></Col>
        <Col span={6}><Card><Statistic title="Reload 次数" value={reloadCount} /></Card></Col>
      </Row>

      {/* Refresh control */}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={fetchHealth}>手动刷新</Button>
        <Text>自动刷新</Text>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
        {autoRefresh && <Text type="secondary">每 {refreshInterval}s</Text>}
      </Space>

      {/* Health Table */}
      <Card title="API 运行状态（前 10 个）">
        {loading ? (
          <Spin tip="加载中..." />
        ) : (
          <Table
            dataSource={apiHealths}
            columns={columns}
            rowKey="api_id"
            pagination={false}
            size="small"
          />
        )}
      </Card>
    </div>
  );
}
