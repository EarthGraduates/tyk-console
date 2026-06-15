/**
 * ichse-asset-share-center — Tyk 网关管理界面 (v1.1)
 *
 * ## 架构概览
 * ```
 * Refine UI (浏览器)
 *   ├── Data Provider → Tyk Gateway API (直连，x-tyk-authorization)
 *   │     apis CRUD / keys CRUD / health / reload
 *   ├── Data Provider → PostgreSQL via PostgREST
 *   │     api-records / users / audit_log
 *   └── Docker 管理服务 (dockerode, :3001)
 *         容器启停 / 状态查询
 * ```
 *
 * ## Phase 2: RBAC
 * - 5 角色菜单分流：system_admin / security_admin / audit_admin / business_user / viewer
 * - RequireRole 路由守卫
 * - 页内按钮权限控制
 *
 * @module App
 */

import { Refine, Authenticated, useLogout } from '@refinedev/core';
import { DevtoolsPanel, DevtoolsProvider } from '@refinedev/devtools';
import { RefineKbar, RefineKbarProvider } from '@refinedev/kbar';

import { useNotificationProvider } from '@refinedev/antd';
import '@refinedev/antd/dist/reset.css';

import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from '@refinedev/react-router';
import { App as AntdApp, Menu } from 'antd';
import {
  DashboardOutlined, ApiOutlined, KeyOutlined, SettingOutlined,
  CloudServerOutlined, HistoryOutlined, LogoutOutlined,
  UserOutlined, AuditOutlined, SafetyOutlined, SafetyCertificateOutlined, BarChartOutlined,
  ExperimentOutlined, DatabaseOutlined, FileAddOutlined, FileSearchOutlined,
  ScanOutlined, SearchOutlined, CloseCircleOutlined, FileTextOutlined,
  WarningOutlined, ToolOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Route, Routes, useNavigate, useLocation, Navigate } from 'react-router';
import { useState, useMemo } from 'react';
import { ColorModeContextProvider } from './contexts/color-mode';
import authProvider from './providers/auth';
import { dataProviderMap } from './providers/data';
import { useBizRole, RequireRole, type BizRole } from './providers/permissions';

import Dashboard from './pages/dashboard';
import BusinessDashboard from './pages/business';
import SettingsPage from './pages/settings';
import GatewayPage from './pages/gateway';
import ApiList from './pages/apis';
import InterfacesPage from './pages/interfaces';
import KeyList from './pages/keys';
import UsersPage from './pages/users';
import AuditPage from './pages/audit';
import SecurityPage from './pages/security';
import ValidationRulesPage from './pages/validation-rules';
import LoginPage from './pages/login';

// LAB business pages
import SampleTypesPage from './pages/business/lab/sample-types';
import RequestItemsPage from './pages/business/lab/request-items';
import TestItemsPage from './pages/business/lab/test-items';
import BioItemsPage from './pages/business/lab/bio-items';
import AntiItemsPage from './pages/business/lab/anti-items';
import ApplicationSubmitPage from './pages/business/lab/applications/submit';
import ApplicationReviewPage from './pages/business/lab/applications/review';
import SpecimenCollectPage from './pages/business/lab/specimens/collect';
import SpecimenReceivePage from './pages/business/lab/specimens/receive';
import SpecimenTrackingPage from './pages/business/lab/specimens/tracking';
import ReportListPage from './pages/business/lab/reports/list';
import ReportDetailPage from './pages/business/lab/reports/detail';
import FirstReviewListPage from './pages/business/lab/reviews/first-review-list';
import FirstReviewDetailPage from './pages/business/lab/reviews/first-review-detail';
import SecondReviewListPage from './pages/business/lab/reviews/second-review-list';
import SecondReviewDetailPage from './pages/business/lab/reviews/second-review-detail';
import CriticalValuesPage from './pages/business/lab/critical-values';
import QualityControlPage from './pages/business/lab/quality-control';
import DevicesPage from './pages/business/lab/devices';

const SIDER_WIDTH = 200;
const SIDER_COLLAPSED_WIDTH = 80;

interface MenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  allowedRoles: BizRole[];
  children?: MenuItem[];
}

