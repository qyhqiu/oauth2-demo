/** Cookie Key 名称 */
export const COOKIE_KEYS = {
  ACCESS_TOKEN: 'oauth2_access_token',
  REFRESH_TOKEN: 'oauth2_refresh_token',
} as const;

/** OAuth2 服务端默认地址（可通过 meta[name="oauth2-server-url"] 覆盖） */
export const OAUTH2_SERVER_URL = 'http://localhost:3000';

/** window 上挂载用户信息的 key（跨项目共享，无需 localStorage） */
export const WINDOW_USER_INFO_KEY = '__GLOBAL_USER_INFO__';

/** BroadcastChannel 频道名（同源标签页单点登出广播） */
export const OAUTH2_LOGOUT_CHANNEL = 'oauth2_logout_broadcast';

/** Cookie 过期时间（与服务端保持一致） */
export const ACCESS_TOKEN_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60; // 2 小时
export const REFRESH_TOKEN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 天

/** API 版本前缀 */
export const API_VERSION_PREFIX = '/v1';

/** CAS 风格端点（trackSession 设计） */
export const CAS_ENDPOINTS = {
  /** 反查当前 OAuth2 登录用户（GET，永远 200） */
  SESSION: `${API_VERSION_PREFIX}/cas/session`,
  /** 已登录用户静默换 code（GET，SameSite=Lax 限制下必须用 GET） */
  SILENT_AUTHORIZE: `${API_VERSION_PREFIX}/cas/silent-authorize`,
} as const;

/** trackSession / getSilentAccessToken 的网络超时（毫秒） */
export const TRACK_SESSION_TIMEOUT_MS = 3000;
