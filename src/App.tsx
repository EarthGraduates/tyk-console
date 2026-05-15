import { Refine, WelcomePage } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import { useNotificationProvider } from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from "@refinedev/react-router";
import { liveProvider } from "@refinedev/supabase";
import { App as AntdApp, Layout, Menu } from "antd";
import { DashboardOutlined, ApiOutlined, KeyOutlined, SettingOutlined, CloudServerOutlined } from "@ant-design/icons";
import { BrowserRouter, Route, Routes, useNavigate, useLocation } from "react-router";
import { ColorModeContextProvider } from "./contexts/color-mode";
import authProvider from "./providers/auth";
import { dataProviderMap } from "./providers/data";
import { supabaseClient } from "./providers/supabase-client";
import Dashboard from "./pages/dashboard";
import SettingsPage from "./pages/settings";
import GatewayPage from "./pages/gateway";
import { ApiList, ApiShow } from "./pages/apis";
import KeyList from "./pages/keys";

const { Sider, Content } = Layout;

function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider collapsible>
        <div style={{ color: "white", textAlign: "center", padding: "16px 0", fontWeight: "bold" }}>ichse Tyk</div>
        <Menu
          theme="dark"
          selectedKeys={[location.pathname.split("/")[1] ? `/${location.pathname.split("/")[1]}` : "/"]}
          items={[
            { key: "/", icon: <DashboardOutlined />, label: "仪表板" },
            { key: "/gateway", icon: <CloudServerOutlined />, label: "网关" },
            { key: "/apis", icon: <ApiOutlined />, label: "服务" },
            { key: "/keys", icon: <KeyOutlined />, label: "密钥" },
            { key: "/settings", icon: <SettingOutlined />, label: "设置" },
          ]}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Content style={{ background: "#f5f5f5" }}>{children}</Content>
    </Layout>
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
                liveProvider={liveProvider(supabaseClient)}
                authProvider={authProvider}
                routerProvider={routerProvider}
                options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, projectId: "Xo459U-5agjM8-PTCSc7" }}
              >
                <Routes>
                  <Route path="/login" element={<WelcomePage />} />
                  <Route path="*" element={
                    <AppLayout>
                      <Routes>
                        <Route index element={<Dashboard />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/gateway" element={<GatewayPage />} />
                        <Route path="/apis" element={<ApiList />} />
                        <Route path="/apis/:id" element={<ApiShow />} />
                        <Route path="/keys" element={<KeyList />} />
                      </Routes>
                    </AppLayout>
                  } />
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
