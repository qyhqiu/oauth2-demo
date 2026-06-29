import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, broadcastOAuth2Logout } from '../api';

/**
 * 控制台登录态本地缓存工具
 * - Token：长期保存在 localStorage（关闭浏览器仍生效，与 server 8h JWT TTL 一致）
 * - User：缓存基础信息（username/name/role）减少初始化时的 /admin/me 请求次数
 */

export function saveAuth(token, user) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  // 广播 oauth2-logout 让同源页面的 OAuth2 登录态 badge 立即变灰
  // 与 oauth2GlobalLogout 双重发送是冗余而非冲突：第一次广播时也许 fetch 还没开始，
  // 这里再广播一次保证即使 oauth2GlobalLogout 抛错也能触发 UI 联动
  broadcastOAuth2Logout('auth.clear');
}

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function getCachedUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return Boolean(getToken());
}
