/**
 * 网关仪表板页面
 *
 * @description
 * 展示 Tyk Gateway 的整体运行状态，包含：
 * - 网关健康卡片（版本号、Redis 连通性）
 * - 全局统计卡片（API 总数、平均延迟、请求速率、Reload 次数）
 * - API 运行状态表格（分页 + 搜索 + 排序 + health 懒加载）
 * - 一键重载按钮 + 重载计数器
 * - 暂停自动重载开关 + 未生效更改 banner
 * - 手动/自动刷新控制
 *
 * ## health 懒加载策略
 * - 首次列出全部 API（名称、ID 立即可见）
 * - 仅对当前分页可见行，逐条串行调 /tyk/health/
 * - 拿到一条回填一行，翻页时复用缓存
 * - 手动/自动刷新时清缓存重新加载
 *
 * @component
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Statistic, Row, Col, Table, Tag, Button, Switch,
  Space, Typography, Spin, Alert, Input,
} from 'antd';
import { ReloadOutlined, PauseCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { getGatewayUrl, getSecret } from '../../providers/tyk-data-provider';

const { Text } = Typography;

interface TykHello {
  status: string;
  version: string;
  details: { redis: { status: string } };
}

interface ApiBase {
  api_id: string;
  name: string;
  active: boolean;
}

interface ApiHealth extends ApiBase {
  avg_upstream_latency: number | null;
  requests: number | null;
}

async function tykGet(path: string) {
  const h: Record<string, string> = {};
  const s = getSecret();
  if (s) h['x-tyk-authorization'] = s;
  const r = await fetch(`${getGatewayUrl()}${path}`, { headers: h });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/**
 * 从 DB 获取已禁用的 API ID 集合
 * 用于交叉校验仪表盘 API 列表，过滤掉已停用但仍存在于 Tyk 的 API。
 * DB 不可达时返回空 Set（降级为全部展示）。
 */
async function fetchInactiveApiIds(): Promise<Set<string>> {
  try {
    const res = await fetch('/db/api_definitions?status=eq.inactive&select=api_id');
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set((data || []).map((r: any) => r.api_id));
  } catch {
    return new Set();
  }
}

const RELOAD_KEY = 'tyk_reload_count';
const RELOAD_TIME_KEY = 'tyk_reload_time';

