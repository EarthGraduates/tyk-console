/**
 * 顶部 Header 组件（Refine 脚手架模板代码，当前未使用）
 *
 * @description
 * Refine ThemedLayout 的 Header 组件，包含用户头像/姓名展示和亮暗模式切换开关。
 * 当前项目使用自定义 AppLayout（侧边栏模式），此组件未启用。
 *
 * @module components/header
 */

import type { RefineThemedLayoutHeaderProps } from '@refinedev/antd';
import { useGetIdentity } from '@refinedev/core';
import {
  Layout as AntdLayout,
  Avatar,
  Space,
  Switch,
  theme,
  Typography,
} from 'antd';
import React, { useContext } from 'react';
import { ColorModeContext } from '../../contexts/color-mode';

const { Text } = Typography;
const { useToken } = theme;

interface IUser {
  id: number;
  name: string;
  avatar: string;
}

export const Header: React.FC<RefineThemedLayoutHeaderProps> = ({
  sticky = true,
}) => {
  const { token } = useToken();
  const { data: user } = useGetIdentity<IUser>();
  const { mode, setMode } = useContext(ColorModeContext);

  const headerStyles: React.CSSProperties = {
    backgroundColor: token.colorBgElevated,
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: '0px 24px',
    height: '64px',
  };

  if (sticky) {
    headerStyles.position = 'sticky';
    headerStyles.top = 0;
    headerStyles.zIndex = 1;
  }

  return (
    <AntdLayout.Header style={headerStyles}>
      <Space>
        <Switch
          checkedChildren="🌛"
          unCheckedChildren="🔆"
          onChange={() => setMode(mode === 'light' ? 'dark' : 'light')}
          defaultChecked={mode === 'dark'}
        />
        <Space style={{ marginLeft: '8px' }} size="middle">
          {user?.name && <Text strong>{user.name}</Text>}
          {user?.avatar && <Avatar src={user?.avatar} alt={user?.name} />}
        </Space>
      </Space>
    </AntdLayout.Header>
  );
};
