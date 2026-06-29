import axios from 'axios';
import {
  COOKIE_KEYS,
  OAUTH2_LOGOUT_CHANNEL,
  ACCESS_TOKEN_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE_MAX_AGE_SECONDS,
  API_VERSION_PREFIX,
  CAS_ENDPOINTS,
  TRACK_SESSION_TIMEOUT_MS,
} from './constants';
import { setCookie, getCookie, deleteCookie } from './utils/cookie';
import { generateState, generateCodeVerifier, computeCodeChallenge } from './utils/pkce';
import { isTokenExpired } from './utils/jwt';
import { AuthenticationError, NetworkError, InvalidParamsError } from './utils/errors';
import type {
  OAuth2ClientOptions,
  UserInfo,
  TokenResponse,
  LogoutReason,
  LogoutCallback,
  CasSessionResponse,
  LogoutMessage,
  AppConfig,
} from './types';

/**
 * OAuth2 单点登录客户端（OAuth2 PKCE 模式）
 *
 * 引入 oauth2-js-sdk.iife.js 后自动初始化，也可通过 initOAuth2() 手动控制。
 */
export class OAuth2Client {
  readonly oauth2ServerUrl: string;
  redirectUri: string;
  readonly clientId: string;
  scope: string;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logoutChannel: BroadcastChannel | null = null;
  private logoutCallbacks: LogoutCallback[] = [];
  private appConfig: AppConfig | null = null;
  private appConfigPromise!: Promise<AppConfig | null>;

