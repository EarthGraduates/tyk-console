/**
 * 主题颜色模式上下文（Refine 脚手架模板代码）
 *
 * @description
 * 提供亮色/暗色主题切换功能，自动检测系统偏好，持久化到 localStorage。
 * 当前项目使用自定义蓝色背景 (#0087f5)，主题切换仍可用。
 *
 * @module contexts/color-mode
 */

import { RefineThemes } from '@refinedev/antd';
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
  const colorModeFromLocalStorage = localStorage.getItem('colorMode');
  const isSystemPreferenceDark = window?.matchMedia('(prefers-color-scheme: dark)').matches;

  const systemPreference = isSystemPreferenceDark ? 'dark' : 'light';
  const [mode, setMode] = useState(colorModeFromLocalStorage || systemPreference);

  useEffect(() => {
    window.localStorage.setItem('colorMode', mode);
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
          ...RefineThemes.Blue,
          algorithm: mode === 'light' ? defaultAlgorithm : darkAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
