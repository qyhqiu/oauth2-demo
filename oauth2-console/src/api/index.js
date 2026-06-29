import axios from 'axios';

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

// localStorage Key（与 auth.js 保持一致）
export const TOKEN_STORAGE_KEY = 'oauth2_console_token';
export const USER_STORAGE_KEY = 'oauth2_console_user';

const request = axios.create({
  baseURL: `${OAUTH2_SERVER}/v1/api/console`,
});

// 请求拦截器：自动注入 Bearer Token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401/403 时清空本地登录态并跳转登录页
request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const raw = err.response?.data || {};
    // 统一错误对象：兼容新格式 { code, data, message } 和旧格式 { error, error_description }
    const normalized = {
      ...raw,
      message: raw.message || raw.error_description || err.message || '请求失败',
      error_description: raw.message || raw.error_description || err.message || '请求失败',
    };
    // 仅当不是登录请求本身报 401 时才跳转，避免登录失败陷入循环
    if ((status === 401 || status === 403) && !err.config?.url?.includes('/admin/login')) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(normalized);
  },
);

// ==================== 管理员鉴权 ====================
export const adminLogin = (username, password) =>
  request.post('/admin/login', { username, password });
export const getCurrentAdmin = () => request.get('/admin/me');

// OAuth2 登录控制台
export const OAUTH2_SERVER_BASE = OAUTH2_SERVER;
export const getOAuth2Config = () => request.get('/admin/oauth2-config');
export const oauth2Exchange = (code, state) =>
  request.post('/admin/oauth2-exchange', { code, state });
// OAuth2 登录入口 URL（浏览器原生导航跳转，不能用 axios，因为要走 302 重定向链）
export const OAUTH2_LOGIN_ENTRY_URL = `${OAUTH2_SERVER}/v1/api/console/admin/oauth2-login`;

/**
 * 单点登出（全局登出）
 *
 * 调用 oauth2-server 的 POST /oauth/logout，触发：
 * 1) 撤销当前管理员在所有业务应用中的 access_token（其他应用下次请求即收到 401）
 * 2) 清空 oauth2-server 域下的 OAuth2 Session Cookie
 *
 * 实现细节：
 * - 直接走 fetch 而非 axios 实例：axios 实例的 baseURL 是 /api/console，且 401 拦截器会强制跳登录页，
 *   会与登出流程互相干扰
 * - credentials: 'include' 必须开启，否则带不上 oauth2-server 域（localhost:3000）的 OAuth2 Cookie，
 *   服务端就无法清掉 OAuth2 Session
 * - 失败不抛异常：哪怕后端不可达也允许前端继续清本地态，避免用户被"登出失败"卡住
 */
