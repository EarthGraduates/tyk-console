/**
 * 应用入口
 *
 * @description
 * 挂载 Refine App 到 DOM，启用 React.StrictMode。
 *
 * @module index
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
