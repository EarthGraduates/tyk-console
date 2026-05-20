/**
 * 主题配置（品牌色 + 浅色主题）
 *
 * @description
 * - 品牌色：极光绿 #52c41a（医疗行业）
 * - 默认浅色模式，支持暗色切换
 * - 菜单、卡片等组件颜色统一通过 ConfigProvider 管理
 *
 * @module contexts/color-mode
 */

import { ConfigProvider, theme } from 'antd';
import { type PropsWithChildren, createContext, useEffect, useState } from 'react';

interface ColorModeContextType {
  mode: string;
  setMode: (mode: string) => void;
}

export const ColorModeContext = createContext<ColorModeContextType>(
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  {} as ColorModeContextType,
);

export const ColorModeContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const colorModeFromLocalStorage = localStorage.getItem('ichse-color-mode');
  const [mode, setMode] = useState(colorModeFromLocalStorage || 'light');

  useEffect(() => {
    window.localStorage.setItem('ichse-color-mode', mode);
  }, [mode]);

  const setColorMode = () => {
    if (mode === 'light') {
      setMode('dark');
    } else {
      setMode('light');
    }
  };

  const { darkAlgorithm, defaultAlgorithm } = theme;

  return (
    <ColorModeContext.Provider value={{ setMode: setColorMode, mode }}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'light' ? defaultAlgorithm : darkAlgorithm,
          token: {
            colorPrimary: '#52c41a',
          },
          components: {
            Menu: {
              itemBg: '#ffffff',
              itemColor: 'rgba(0,0,0,0.88)',
              itemHoverColor: '#52c41a',
              itemHoverBg: '#f6ffed',
              itemSelectedColor: '#52c41a',
              itemSelectedBg: '#f6ffed',
              subMenuItemBg: '#ffffff',
            },
            Card: {
              colorBgContainer: '#f6ffed',
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
