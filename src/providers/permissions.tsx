/**
 * 角色与权限系统（Phase 2）
 *
 * 从 JWT payload 读取 biz_role，提供 role check hooks 和路由守卫组件。
 *
 * @module providers/permissions
 */

import { getPayload, type JwtPayload } from './jwt';
import { useMemo } from 'react';
import { Navigate } from 'react-router';
import { message } from 'antd';

export const ROLES = [
  'system_admin',
  'security_admin',
  'audit_admin',
  'business_user',
  'viewer',
] as const;

export type BizRole = (typeof ROLES)[number];

/** 从当前 JWT 获取 biz_role（不依赖 React hooks，可在纯函数中使用） */
export function getBizRole(): BizRole | null {
  const payload: JwtPayload | null = getPayload();
  return (payload?.biz_role as BizRole) ?? null;
}

/** React hook：当前用户的 biz_role */
export function useBizRole(): BizRole | null {
  return useMemo(() => getBizRole(), []);
}

/** React hook：检查当前用户是否属于指定角色之一 */
export function useIsRole(...roles: BizRole[]): boolean {
  const role = useBizRole();
  return role !== null && roles.includes(role);
}

/** React hook：结构化权限对象，方便组件内一次调用 */
export function usePermissions() {
  const role = useBizRole();
  return useMemo(
    () => ({
      role,
      canAccess: (...allowed: BizRole[]) => role !== null && allowed.includes(role),
      isSystemAdmin: role === 'system_admin',
      isSecurityAdmin: role === 'security_admin',
      isAuditAdmin: role === 'audit_admin',
      isBusinessUser: role === 'business_user',
      isViewer: role === 'viewer',
    }),
    [role],
  );
}

/**
 * 路由守卫：仅允许指定角色访问，否则重定向并提示
 *
 * 用法：
 * <RequireRole roles={['system_admin']}>
 *   <SomePage />
 * </RequireRole>
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: BizRole[];
  children: React.ReactNode;
}) {
  const role = useBizRole();
  if (!role || !roles.includes(role)) {
    message.warning('无权访问该页面');
    const fallback = role
      ? role === 'system_admin' || role === 'security_admin'
        ? '/'
        : '/business'
      : '/login';
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}

/** 快捷组件：仅对 viewer 隐藏内容（常用于按钮） */
export function HideFromViewer({ children }: { children: React.ReactNode }) {
  const isViewer = useIsRole('viewer');
  return isViewer ? null : <>{children}</>;
}