/** 全量菜单定义，每个菜单项声明允许的角色 */
const ALL_MENU_ITEMS: MenuItem[] = [
  { key: '/',            icon: <DashboardOutlined />,    label: '系统仪表板',  allowedRoles: ['system_admin', 'security_admin'] },
  { key: '/business',    icon: <BarChartOutlined />,      label: '业务仪表板',  allowedRoles: ['audit_admin', 'business_user', 'viewer'] },
  // ── LAB 业务菜单 ──
  { key: '/business/lab', icon: <ExperimentOutlined />, label: '检验业务', allowedRoles: ['business_user', 'viewer'],
    children: [
      { key: 'lab-dict', icon: <DatabaseOutlined />, label: '主数据', allowedRoles: ['business_user', 'viewer'],
        children: [
          { key: '/business/lab/sample-types', icon: <DatabaseOutlined />, label: '样本类型字典', allowedRoles: ['business_user', 'viewer'] },
          { key: '/business/lab/request-items', icon: <DatabaseOutlined />, label: '检验项目字典', allowedRoles: ['business_user', 'viewer'] },
          { key: '/business/lab/test-items', icon: <DatabaseOutlined />, label: '报告项目字典', allowedRoles: ['business_user', 'viewer'] },
          { key: '/business/lab/bio-items', icon: <DatabaseOutlined />, label: '细菌字典', allowedRoles: ['business_user', 'viewer'] },
          { key: '/business/lab/anti-items', icon: <DatabaseOutlined />, label: '药敏字典', allowedRoles: ['business_user', 'viewer'] },
        ],
      },
      { key: 'lab-send', icon: <FileAddOutlined />, label: '标本送检', allowedRoles: ['business_user'],
        children: [
          { key: '/business/lab/applications/submit', icon: <FileAddOutlined />, label: '检验申请', allowedRoles: ['business_user'] },
          { key: '/business/lab/specimens/collect', icon: <ScanOutlined />, label: '样本采集确认', allowedRoles: ['business_user'] },
        ],
      },
      { key: 'lab-review-app', icon: <FileSearchOutlined />, label: '申请受理', allowedRoles: ['business_user'],
        children: [
          { key: '/business/lab/applications/review', icon: <FileSearchOutlined />, label: '申请受理', allowedRoles: ['business_user'] },
        ],
      },
      { key: 'lab-receive', icon: <ScanOutlined />, label: '标本接收', allowedRoles: ['business_user'],
        children: [
          { key: '/business/lab/specimens/receive', icon: <ScanOutlined />, label: '标本接收登记', allowedRoles: ['business_user'] },
          { key: '/business/lab/specimens/tracking', icon: <SearchOutlined />, label: '标本状态跟踪', allowedRoles: ['business_user', 'viewer'] },
        ],
      },
      { key: 'lab-report-mgmt', icon: <FileTextOutlined />, label: '报告管理', allowedRoles: ['business_user', 'viewer'],
        children: [
          { key: '/business/lab/reports/list', icon: <FileTextOutlined />, label: '报告列表', allowedRoles: ['business_user', 'viewer'] },
          { key: '/business/lab/reviews/first-review', icon: <AuditOutlined />, label: '报告一审', allowedRoles: ['business_user'] },
          { key: '/business/lab/reviews/second-review', icon: <AuditOutlined />, label: '报告二审', allowedRoles: ['business_user'] },
        ],
      },
      { key: 'lab-quality', icon: <WarningOutlined />, label: '质量管理', allowedRoles: ['business_user'],
        children: [
          { key: '/business/lab/critical-values', icon: <WarningOutlined />, label: '危急值', allowedRoles: ['business_user'] },
          { key: '/business/lab/quality-control', icon: <ToolOutlined />, label: '质控数据', allowedRoles: ['business_user'] },
          { key: '/business/lab/devices', icon: <ToolOutlined />, label: '设备管理', allowedRoles: ['business_user'] },
        ],
      },
    ],
  },
  // ── 系统菜单 ──
  { key: '/gateway',     icon: <CloudServerOutlined />,   label: '网关管理',    allowedRoles: ['system_admin'] },
  { key: '/apis',        icon: <ApiOutlined />,           label: 'API 定义',    allowedRoles: ['system_admin', 'business_user'] },
  { key: '/interfaces',  icon: <HistoryOutlined />,       label: '接口管理',     allowedRoles: ['system_admin', 'security_admin', 'audit_admin', 'business_user', 'viewer'] },
  { key: '/keys',        icon: <KeyOutlined />,           label: '密钥管理',     allowedRoles: ['system_admin', 'business_user'] },
  { key: '/users',       icon: <UserOutlined />,          label: '用户管理',     allowedRoles: ['system_admin', 'security_admin'] },
  { key: '/audit',       icon: <AuditOutlined />,         label: '审计日志',    allowedRoles: ['system_admin', 'audit_admin'] },
  { key: '/security',    icon: <SafetyOutlined />,        label: '安全策略',    allowedRoles: ['security_admin'] },
  { key: '/validation-rules', icon: <SafetyCertificateOutlined />, label: '校验规则', allowedRoles: ['system_admin', 'security_admin'] },
  { key: '/settings',    icon: <SettingOutlined />,       label: '系统设置',    allowedRoles: ['system_admin', 'security_admin', 'audit_admin', 'business_user', 'viewer'] },
];

