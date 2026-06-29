import { OAuth2Client } from './OAuth2Client';
import { OAUTH2_SERVER_URL, WINDOW_USER_INFO_KEY, OAUTH2_LOGOUT_CHANNEL } from './constants';
import type { OAuth2ClientOptions, UserInfo } from './types';

// ==================== Script 标签引入模式（IIFE）====================

/**
 * 从 meta 标签读取配置项（可选）
 * 支持的 meta 标签：
 * - oauth2-server-url：OAuth2 服务端地址，默认 http://localhost:3000
 */
function getMeta(name: string): string | null {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.getAttribute('content') : null;
}

function buildLocalConfig(): OAuth2ClientOptions {
  const oauth2ServerUrl = getMeta('oauth2-server-url') || OAUTH2_SERVER_URL;
  const clientId = getMeta('oauth2-client-id') || '';
  const redirectUri = getMeta('oauth2-redirect-uri') || '';

  return {
    oauth2ServerUrl,
    clientId,
    redirectUri,
  };
}

/**
 * 创建 OAuth2Client 实例并挂载到 window（内部公共逻辑）
 */
function _createClient(config: OAuth2ClientOptions): OAuth2Client {
  const client = new OAuth2Client(config);

  window.__OAuth2ClientSDK__ = client;

  // SDK 内部自动处理登出：心跳检测 Token 过期 / BroadcastChannel 广播登出
  client.onLogout(() => {
    console.log('[OAuth2 SDK] 检测到登出，即将跳转登录页...');
    setTimeout(() => client.logout(), 800);
  });

  return client;
}

/**
 * 自动初始化：script 标签引入后自动完成 OAuth2 鉴权，业务应用无需任何额外配置。
 *
 * 使用方式：
 * ```html
 * <meta name="oauth2-server-url" content="http://your-oauth2-server.com" />
 * <script src="./oauth2-js-sdk.iife.js"></script>
 * ```
 *
 * 初始化完成后，以下全局变量可用：
 * - window.__OAuth2ClientSDK__       → OAuth2Client 实例
 * - window.__GLOBAL_USER_INFO__ → 当前登录用户信息
 * - window.__OAUTH2_PROMISE__      → 鉴权完成的 Promise
 */
(function autoInit() {
  let resolveOAuth2: (value: UserInfo | null) => void;
  window.__OAUTH2_PROMISE__ = new Promise<UserInfo | null>((resolve) => {
    resolveOAuth2 = resolve;
  });

  function tryInit(): void {
    const config = buildLocalConfig();
    console.log(`[OAuth2 SDK] 自动初始化，redirectUri: ${config.redirectUri}`);
    const client = _createClient(config);
    client.checkAuth().then(resolveOAuth2!).catch(resolveOAuth2!);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();

// ==================== 导出 ====================

export { OAuth2Client };
export default OAuth2Client;

export {
  OAuth2Error,
  AuthenticationError,
  ThirdPartyCookieBlockedError,
  NetworkError,
  InvalidParamsError,
} from './utils/errors';

export type {
  OAuth2ClientOptions,
  UserInfo,
  LoginState,
  TokenResponse,
  LogoutReason,
  LogoutEvent,
  LogoutCallback,
  StorageType,
  CasSessionResponse,
} from './types';

export type { IStorageProvider } from './storage/interface';

/** 快捷工厂函数 */
export function createOAuth2Client(config: OAuth2ClientOptions): OAuth2Client {
  return new OAuth2Client(config);
}

/**
 * 手动初始化（可选）：通常无需调用，script 引入后会自动完成初始化。
 * 仅在需要动态覆盖配置（如 oauth2ServerUrl）时使用。
 */
export function initOAuth2(config?: Partial<OAuth2ClientOptions>): void {
  const mergedConfig: OAuth2ClientOptions = {
    ...buildLocalConfig(),
    ...config,
  } as OAuth2ClientOptions;
  const client = _createClient(mergedConfig);
  window.__OAUTH2_PROMISE__ = client.checkAuth();
}

export { WINDOW_USER_INFO_KEY, OAUTH2_LOGOUT_CHANNEL };
