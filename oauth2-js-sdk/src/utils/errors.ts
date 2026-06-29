/**
 * SDK 错误类型定义（参考 @authing/sso 的 AuthenticationError / InvalidParamsError 命名）
 *
 * 业务侧可以用 instanceof 精准区分错误类型，针对性处理：
 *   try {
 *     await oauth2.getSilentAccessToken();
 *   } catch (err) {
 *     if (err instanceof AuthenticationError) oauth2.login();
 *     else if (err instanceof ThirdPartyCookieBlockedError) ...
 *     else if (err instanceof NetworkError) showToast('网络异常');
 *     else throw err;
 *   }
 */

/** 基类：所有 SDK 错误都继承自它，便于业务侧统一捕获 */
export class OAuth2Error extends Error {
  /** 机器可读的错误码，与服务端响应中的 error 字段对齐（如 'invalid_grant'） */
  code: string;

  constructor(message: string, code: string = 'oauth2_error') {
    super(message);
    this.name = 'OAuth2Error';
    this.code = code;
  }
}

/** 用户未登录 / OAuth2 Session 已失效 */
export class AuthenticationError extends OAuth2Error {
  constructor(message: string = '未检测到 OAuth2 登录态') {
    super(message, 'not_authenticated');
    this.name = 'AuthenticationError';
  }
}

/**
 * 第三方 Cookie 被浏览器拦截（Safari ITP / Chrome 隐身模式 / 浏览器隐私设置）
 *
 * 注意：浏览器不会显式告诉前端"我拦了你的 Cookie"，
 * SDK 通过启发式判断（trackSession 反复返回 session:null 但服务端账号确实在登录）来识别此场景。
 */
export class ThirdPartyCookieBlockedError extends OAuth2Error {
  constructor(message: string = '浏览器禁止跨站携带 Cookie，trackSession 无法工作') {
    super(message, 'third_party_cookie_blocked');
    this.name = 'ThirdPartyCookieBlockedError';
  }
}

/** 网络错误（DNS 失败 / 连接超时 / CORS 拦截 / 服务端 5xx） */
export class NetworkError extends OAuth2Error {
  /** 保留原始错误便于调试（fetch AbortError / axios error 等） */
  readonly originalCause: unknown;

  constructor(message: string = '网络请求失败', cause?: unknown) {
    super(message, 'network_error');
    this.name = 'NetworkError';
    this.originalCause = cause;
  }
}

/** 参数非法 / 配置缺失 */
export class InvalidParamsError extends OAuth2Error {
  constructor(message: string = '参数非法') {
    super(message, 'invalid_params');
    this.name = 'InvalidParamsError';
  }
}
