/**
 * 本地解析 JWT，判断 Token 是否已过期
 * JWT 格式：header.payload.signature，payload 是 base64url 编码的 JSON
 * 提前 30 秒判定为过期，留出刷新缓冲时间
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return true;
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (!payload.exp) return false;
    return Date.now() / 1000 >= payload.exp - 30;
  } catch {
    return true;
  }
}
