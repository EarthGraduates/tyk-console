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
  UserOutlined, AuditOutlined, SafetyOutlined, BarChartOutlined,
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
import { ApiList } from './pages/apis';
import KeyList from './pages/keys';
import ApiRecords from './pages/api-records';
import UsersPage from './pages/users';
import AuditPage from './pages/audit';
import SecurityPage from './pages/security';
import LoginPage from './pages/login';

const SIDER_WIDTH = 200;
const SIDER_COLLAPSED_WIDTH = 80;

interface MenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  allowedRoles: BizRole[];
}

/** 全量菜单定义，每个菜单项声明允许的角色 */
const ALL_MENU_ITEMS: MenuItem[] = [
  { key: '/',            icon: <DashboardOutlined />,    label: '系统仪表板',  allowedRoles: ['system_admin', 'security_admin'] },
  { key: '/business',    icon: <BarChartOutlined />,      label: '业务仪表板',  allowedRoles: ['audit_admin', 'business_user', 'viewer'] },
  { key: '/gateway',     icon: <CloudServerOutlined />,   label: '网关管理',    allowedRoles: ['system_admin'] },
  { key: '/apis',        icon: <ApiOutlined />,           label: 'API 服务',    allowedRoles: ['system_admin', 'business_user'] },
  { key: '/keys',        icon: <KeyOutlined />,           label: '密钥管理',     allowedRoles: ['system_admin', 'business_user'] },
  { key: '/api-records', icon: <HistoryOutlined />,       label: '历史记录',    allowedRoles: ['system_admin', 'security_admin', 'audit_admin', 'business_user', 'viewer'] },
  { key: '/users',       icon: <UserOutlined />,          label: '用户管理',     allowedRoles: ['system_admin', 'security_admin'] },
  { key: '/audit',       icon: <AuditOutlined />,         label: '审计日志',    allowedRoles: ['system_admin', 'audit_admin'] },
  { key: '/security',    icon: <SafetyOutlined />,        label: '安全策略',    allowedRoles: ['security_admin'] },
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

  // 按角色过滤菜单项
  const menuItems = useMemo(
    () =>
      ALL_MENU_ITEMS
        .filter(item => role && item.allowedRoles.includes(role))
        .map(({ key, icon, label }) => ({ key, icon, label })),
    [role],
  );

  // selectedKeys: 精确匹配或取第一段
  const pathFirst = `/${location.pathname.split('/')[1]}`;
  const selectedKey = menuItems.some(m => m.key === location.pathname)
    ? location.pathname
    : pathFirst;

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
                            <Route path="/keys" element={<RequireRole roles={['system_admin', 'business_user']}><KeyList /></RequireRole>} />
                            <Route path="/api-records" element={<ApiRecords />} />
                            <Route path="/users" element={<RequireRole roles={['system_admin', 'security_admin']}><UsersPage /></RequireRole>} />
                            <Route path="/audit" element={<RequireRole roles={['system_admin', 'audit_admin']}><AuditPage /></RequireRole>} />
                            <Route path="/security" element={<RequireRole roles={['security_admin']}><SecurityPage /></RequireRole>} />
                            <Route path="/settings" element={<SettingsPage />} />
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