  constructor(config: OAuth2ClientOptions) {
    this._validateConfig(config);
    this.oauth2ServerUrl = (config.oauth2ServerUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.redirectUri = config.redirectUri;
    this.clientId = config.clientId;
    this.scope = config.scope || 'openid profile';
    this.appConfigPromise = this._fetchAppConfig();
  }

  // ==================== 公共 API ====================

  /** 检查登录态（应用入口必须调用） */
  async checkAuth(): Promise<UserInfo | null> {
    if (!this.clientId) {
      console.error(
        '[OAuth2 SDK] ⚠️ clientId 未配置，无法执行鉴权。请检查 <meta name="oauth2-client-id"> 或 initOAuth2({ clientId }) 配置。',
      );
      return null;
    }
    this._initLogoutChannel();
    await this.appConfigPromise;

    const urlParams = new URLSearchParams(window.location.search);

    // 处理授权错误回调
    const errorResult = this._handleOAuthError(urlParams);
    if (errorResult !== undefined) return errorResult;

    // 处理 OAuth2 code 回调
    const code = urlParams.get('code');
    if (code) {
      return this._handleOAuthCallback(code, urlParams);
    }

    // 验证本地已有 Token
    const localToken = this.getAccessToken();
    if (localToken) {
      return this._handleExistingToken(localToken);
    }

    // 尝试静默登录
    try {
      const silentUser = await this.getSilentAccessToken();
      if (silentUser) return silentUser;
    } catch (err) {
      console.warn('[OAuth2 SDK] 静默登录失败，降级到整页跳转:', (err as Error).message);
    }

    // 跳转授权
    await this._redirectToAuthorize(window.location.href);
    return null;
  }

  /** 跨域 Cookie 反查 OAuth2 登录态 */
  async trackSession(): Promise<CasSessionResponse> {
    const url = `${this.oauth2ServerUrl}${CAS_ENDPOINTS.SESSION}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRACK_SESSION_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new NetworkError(`/cas/session 返回 ${resp.status}`);
      return (await resp.json()) as CasSessionResponse;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new NetworkError(`/cas/session 超时 (${TRACK_SESSION_TIMEOUT_MS}ms)`, err);
      }
      if (err instanceof NetworkError) throw err;
      throw new NetworkError(`/cas/session 失败: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 静默换取 Access Token（trackSession + silent-authorize + token） */
  async getSilentAccessToken(): Promise<UserInfo> {
    const sessionResp = await this.trackSession();
    if (!sessionResp?.session) {
      throw new AuthenticationError('未检测到 OAuth2 登录态');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await computeCodeChallenge(codeVerifier);
    const state = generateState();

    const silentUrl = new URL(`${this.oauth2ServerUrl}${CAS_ENDPOINTS.SILENT_AUTHORIZE}`);
    silentUrl.searchParams.set('client_id', this.clientId);
    silentUrl.searchParams.set('redirect_uri', this.redirectUri);
    silentUrl.searchParams.set('code_challenge', codeChallenge);
    silentUrl.searchParams.set('code_challenge_method', 'S256');
    silentUrl.searchParams.set('scope', this.scope);
    silentUrl.searchParams.set('state', state);

    const silentResp = await this._fetchSilentCode(silentUrl);
    if (!silentResp?.code) {
      throw new AuthenticationError('静默授权返回数据缺少 code');
    }

    const tokenData = (
      await axios.post<TokenResponse>(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/token`, {
        grant_type: 'authorization_code',
        code: silentResp.code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      })
    ).data;

    const userInfo = await this._fetchUserInfo(tokenData.access_token);
    this._saveSession(tokenData, userInfo);
    this._startHeartbeat();
    return userInfo;
  }

  /** 单点登出 */
  logout(): void {
    this._broadcastLogout();
    this._clearSession();
    this._stopHeartbeat();
    const logoutUrl = new URL(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/logout`);
    logoutUrl.searchParams.set('redirect_uri', window.location.href);
    window.location.href = logoutUrl.toString();
  }

  /** 跨应用免登录跳转 */
  jumpToApp(targetAppUrl: string): void {
    window.location.href = targetAppUrl;
  }

  /** 注册登出监听回调 */
  onLogout(callback: LogoutCallback): void {
    this.logoutCallbacks.push(callback);
  }

  getAccessToken(): string | undefined {
    return getCookie(COOKIE_KEYS.ACCESS_TOKEN);
  }

  getRefreshToken(): string | undefined {
    return getCookie(COOKIE_KEYS.REFRESH_TOKEN);
  }

  getUserInfo(): UserInfo | null {
    return window.__GLOBAL_USER_INFO__ || null;
  }

  destroy(): void {
    this._stopHeartbeat();
    if (this.logoutChannel) {
      this.logoutChannel.close();
      this.logoutChannel = null;
    }
  }

  // ==================== checkAuth 子步骤 ====================

  /** 处理 OAuth2 授权错误（?error=xxx） */
  private _handleOAuthError(urlParams: URLSearchParams): null | undefined {
    const oauthError = urlParams.get('error');
    if (!oauthError) return undefined;

    const description = urlParams.get('error_description') || '授权失败';
    console.error(`[OAuth2 SDK] OAuth2 错误: ${oauthError} - ${description}`);
    window.history.replaceState({}, document.title, window.location.pathname);
    window.dispatchEvent(
      new CustomEvent('oauth2:auth-error', {
        detail: { error: oauthError, description },
      }),
    );
    return null;
  }

  /** 处理 OAuth2 code 回调 */
  private async _handleOAuthCallback(
    code: string,
    urlParams: URLSearchParams,
  ): Promise<UserInfo | null> {
    const state = urlParams.get('state');
    const savedState = sessionStorage.getItem('oauth2_oauth_state');
    sessionStorage.removeItem('oauth2_oauth_state');

    if (savedState && state !== savedState) {
      console.error('[OAuth2 SDK] state 验证失败，可能存在 CSRF 攻击');
      return null;
    }

    const urlRedirectUri = urlParams.get('post_login_redirect_uri');
    window.history.replaceState({}, document.title, window.location.pathname);

    try {
      const tokenData = await this._exchangeCodeForToken(code);
      const userInfo = await this._fetchUserInfo(tokenData.access_token);
      this._saveSession(tokenData, userInfo);
      this._startHeartbeat();

      const finalRedirect = urlRedirectUri || this.appConfig?.postLoginRedirectUri;
      if (finalRedirect && finalRedirect !== window.location.href) {
        window.location.replace(finalRedirect);
      }
      return userInfo;
    } catch (error) {
      console.error('[OAuth2 SDK] Code 换取 Token 失败:', error);
      this._clearSession();
      const logoutUrl = new URL(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/logout`);
      logoutUrl.searchParams.set('redirect_uri', window.location.origin);
      window.location.replace(logoutUrl.toString());
      return null;
    }
  }

  /** 处理已有本地 Token */
  private async _handleExistingToken(localToken: string): Promise<UserInfo | null> {
    const cachedUserInfo = window.__GLOBAL_USER_INFO__;
    if (cachedUserInfo) {
      this._startHeartbeat();
      return cachedUserInfo;
    }

    try {
      const userInfo = await this._fetchUserInfo(localToken);
      window.__GLOBAL_USER_INFO__ = userInfo;
      this._startHeartbeat();
      return userInfo;
    } catch {
      return this._tryRefreshOrRedirect();
    }
  }

  /** Token 过期时尝试刷新，失败则跳转授权 */
  private async _tryRefreshOrRedirect(): Promise<UserInfo | null> {
    const refreshToken = this.getRefreshToken();
    if (refreshToken) {
      try {
        const tokenData = await this._refreshAccessToken(refreshToken);
        const userInfo = await this._fetchUserInfo(tokenData.access_token);
        this._saveSession(tokenData, userInfo);
        this._startHeartbeat();
        return userInfo;
      } catch {
        /* fall through */
      }
    }
    this._clearSession();
    await this._redirectToAuthorize(window.location.href);
    return null;
  }

  // ==================== 网络请求 ====================

  /** 获取应用配置（启动时调用） */
  private async _fetchAppConfig(): Promise<AppConfig | null> {
    if (!this.clientId) {
      console.warn('[OAuth2 SDK] clientId 为空，跳过应用配置获取');
      return null;
    }
    try {
      const url = `${this.oauth2ServerUrl}${API_VERSION_PREFIX}/api/public/clients/${encodeURIComponent(this.clientId)}/config`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TRACK_SESSION_TIMEOUT_MS);

      let resp: Response;
      try {
        resp = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!resp.ok) {
        console.error(`[OAuth2 SDK] ❌ 应用配置获取失败: HTTP ${resp.status}`);
        return null;
      }

      const json = (await resp.json()) as { code: number; data?: AppConfig };
      if (json?.code !== 0 || !json.data) {
        console.error(`[OAuth2 SDK] ❌ 应用 [${this.clientId}] 不存在或已禁用`);
        return null;
      }

      this.appConfig = json.data;
      this._applyAppConfig(this.appConfig);
      console.log(`[OAuth2 SDK] ✅ 应用配置已加载：[${this.appConfig.name}] (${this.clientId})`);
      if (!this.appConfig.enabled) {
        console.error(`[OAuth2 SDK] ❌ 应用 [${this.appConfig.name}] 已被禁用`);
      }
      return this.appConfig;
    } catch (err) {
      console.warn(`[OAuth2 SDK] 应用配置获取失败（${(err as Error).message}）`);
      return null;
    }
  }

  /** 静默授权获取 code */
  private async _fetchSilentCode(silentUrl: URL): Promise<{ code?: string }> {
    try {
      const resp = await fetch(silentUrl.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (resp.status === 401) throw new AuthenticationError('静默授权时 Session 已失效');
      if (!resp.ok) throw new NetworkError(`/cas/silent-authorize 返回 ${resp.status}`);
      return (await resp.json()) as { code?: string };
    } catch (err) {
      if (err instanceof AuthenticationError || err instanceof NetworkError) throw err;
      throw new NetworkError(`/cas/silent-authorize 失败: ${(err as Error).message}`, err);
    }
  }

  /** 跳转到 OAuth2 授权端点（PKCE） */
  private async _redirectToAuthorize(postLoginRedirectUri?: string): Promise<void> {
    const state = generateState();
    sessionStorage.setItem('oauth2_oauth_state', state);

    const codeVerifier = generateCodeVerifier();
    sessionStorage.setItem('oauth2_pkce_code_verifier', codeVerifier);
    const codeChallenge = await computeCodeChallenge(codeVerifier);

    const authorizeUrl = new URL(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', this.clientId);
    authorizeUrl.searchParams.set('redirect_uri', this.redirectUri);
    authorizeUrl.searchParams.set('scope', this.scope);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    const resolvedRedirect = this.appConfig?.postLoginRedirectUri || postLoginRedirectUri;
    if (resolvedRedirect) {
      authorizeUrl.searchParams.set('post_login_redirect_uri', resolvedRedirect);
    }

    window.location.href = authorizeUrl.toString();
  }

  /** Authorization Code 换 Token */
  private async _exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const codeVerifier = sessionStorage.getItem('oauth2_pkce_code_verifier');
    sessionStorage.removeItem('oauth2_pkce_code_verifier');
    return (
      await axios.post<TokenResponse>(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/token`, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      })
    ).data;
  }

  /** Refresh Token 换新 Token */
  private async _refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    return (
      await axios.post<TokenResponse>(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/token`, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    ).data;
  }

  /** 获取用户信息 */
  private async _fetchUserInfo(accessToken: string): Promise<UserInfo> {
    return (
      await axios.get<UserInfo>(`${this.oauth2ServerUrl}${API_VERSION_PREFIX}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).data;
  }

  // ==================== 会话管理 ====================

  private _saveSession(tokenData: TokenResponse, userInfo: UserInfo): void {
    setCookie(
      COOKIE_KEYS.ACCESS_TOKEN,
      tokenData.access_token,
      tokenData.expires_in || ACCESS_TOKEN_COOKIE_MAX_AGE_SECONDS,
    );
    setCookie(
      COOKIE_KEYS.REFRESH_TOKEN,
      tokenData.refresh_token,
      REFRESH_TOKEN_COOKIE_MAX_AGE_SECONDS,
    );
    window.__GLOBAL_USER_INFO__ = userInfo;
  }

  private _clearSession(): void {
    deleteCookie(COOKIE_KEYS.ACCESS_TOKEN);
    deleteCookie(COOKIE_KEYS.REFRESH_TOKEN);
    window.__GLOBAL_USER_INFO__ = null;
  }

  // ==================== 心跳 & 广播 ====================

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const token = this.getAccessToken();
      if (!token) {
        this._stopHeartbeat();
        return;
      }
      if (isTokenExpired(token)) {
        this._stopHeartbeat();
        this._triggerLogoutCallbacks('heartbeat');
      }
    }, 30000);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _initLogoutChannel(): void {
    if (this.logoutChannel) return;
    this.logoutChannel = new BroadcastChannel(OAUTH2_LOGOUT_CHANNEL);
    this.logoutChannel.onmessage = (event: MessageEvent<LogoutMessage>) => {
      if (event.data?.type === 'OAUTH2_LOGOUT') {
        this._clearSession();
        this._stopHeartbeat();
        this._triggerLogoutCallbacks('broadcast');
      }
    };
  }

  private _broadcastLogout(): void {
    const channel = new BroadcastChannel(OAUTH2_LOGOUT_CHANNEL);
    channel.postMessage({ type: 'OAUTH2_LOGOUT', timestamp: Date.now() } as LogoutMessage);
    channel.close();
  }

  private _triggerLogoutCallbacks(reason: LogoutReason): void {
    this.logoutCallbacks.forEach((cb) => {
      try {
        cb({ reason });
      } catch (e) {
        console.error('[OAuth2 SDK] 登出回调出错:', e);
      }
    });
  }

  // ==================== 校验 ====================

  private _applyAppConfig(appConfig: AppConfig): void {
    if (Array.isArray(appConfig.scope) && appConfig.scope.length > 0) {
      this.scope = appConfig.scope.join(' ');
    }

    if (Array.isArray(appConfig.redirectUris) && appConfig.redirectUris.length > 0) {
      const currentUri = String(this.redirectUri || '').trim();
      if (currentUri) {
        const resolveUri = this._findMatchingRedirectUri(appConfig.redirectUris, currentUri);
        if (resolveUri) {
          this.redirectUri = resolveUri;
        } else {
          console.error(
            `[OAuth2 SDK] 当前 redirectUri [${currentUri}] 未匹配应用配置中的 redirectUris [${appConfig.redirectUris.join(', ')}]。`,
          );
        }
      } else if (appConfig.redirectUris.length === 1) {
        this.redirectUri = appConfig.redirectUris[0];
        console.warn(`[OAuth2 SDK] 当前未配置 redirectUri，已使用唯一注册地址 ${this.redirectUri}`);
      } else {
        console.error(
          `[OAuth2 SDK] redirectUri 缺失，应用注册了多个 redirectUris，无法自动选择回调地址。`,
        );
      }
    }
  }

  private _findMatchingRedirectUri(registeredUris: string[], currentUri: string): string | null {
    if (!currentUri) {
      return null;
    }

    const normalizedCurrent = this._normalizeRedirectUri(currentUri);
    for (const uri of registeredUris) {
      if (this._normalizeRedirectUri(uri) === normalizedCurrent) {
        return uri;
      }
    }

    const normalizedCurrentBase = this._normalizeRedirectUriBase(currentUri);
    if (normalizedCurrentBase) {
      for (const uri of registeredUris) {
        const normalizedRegisteredBase = this._normalizeRedirectUriBase(uri);
        if (normalizedRegisteredBase && normalizedRegisteredBase === normalizedCurrentBase) {
          return uri;
        }
      }
    }

    return null;
  }

  private _normalizeRedirectUri(uri: string): string {
    try {
      const url = new URL(uri);
      return `${url.origin}${url.pathname}${url.search}`.replace(/\/+$/, '');
    } catch {
      return String(uri).replace(/\/+$/, '');
    }
  }

  private _normalizeRedirectUriBase(uri: string): string | null {
    try {
      const url = new URL(uri);
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  private _validateConfig(config: OAuth2ClientOptions): void {
    if (!config.redirectUri) {
      console.error('[OAuth2 SDK] ⚠️ 缺少必要配置: redirectUri');
    }
    if (!config.clientId) {
      console.error(
        '[OAuth2 SDK] ⚠️ 缺少必要配置: clientId。请在 HTML 中添加 <meta name="oauth2-client-id" content="your-client-id" /> 或传入 { clientId }。',
      );
    }
  }
}
