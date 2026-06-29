/** 生成随机 state（防 CSRF） */
export function generateState(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * 生成 PKCE code_verifier（RFC 7636 §4.1）
 * 使用 crypto.getRandomValues 生成 32 字节随机数，Base64URL 编码后得到 43 字符的字符串
 */
export function generateCodeVerifier(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * 计算 PKCE code_challenge（RFC 7636 §4.2）
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 * 使用 Web Crypto API（SubtleCrypto），浏览器原生支持，无需额外依赖
 */
export async function computeCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