/**
 * 应用主布局（侧边栏 + 内容区）
 *
 * 侧边栏菜单根据当前用户角色自动过滤。
 */
function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { mutate: logout } = useLogout();
  const role = useBizRole();

  const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH;

  // 递归过滤菜单树：保留匹配角色的节点；父节点无可见子节点时隐藏
  function filterMenu(items: MenuItem[]): any[] {
    return items
      .filter(item => role && item.allowedRoles.includes(role))
      .map(({ key, icon, label, children }) => {
        if (children && children.length > 0) {
          const filteredChildren = filterMenu(children);
          if (filteredChildren.length === 0) return null;
          return { key, icon, label, children: filteredChildren };
        }
        return { key, icon, label };
      })
      .filter(Boolean);
  }

  const menuItems = useMemo(() => filterMenu(ALL_MENU_ITEMS), [role]);

  // selectedKeys: 精确匹配或最长前缀匹配
  const selectedKey = useMemo(() => {
    function collectKeys(items: any[]): string[] {
      const keys: string[] = [];
      for (const item of items) {
        keys.push(item.key);
        if (item.children) keys.push(...collectKeys(item.children));
      }
      return keys;
    }
    const allKeys = collectKeys(menuItems);
    // 精确匹配
    if (allKeys.includes(location.pathname)) return location.pathname;
    // 取最长前缀匹配（用于 /business/lab/reports/detail/:id 这类带参数的路由）
    const parts = location.pathname.split('/');
    while (parts.length > 1) {
      parts.pop();
      const prefix = parts.join('/') || '/';
      if (allKeys.includes(prefix)) return prefix;
    }
    return `/${location.pathname.split('/')[1]}`;
  }, [location.pathname, menuItems]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <div
        style={{
          width: siderWidth,
          minWidth: siderWidth,
          maxWidth: siderWidth,
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          transition: 'all 0.2s',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          color: 'rgba(0,0,0,0.88)',
          textAlign: 'center',
          padding: '16px 0',
          fontWeight: 'bold',
          fontSize: collapsed ? 12 : 16,
          transition: 'font-size 0.2s',
        }}
        >
          {collapsed ? 'iT' : 'ichse Tyk'}
        </div>
        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', background: 'transparent', flex: 1 }}
        />
        <div
          onClick={() => logout()}
          style={{
            textAlign: 'center',
            padding: '12px 0',
            cursor: 'pointer',
            color: 'rgba(0,0,0,0.45)',
            borderTop: '1px solid #f0f0f0',
            fontSize: collapsed ? 12 : 14,
          }}
        >
          <LogoutOutlined /> {collapsed ? '' : '退出登录'}
        </div>
        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            textAlign: 'center',
            padding: '12px 0',
            cursor: 'pointer',
            color: 'rgba(0,0,0,0.45)',
            borderTop: '1px solid #f0f0f0',
            fontSize: 16,
          }}
        >
          {collapsed ? '▶' : '◀'}
        </div>
      </div>
      <div style={{ flex: 1, background: '#f5f5f5', overflow: 'auto' }}>{children}</div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <AntdApp>
            <DevtoolsProvider>
              <Refine
                notificationProvider={useNotificationProvider}
                dataProvider={dataProviderMap}
                authProvider={authProvider}
                routerProvider={routerProvider}
                resources={[
                  { name: 'apis', meta: { dataProviderName: 'tyk' } },
                  { name: 'keys', meta: { dataProviderName: 'tyk' } },
                  { name: 'api-records', meta: { dataProviderName: 'ichseDb' } },
                ]}
                options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, projectId: 'Xo459U-5agjM8-PTCSc7' }}
              >
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route
                    path="*"
                    element={
                      <Authenticated key="protected" fallback={<Navigate to="/login" />}>
                        <AppLayout>
                          <Routes>
                            <Route index element={<RequireRole roles={['system_admin', 'security_admin']}><Dashboard /></RequireRole>} />
                            <Route path="/business" element={<RequireRole roles={['audit_admin', 'business_user', 'viewer']}><BusinessDashboard /></RequireRole>} />
                            <Route path="/gateway" element={<RequireRole roles={['system_admin']}><GatewayPage /></RequireRole>} />
                            <Route path="/apis" element={<RequireRole roles={['system_admin', 'business_user']}><ApiList /></RequireRole>} />
                            <Route path="/interfaces" element={<RequireRole roles={['system_admin', 'security_admin', 'audit_admin', 'business_user', 'viewer']}><InterfacesPage /></RequireRole>} />
                            <Route path="/keys" element={<RequireRole roles={['system_admin', 'business_user']}><KeyList /></RequireRole>} />
                            <Route path="/users" element={<RequireRole roles={['system_admin', 'security_admin']}><UsersPage /></RequireRole>} />
                            <Route path="/audit" element={<RequireRole roles={['system_admin', 'audit_admin']}><AuditPage /></RequireRole>} />
                            <Route path="/security" element={<RequireRole roles={['security_admin']}><SecurityPage /></RequireRole>} />
                            <Route path="/validation-rules" element={<RequireRole roles={['system_admin', 'security_admin']}><ValidationRulesPage /></RequireRole>} />
                            <Route path="/settings" element={<SettingsPage />} />
                            {/* ── LAB 业务路由 ── */}
                            <Route path="/business/lab/sample-types" element={<RequireRole roles={['business_user', 'viewer']}><SampleTypesPage /></RequireRole>} />
                            <Route path="/business/lab/request-items" element={<RequireRole roles={['business_user', 'viewer']}><RequestItemsPage /></RequireRole>} />
                            <Route path="/business/lab/test-items" element={<RequireRole roles={['business_user', 'viewer']}><TestItemsPage /></RequireRole>} />
                            <Route path="/business/lab/bio-items" element={<RequireRole roles={['business_user', 'viewer']}><BioItemsPage /></RequireRole>} />
                            <Route path="/business/lab/anti-items" element={<RequireRole roles={['business_user', 'viewer']}><AntiItemsPage /></RequireRole>} />
                            <Route path="/business/lab/applications/submit" element={<RequireRole roles={['business_user']}><ApplicationSubmitPage /></RequireRole>} />
                            <Route path="/business/lab/applications/review" element={<RequireRole roles={['business_user']}><ApplicationReviewPage /></RequireRole>} />
                            <Route path="/business/lab/specimens/collect" element={<RequireRole roles={['business_user']}><SpecimenCollectPage /></RequireRole>} />
                            <Route path="/business/lab/specimens/receive" element={<RequireRole roles={['business_user']}><SpecimenReceivePage /></RequireRole>} />
                            <Route path="/business/lab/specimens/tracking" element={<RequireRole roles={['business_user', 'viewer']}><SpecimenTrackingPage /></RequireRole>} />
                            <Route path="/business/lab/reports/list" element={<RequireRole roles={['business_user', 'viewer']}><ReportListPage /></RequireRole>} />
                            <Route path="/business/lab/reports/detail/:rptId" element={<RequireRole roles={['business_user', 'viewer']}><ReportDetailPage /></RequireRole>} />
                            <Route path="/business/lab/reviews/first-review" element={<RequireRole roles={['business_user']}><FirstReviewListPage /></RequireRole>} />
                            <Route path="/business/lab/reviews/first-review/:rptId" element={<RequireRole roles={['business_user']}><FirstReviewDetailPage /></RequireRole>} />
                            <Route path="/business/lab/reviews/second-review" element={<RequireRole roles={['business_user']}><SecondReviewListPage /></RequireRole>} />
                            <Route path="/business/lab/reviews/second-review/:rptId" element={<RequireRole roles={['business_user']}><SecondReviewDetailPage /></RequireRole>} />
                            <Route path="/business/lab/critical-values" element={<RequireRole roles={['business_user']}><CriticalValuesPage /></RequireRole>} />
                            <Route path="/business/lab/quality-control" element={<RequireRole roles={['business_user']}><QualityControlPage /></RequireRole>} />
                            <Route path="/business/lab/devices" element={<RequireRole roles={['business_user']}><DevicesPage /></RequireRole>} />
                          </Routes>
                        </AppLayout>
                      </Authenticated>
                  }
                  />
                </Routes>
                <RefineKbar />
                <UnsavedChangesNotifier />
                <DocumentTitleHandler />
              </Refine>
              <DevtoolsPanel />
            </DevtoolsProvider>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
