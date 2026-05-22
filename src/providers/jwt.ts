/**
 * JWT 客户端工具（仅解码，不验证签名——签名验证由 PostgREST 负责）
 *
 * @module providers/jwt
 */

const TOKEN_KEY = 'ichse_jwt';

export interface JwtPayload {
  role: string;         // PG 角色（authenticated）
  sub: string;          // user_id (UUID)
  biz_role: string;     // 业务角色
  email: string | null;
  phone: string | null;
  display_name: string;
  secret_level: string;
  iat: number;
  exp: number;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 将 base64url 解码为 UTF-8 字符串
 *
 * atob 产出的二进制字符串在遇到中文等多字节 UTF-8 字符时，
 * raw bytes 无法被 JSON.parse 正确解析。
 * 必须通过 TextDecoder 做一次 UTF-8 解码。
 */
function base64urlDecode(str: string): string {
  // base64url → standard base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    const clean = token.replace(/\s/g, '');
    const parts = clean.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

export function getPayload(): JwtPayload | null {
  const token = getToken();
  if (!token) return null;
  return decodeToken(token);
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return payload.exp * 1000 < Date.now();
}

export function getAuthHeader(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
