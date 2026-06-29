/**
 * OAuth2 JS SDK 类型定义
 *
 * 参考 authing-js-sdk @authing/web 的类型设计
 */

/** OAuth2Client 构造配置 */
export interface OAuth2ClientOptions {
  /** OAuth2 服务端地址（可选，默认 http://localhost:3000） */
  oauth2ServerUrl?: string;
  /** OAuth2 回调地址（必填） */
  redirectUri: string;
  /** 客户端 ID（必填，对应 oauth2-console 应用列表中的 clientId） */
  clientId: string;
  /** 授权范围（可选，默认 'openid profile'） */
  scope?: string;
}

/** 登录态信息 */
export interface LoginState {
  accessToken: string;
  refreshToken: string;
  expireAt: number;
  userInfo: UserInfo;
}

/** 用户信息（OIDC StandardClaims） */
export interface UserInfo {
  /** 用户唯一 ID */
  sub: string;
  /** 用户名 */
  username: string;
  /** 姓名 */
  name: string;
  /** 邮箱 */
  email: string;
  /** 角色（admin | user） */
  role: string;
  /** 最后更新时间（ISO 8601） */
  updated_at: string;
  /** 名 */
  given_name?: string;
  /** 姓 */
  family_name?: string;
  /** 中间名 */
  middle_name?: string;
  /** 头像 URL */
  picture?: string;
  /** 允许额外字段 */
  [key: string]: unknown;
}

/** Token 端点响应 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  /** 有效期（秒） */
  expires_in: number;
  refresh_token: string;
  scope: string;
  /** OIDC id_token（scope 含 openid 时返回） */
  id_token?: string;
}

/** 登出原因 */
export type LogoutReason = 'heartbeat' | 'broadcast' | 'manual';

/** 登出事件 */
export interface LogoutEvent {
  reason: LogoutReason;
}

/** 登出回调函数 */
export type LogoutCallback = (event: LogoutEvent) => void;

/** 存储类型 */
export type StorageType = 'localStorage' | 'sessionStorage' | 'memory';

/** CAS session 响应 */
export interface CasSessionResponse {
  session: Record<string, unknown> | null;
  userInfo?: UserInfo;
}

/** BroadcastChannel 登出消息 */
export interface LogoutMessage {
  type: 'OAUTH2_LOGOUT';
  timestamp: number;
}

/** 应用配置（通过 /api/public/clients/:clientId/config 获取） */
export interface AppConfig {
  clientId: string;
  name: string;
  origin: string;
  clientType: 'web' | 'spa' | 'native' | 'service' | 'miniapp';
  redirectUris: string[];
  postLoginRedirectUri: string;
  scope: string[];
  pkce: boolean;
  enabled: boolean;
}