export default function Dashboard() {
  // ── 网关状态 ──
  const [hello, setHello] = useState<TykHello | null>(null);
  const [apiList, setApiList] = useState<ApiBase[]>([]);
  const [healthCache, setHealthCache] = useState<Map<string, { latency: number; rps: number }>>(
    new Map(),
  );
  const [healthLoadingIds, setHealthLoadingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // ── 轮询控制 ──
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval] = useState(10);
  const refreshFlag = useRef(0);

  // ── Reload 追踪 ──
  const [reloadCount, setReloadCount] = useState(Number(localStorage.getItem(RELOAD_KEY) || 0));
  const [reloadTime, setReloadTime] = useState(localStorage.getItem(RELOAD_TIME_KEY) || '');

  // ── 自动 reload 开关 ──
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() =>
    localStorage.getItem('tyk_auto_reload') !== 'false');
  const [pendingChanges, setPendingChanges] = useState(0);

  /**
   * 加载 API 列表（不含 health）
   * - GET /hello → 网关状态
   * - GET /tyk/apis/ → 全部 API 基本信息
   * - 清空 health 缓存，触发当前页 health 加载
   */
  const fetchApiList = useCallback(async () => {
    setLoading(true);
    try {
      const h = await tykGet('/hello');
      setHello(h);
      const apis: ApiBase[] = (await tykGet('/tyk/apis/')) || [];
      // 交叉校验 DB 中停用的 API，过滤掉已停用但仍存在于 Tyk 的记录
      const inactiveIds = await fetchInactiveApiIds();
      const filtered = inactiveIds.size > 0
        ? apis.filter((a) => !inactiveIds.has(a.api_id))
        : apis;
      setApiList(filtered);
      setHealthCache(new Map());
    } catch {
      // 网关不可达
    }
    setLoading(false);
  }, []);

  // 首次加载
  useEffect(() => { fetchApiList(); }, [fetchApiList]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      refreshFlag.current += 1;
      fetchApiList();
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchApiList]);

  // 手动刷新
  const handleManualRefresh = () => {
    refreshFlag.current += 1;
    fetchApiList();
  };

  /**
   * 一键重载 Tyk Gateway
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
      fetchApiList();
    } catch {
      // reload 失败静默处理
    }
  };

  const handleToggleAutoReload = (v: boolean) => {
    setAutoReloadEnabled(v);
    localStorage.setItem('tyk_auto_reload', String(v));
  };

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

  // ── health 懒加载：逐条串行加载当前页 API 的 health 数据 ──
  const loadHealthForIds = useCallback(async (ids: string[]) => {
    setHealthLoadingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });

    for (const id of ids) {
      try {
        const health = await tykGet(`/tyk/health/?api_id=${id}`);
        if (health) {
          setHealthCache((prev) => {
            const next = new Map(prev);
            next.set(id, {
              latency: health.average_upstream_latency || 0,
              rps: health.average_requests_per_second || 0,
            });
            return next;
          });
        }
      } catch {
        // 单个 health 失败不影响
      }
      setHealthLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  // ── 组合数据源：apiList + healthCache → 带 health 的完整数据 ──
  const fullDataSource: ApiHealth[] = useMemo(() => {
    return apiList.map((api) => {
      const h = healthCache.get(api.api_id);
      return {
        ...api,
        avg_upstream_latency: h ? h.latency : null,
        requests: h ? h.rps : null,
      };
    });
  }, [apiList, healthCache]);

  // ── 搜索过滤 ──
  const filteredData = useMemo(() => {
    if (!searchText.trim()) return fullDataSource;
    const s = searchText.toLowerCase();
    return fullDataSource.filter((r) =>
      (r.name || '').toLowerCase().includes(s)
      || (r.api_id || '').toLowerCase().includes(s));
  }, [fullDataSource, searchText]);

  // ── 表格列定义 ──
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'API ID', dataIndex: 'api_id', key: 'api_id', ellipsis: true },
    {
      title: '延迟',
      dataIndex: 'avg_upstream_latency',
      key: 'latency',
      sorter: (a: ApiHealth, b: ApiHealth) =>
        (a.avg_upstream_latency || 0) - (b.avg_upstream_latency || 0),
      render: (v: number | null, r: ApiHealth) => {
        if (healthLoadingIds.has(r.api_id)) return <Spin size="small" />;
        if (v != null) return `${Math.round(v)}ms`;
        return '--';
      },
    },
    {
      title: '请求速率',
      dataIndex: 'requests',
      key: 'requests',
      sorter: (a: ApiHealth, b: ApiHealth) => (a.requests || 0) - (b.requests || 0),
      render: (v: number | null, r: ApiHealth) => {
        if (healthLoadingIds.has(r.api_id)) return <Spin size="small" />;
        if (v != null) return `${v}/s`;
        return '--';
      },
    },
    {
      title: '状态',
      key: 'status',
      render: () => <Tag color="success">正常</Tag>,
    },
  ];

  // ── 当前页变化时，加载缺少 health 的行 ──
  useEffect(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageIds = filteredData.slice(start, end).map((a) => a.api_id);
    const missing = pageIds.filter((id) => !healthCache.has(id));
    if (missing.length > 0) loadHealthForIds(missing);
  }, [filteredData, currentPage, pageSize, healthCache, loadHealthForIds]);

  // ── 全局统计（仅统计已加载 health 的数据） ──
  const stats = useMemo(() => {
    const withHealth = fullDataSource.filter((a) => a.avg_upstream_latency != null);
    const count = withHealth.length;
    const totalLatency = withHealth.reduce((s, a) => s + (a.avg_upstream_latency || 0), 0);
    const totalRps = withHealth.reduce((s, a) => s + (a.requests || 0), 0);
    return {
      totalApis: apiList.length,
      avgLatency: count ? Math.round(totalLatency / count) : 0,
      totalRps: Math.round(totalRps * 10) / 10,
    };
  }, [fullDataSource, apiList.length]);

  // ── 统计受 refreshFlag/healthCache 变化影响 ──
  // （上面的 stats 已经依赖 healthCache via fullDataSource，这里不再额外处理）

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

      {/* 未生效更改 Banner */}
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
        <Col span={6}><Card><Statistic title="API 总数" value={stats.totalApis} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均延迟" value={stats.avgLatency} suffix="ms" /></Card></Col>
        <Col span={6}><Card><Statistic title="请求速率" value={stats.totalRps} suffix="/s" /></Card></Col>
        <Col span={6}><Card><Statistic title="Reload 次数" value={reloadCount} /></Card></Col>
      </Row>

      {/* 刷新控制 + 搜索 */}
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button
            icon={<ReloadOutlined spin={loading} />}
            onClick={handleManualRefresh}
          >手动刷新
          </Button>
          <Text>自动刷新</Text>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          {autoRefresh && <Text type="secondary">每 {refreshInterval}s</Text>}
        </Space>
        <Input.Search
          placeholder="搜索名称、API ID"
          allowClear
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 280 }}
        />
      </Space>

      {/* API 运行状态表格 */}
      <Card title="API 运行状态">
        <Table
          dataSource={filteredData}
          columns={columns}
          rowKey="api_id"
          loading={loading}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{
            current: currentPage,
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total: number) => `共 ${total} 条`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
          }}
        />
      </Card>
    </div>
  );
}