export async function oauth2GlobalLogout() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';

  // 在发起请求前先广播一条 oauth2-logout 消息，让同源页面（其它 Tab、当前页面的其它组件）
  // 立即进入"已登出"视觉状态，无需等待 oauth2-server 响应（请求失败也已广播过，不影响）
  broadcastOAuth2Logout('console.logout.request');

  try {
    const resp = await fetch(`${OAUTH2_SERVER}/v1/oauth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return await resp.json().catch(() => ({}));
  } catch (err) {
    console.warn('[oauth2GlobalLogout] 调用失败，继续执行本地清理:', err);
    return null;
  }
}

// ==================== OAuth2 登出广播（B+：响应式 badge）====================

/** BroadcastChannel 名称：与 SDK 内部 OAUTH2_LOGOUT_CHANNEL 保持一致，跨应用联动 */
export const OAUTH2_LOGOUT_CHANNEL_NAME = 'oauth2-logout';
/** localStorage key：作为 BroadcastChannel 不可用时的 storage 事件兜底 */
export const OAUTH2_LOGOUT_STORAGE_KEY = '__oauth2_logout_event__';

/**
 * 广播一条 oauth2-logout 消息，触发同源页面的登录态联动刷新
 *
 * 双通道发送，确保兼容性：
 * - BroadcastChannel：现代浏览器首选，同源 Tab 间实时收发
 * - localStorage 事件：BroadcastChannel 不可用时的兜底（Safari 旧版本 / 某些隐私模式）
 *
 * @param {string} reason 触发原因，便于调试（如 'console.logout.request' / 'auth.clear'）
 */
export function broadcastOAuth2Logout(reason = 'unknown') {
  const payload = { type: 'oauth2-logout', reason, timestamp: Date.now() };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(OAUTH2_LOGOUT_CHANNEL_NAME);
      ch.postMessage(payload);
      // 立即关闭，避免 Channel 句柄泄漏（订阅方有自己长期持有的 Channel）
      ch.close();
    }
  } catch (err) {
    console.warn('[broadcastOAuth2Logout] BroadcastChannel 发送失败:', err.message);
  }
  try {
    // 写入 localStorage 触发其它 Tab 的 storage 事件（同 Tab 不会触发自己的 storage）
    // 用时间戳作为 value 保证每次都不同，否则同样的值不会触发事件
    localStorage.setItem(OAUTH2_LOGOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // localStorage 满 / 隐私模式可能抛错，吞掉
    console.warn('[broadcastOAuth2Logout] storage 事件兜底失败:', err.message);
  }
}

/**
 * 反查 OAuth2 Session（参考 Authing trackSession 设计）
 *
 * 用途：控制台「应用切换器」展示「OAuth2 登录态 badge」—— 让管理员一眼看出
 * 当前是否能跳转免登录，而不是点了之后才发现要重新输密码。
 *
 * 实现细节：
 * - 直接 fetch oauth2-server 的 /cas/session（跨域），避免被 axios 实例的 401 拦截器误捕
 * - credentials:'include' 让浏览器跨域携带 oauth2_session Cookie
 * - 服务端永远 200，未登录 / 第三方 Cookie 被拦截 都返回 { session: null }
 * - 失败统一兜底为 { session: null }，UI 侧把所有"非 session=非空"都视为"未登录"
 *
 * @returns {Promise<{session: object|null, userInfo?: object}>}
 */
export async function trackOAuth2Session() {
  try {
    const resp = await fetch(`${OAUTH2_SERVER}/v1/cas/session`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return { session: null };
    return await resp.json();
  } catch (err) {
    console.warn('[trackOAuth2Session] 调用失败:', err.message);
    return { session: null };
  }
}

// ==================== 概览 ====================
export const getOverview = () => request.get('/overview');

// ==================== 应用管理 ====================
export const getApps = (params = {}) => request.get('/apps', { params });
export const getApp = (clientId) => request.get(`/apps/${clientId}`);
export const createApp = (data) => request.post('/apps', data);
export const updateApp = (clientId, data) => request.put(`/apps/${clientId}`, data);
export const deleteApp = (clientId) => request.delete(`/apps/${clientId}`);
export const getAppSummary = (clientId) => request.get(`/apps/${clientId}/summary`);
export const getAppLoggedInUsers = (clientId) => request.get(`/apps/${clientId}/logged-in-users`);
export const getLoginTrend = (clientId, days = 7) =>
  request.get(`/apps/${clientId}/login-trend`, { params: { days } });
export const getLoginLogs = (clientId, params = {}) =>
  request.get(`/apps/${clientId}/login-logs`, { params });
export const unlockUser = (clientId, userId) =>
  request.post(`/apps/${clientId}/unlock-user`, { userId });

/**
 * 登录地理分布（支持下钻）
 * @param {string} clientId
 * @param {object} opts
 * @param {number} [opts.days=30] 时间窗口（天）
 * @param {'country'|'region'} [opts.level='country'] country=按国家聚合（世界地图）；region=按子区域聚合（下钻）
 * @param {string} [opts.country] level=region 时必填（典型：'CN' 取中国省级数据）
 */
export const getLoginGeo = (clientId, opts = {}) => {
  const {
    days = 30,
    level = 'country',
    country,
  } = typeof opts === 'number' ? { days: opts } : opts;
  return request.get(`/apps/${clientId}/login-geo`, {
    params: { days, level, ...(country ? { country } : {}) },
  });
};

// ==================== 应用访问控制 ====================
export const getAppAccessControlList = (clientId, params = {}) =>
  request.get(`/apps/${clientId}/access-control`, { params });
export const addAppAccessControlItem = (clientId, data) =>
  request.post(`/apps/${clientId}/access-control`, data);
export const updateAppAccessControlItem = (clientId, itemId, data) =>
  request.put(`/apps/${clientId}/access-control/${itemId}`, data);
export const deleteAppAccessControlItem = (clientId, itemId) =>
  request.delete(`/apps/${clientId}/access-control/${itemId}`);
export const updateAppDefaultPermission = (clientId, defaultPermission) =>
  request.put(`/apps/${clientId}/default-permission`, { defaultPermission });

/**
 * 已注册业务应用清单（用于控制台导航栏「应用切换器」）
 * 返回的应用已自动排除控制台自身和被禁用的应用
 */
export const getOAuth2Apps = () => request.get('/admin/oauth2-apps');

/**
 * 导出审计日志 XLSX - 拼接带 token 的下载 URL
 * 因 axios 拦截器把 401/403 强制跳转登录页，且 XLSX 是浏览器原生下载，不走 axios，
 * 这里返回带查询参数的完整下载 URL 由调用方用 a 标签触发下载。
 *
 * 注意：浏览器 a[download] 不会自动带 Authorization 请求头，所以把 token 作为 query 传，
 * 后端中间件需要兼容从 query 读取（仅在导出端点放行，最小化攻击面）。
 */
export const buildExportLogsUrl = (clientId, { status, startDate, endDate } = {}) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  params.set('access_token', token);
  return `${OAUTH2_SERVER}/v1/api/console/apps/${clientId}/login-logs/export?${params.toString()}`;
};

// ==================== 用户管理 ====================
export const getUsers = (params = {}) => request.get('/users', { params });
export const getUser = (userId) => request.get(`/users/${userId}`);
export const createUser = (data) => request.post('/users', data);
export const updateUser = (userId, data) => request.put(`/users/${userId}`, data);
export const deleteUser = (userId) => request.delete(`/users/${userId}`);
export const forceLogout = (userId) => request.post(`/users/${userId}/force-logout`);
export const getUserSessions = (userId) => request.get(`/users/${userId}/sessions`);
export const getUserSessionsBatch = () => request.get('/users/sessions/batch');

// 账号状态操作
export const lockUser = (userId) => request.post(`/users/${userId}/lock`);
export const unlockUserAccount = (userId) => request.post(`/users/${userId}/unlock`);
export const disableUser = (userId) => request.post(`/users/${userId}/disable`);
export const enableUser = (userId) => request.post(`/users/${userId}/enable`);

// 重置密码
export const resetUserPassword = (userId, password) =>
  request.post(`/users/${userId}/reset-password`, { password });

// 用户登录历史 / 登录过的应用
export const getUserLoginHistory = (userId, params = {}) =>
  request.get(`/users/${userId}/login-history`, { params });
export const getUserLoginApps = (userId) => request.get(`/users/${userId}/login-apps`);

// 批量导入用户
export const importUsers = (users) => request.post('/users/import', { users });

// 下载用户导入模板
export const getImportTemplateUrl = () => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  return `${OAUTH2_SERVER}/v1/api/console/users/import-template?access_token=${token}`;
};

// 批量导出用户 XLSX（通过 axios 请求 blob，复用 request 实例自动带 Bearer Token）
export const exportUsersBlob = async () => {
  const resp = await request.get('/users/export', { responseType: 'blob' });
  return resp;
};

// 创建用户时发送验证码（手机号创建前置校验）
export const sendCreateUserCode = (channel, target) =>
  request.post('/users/send-create-code', { channel, target });

// ==================== 组织架构 ====================
export const getOrgTree = () => request.get('/orgs/tree');
export const getOrgList = () => request.get('/orgs');
export const createOrg = (data) => request.post('/orgs', data);
export const updateOrg = (orgId, data) => request.put(`/orgs/${orgId}`, data);
export const deleteOrg = (orgId) => request.delete(`/orgs/${orgId}`);
export const getOrgMembers = (orgId) => request.get(`/orgs/${orgId}/members`);
export const addOrgMembers = (orgId, userIds) =>
  request.post(`/orgs/${orgId}/members`, { userIds });
export const removeOrgMembers = (orgId, userIds) =>
  request.delete(`/orgs/${orgId}/members`, { data: { userIds } });

// ==================== 分组管理 ====================
export const getGroups = (params = {}) => request.get('/groups', { params });
export const getGroup = (groupId) => request.get(`/groups/${groupId}`);
export const createGroup = (data) => request.post('/groups', data);
export const updateGroup = (groupId, data) => request.put(`/groups/${groupId}`, data);
export const deleteGroup = (groupId) => request.delete(`/groups/${groupId}`);
export const getGroupMembers = (groupId) => request.get(`/groups/${groupId}/members`);
export const addGroupMembers = (groupId, userIds) =>
  request.post(`/groups/${groupId}/members`, { userIds });
export const removeGroupMembers = (groupId, userIds) =>
  request.delete(`/groups/${groupId}/members`, { data: { userIds } });
export const authorizeGroupApps = (groupId, clientIds) =>
  request.post(`/groups/${groupId}/authorize`, { clientIds });
export const revokeGroupApps = (groupId, clientIds) =>
  request.delete(`/groups/${groupId}/authorize`, { data: { clientIds } });

// ==================== 验证码 / 绑定换绑 ====================
export const sendUserVerifyCode = (userId, channel, target, purpose) =>
  request.post(`/users/${userId}/send-code`, { channel, target, purpose });
export const bindUserPhone = (userId, phone, code) =>
  request.post(`/users/${userId}/bind-phone`, { phone, code });
export const bindUserEmail = (userId, email, code) =>
  request.post(`/users/${userId}/bind-email`, { email, code });
export const unbindUserPhone = (userId) => request.post(`/users/${userId}/unbind-phone`);
export const unbindUserEmail = (userId) => request.post(`/users/${userId}/unbind-email`);

// ==================== MFA 多因素认证 ====================
export const toggleUserMfa = (userId, mfaEnabled, mfaChannel) =>
  request.put(`/users/${userId}/mfa`, { mfaEnabled, mfaChannel });

// ===== TOTP（Time-based OTP，认证器 App 通道） =====
// 三步绑定流程：
//   1) setup → 服务端生成密钥 + 二维码（暂存 Redis 5min）；前端用 <img> 显示二维码
//   2) 用户用 Google Authenticator/1Password 等 App 扫码后获得 6 位动态码
//   3) confirm → 提交动态码校验，校验通过才正式写库 + 解除 mfaChannel='totp' 的开启限制
// 解绑：unbind → 同时智能回退 mfaChannel（phone → email → 关 MFA）
export const setupUserTotp = (userId) => request.post(`/users/${userId}/totp/setup`);
export const confirmUserTotp = (userId, token) =>
  request.post(`/users/${userId}/totp/confirm`, { token });
export const unbindUserTotp = (userId) => request.post(`/users/${userId}/totp/unbind`);

// ==================== K2 / K5：系统配置（基础设置 + 限流） ====================
export const getSystemConfig = () => request.get('/system-config');
export const updateSystemConfig = (data) => request.put('/system-config', data);

// ==================== K3：App Secret ====================
export const refreshAppSecret = (clientId) => request.post(`/apps/${clientId}/refresh-secret`);

// ==================== 注册白名单 ====================
export const getWhitelistConfig = () => request.get('/whitelist/config');
export const updateWhitelistConfig = (data) => request.put('/whitelist/config', data);
export const getWhitelist = (params = {}) => request.get('/whitelist', { params });
export const addWhitelistItem = (data) => request.post('/whitelist', data);
export const batchImportWhitelist = (items) => request.post('/whitelist/batch', { items });
export const deleteWhitelistItem = (itemId) => request.delete(`/whitelist/${itemId}`);
export const batchDeleteWhitelist = (ids) => request.post('/whitelist/batch-delete', { ids });

// ==================== 社会化身份源 ====================
export const getSocialConnectionTypes = () => request.get('/social-connections/types');
export const getSocialConnections = () => request.get('/social-connections');
export const getSocialConnection = (connectionId) =>
  request.get(`/social-connections/${connectionId}`);
export const getSocialConnectionSecret = (connectionId) =>
  request.get(`/social-connections/${connectionId}/secret`);
export const createSocialConnection = (data) => request.post('/social-connections', data);
export const updateSocialConnection = (connectionId, data) =>
  request.put(`/social-connections/${connectionId}`, data);
export const deleteSocialConnection = (connectionId) =>
  request.delete(`/social-connections/${connectionId}`);
export const getLinkedApps = (connectionId) =>
  request.get(`/social-connections/${connectionId}/linked-apps`);
export const toggleLinkedApp = (connectionId, appId, linked) =>
  request.put(`/social-connections/${connectionId}/linked-apps/${appId}`, { linked });
