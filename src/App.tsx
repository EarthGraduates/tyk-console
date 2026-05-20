/**
 * ichse-asset-share-center — Tyk 网关管理界面 (v1)
 *
 * ## 架构概览
 * ```
 * Refine UI (浏览器)
 *   ├── Data Provider → Tyk Gateway API (直连，x-tyk-authorization)
 *   │     apis CRUD / keys CRUD / health / reload
 *   └── Docker 管理服务 (dockerode, :3001)
 *         容器启停 / 状态查询
 * ```
 *
 * ## 技术栈
 * - Refine v5 + Ant Design v5 + React 19
 * - Supabase Auth（登录控制）
 * - Vite（开发代理 /tyk/* → :8080，/hello → :8080）
 * - TypeScript（阿里前端规约）
 *
 * ## 数据源
 * - `default` provider → Supabase（用户认证）
 * - `tyk` provider → Tyk Gateway（apis、keys CRUD）
 *
 * ## 降级策略
 * - Docker 管理服务不可达：网关管理页按钮灰色 + Alert，其他页面不受影响
 * - Tyk Gateway 不可达：全局 Banner 提示 + 15s 自动重试
 *
 * @module App
 */

import { Refine, WelcomePage } from '@refinedev/core';
import { DevtoolsPanel, DevtoolsProvider } from '@refinedev/devtools';
import { RefineKbar, RefineKbarProvider } from '@refinedev/kbar';

import { useNotificationProvider } from '@refinedev/antd';
import '@refinedev/antd/dist/reset.css';

import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from '@refinedev/react-router';
import { liveProvider } from '@refinedev/supabase';
import { App as AntdApp, Menu } from 'antd';
import {
  DashboardOutlined, ApiOutlined, KeyOutlined, SettingOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Route, Routes, useNavigate, useLocation } from 'react-router';
import { useState } from 'react';
import { ColorModeContextProvider } from './contexts/color-mode';
import authProvider from './providers/auth';
import { dataProviderMap } from './providers/data';
import { supabaseClient } from './providers/supabase-client';
import Dashboard from './pages/dashboard';
import SettingsPage from './pages/settings';
import GatewayPage from './pages/gateway';
import { ApiList } from './pages/apis';
import KeyList from './pages/keys';

const SIDER_WIDTH = 200;
const SIDER_COLLAPSED_WIDTH = 80;

/**
 * 应用主布局（侧边栏 + 内容区）
 * - 左侧浅色侧边栏：可折叠，5 个菜单项
 * - 右侧 Content：浅灰背景 #f5f5f5
 */
function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH;

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
          selectedKeys={[location.pathname.split('/')[1] ? `/${location.pathname.split('/')[1]}` : '/']}
          items={[
            { key: '/', icon: <DashboardOutlined />, label: '仪表板' },
            { key: '/gateway', icon: <CloudServerOutlined />, label: '网关' },
            { key: '/apis', icon: <ApiOutlined />, label: '服务' },
            { key: '/keys', icon: <KeyOutlined />, label: '密钥' },
            { key: '/settings', icon: <SettingOutlined />, label: '设置' },
          ]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', background: 'transparent', flex: 1 }}
        />
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

/**
 * 应用入口
 *
 * ## Provider 配置
 * - dataProvider：双数据源（default: Supabase, tyk: Tyk Gateway）
 * - authProvider：Supabase Auth（邮箱/密码登录）
 * - routerProvider：react-router v7
 *
 * ## 资源注册
 * - apis → tyk data provider（useList/useCreate 挂钩）
 * - keys → tyk data provider（同上）
 *
 * ## 路由表
 * | 路径         | 页面        |
 * |-------------|------------|
 * | /           | 仪表板      |
 * | /gateway    | 网关管理    |
 * | /apis       | API 列表    |
 * | /apis/:id   | API 详情    |
 * | /keys       | 密钥管理    |
 * | /settings   | 网关配置    |
 * | /login      | 登录页      |
 */
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
                liveProvider={liveProvider(supabaseClient)}
                authProvider={authProvider}
                routerProvider={routerProvider}
                resources={[
                  { name: 'apis', meta: { dataProviderName: 'tyk' } },
                  { name: 'keys', meta: { dataProviderName: 'tyk' } },
                ]}
                options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, projectId: 'Xo459U-5agjM8-PTCSc7' }}
              >
                <Routes>
                  <Route path="/login" element={<WelcomePage />} />
                  <Route
                    path="*"
                    element={
                      <AppLayout>
                        <Routes>
                          <Route index element={<Dashboard />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="/gateway" element={<GatewayPage />} />
                          <Route path="/apis" element={<ApiList />} />
                          <Route path="/keys" element={<KeyList />} />
                        </Routes>
                      </AppLayout>
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
