/**
 * JWT 认证 Provider（Phase 1 — 密码登录）
 *
 * 登录调用 PostgREST /rpc/login（内部用 pgjwt 签名），
 * 返回 JSONB { token }，前端 JSON.parse 后存 localStorage。
 *
 * @module providers/auth
 */

import type { AuthProvider } from '@refinedev/core';
import { getToken, setToken, removeToken, isTokenExpired, getPayload } from './jwt';

async function rpcLogin(payload: Record<string, unknown>): Promise<{ token: string }> {
  const url = new URL('/db/rpc/login', window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = '登录失败';
    try {
      const err = JSON.parse(text);
      message = err.message || message;
    } catch { /* use raw text */ }
    if (text && text.length < 200) message = text;
    throw new Error(message);
  }
  const data = JSON.parse(await res.text());
  return { token: data.token };
}

const authProvider: AuthProvider = {
  login: async ({ email, password, providerName }) => {
    if (providerName) {
      return { success: false, error: { name: 'Error', message: 'OAuth 暂不支持' } };
    }

    try {
      const { token } = await rpcLogin({
        p_login: email,
        p_password: password,
      });

      if (isTokenExpired(token)) {
        return { success: false, error: { name: 'Error', message: 'Token expired' } };
      }

      setToken(token);
      return { success: true, redirectTo: '/' };
    } catch (error: any) {
      return {
        success: false,
        error: { name: 'Login Failed', message: error.message || '登录失败' },
      };
    }
  },

  register: async () => ({
    success: false,
    error: { name: 'Not Supported', message: '注册功能暂未开放' },
  }),

  forgotPassword: async () => ({
    success: false,
    error: { name: 'Not Supported', message: '请联系管理员重置密码' },
  }),

  updatePassword: async () => ({
    success: false,
    error: { name: 'Not Supported', message: '密码修改暂未开放' },
  }),

  logout: async () => {
    removeToken();
    return { success: true, redirectTo: '/login' };
  },

  onError: async (error) => {
    console.error(error);
    return { error };
  },

  check: async () => {
    try {
      const token = getToken();
      if (!token || isTokenExpired(token)) {
        return {
          authenticated: false,
          error: { name: 'Unauthorized', message: '请先登录' },
          logout: true,
          redirectTo: '/login',
        };
      }
      return { authenticated: true };
    } catch (error: any) {
      console.error('[auth] check() failed:', error);
      return {
        authenticated: false,
        error: { name: 'Error', message: error?.message || '认证检查失败' },
        logout: true,
        redirectTo: '/login',
      };
    }
  },

  getPermissions: async () => {
    const payload = getPayload();
    return payload?.biz_role ?? null;
  },

  getIdentity: async () => {
    const payload = getPayload();
    if (!payload) return null;
    return {
      id: payload.sub,
      name: payload.display_name || payload.email || '',
      email: payload.email || '',
      phone: payload.phone || '',
      bizRole: payload.biz_role,
      secretLevel: payload.secret_level || '',
    };
  },
};

export default authProvider;
