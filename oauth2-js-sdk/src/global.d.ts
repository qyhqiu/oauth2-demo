import type { OAuth2Client } from './OAuth2Client';
import type { UserInfo } from './types';

declare global {
  interface Window {
    /** OAuth2Client 实例，业务代码可调用 logout()、jumpToApp() 等 */
    __OAuth2ClientSDK__: OAuth2Client;
    /** 当前登录用户信息（checkAuth 完成后自动挂载） */
    __GLOBAL_USER_INFO__: UserInfo | null;
    /** 鉴权完成的 Promise（React 应用等待此 Promise 再渲染） */
    __OAUTH2_PROMISE__: Promise<UserInfo | null>;
  }
}

export {};
