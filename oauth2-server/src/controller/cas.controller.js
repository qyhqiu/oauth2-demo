/**
 * CAS Controller — OAuth2 会话检测 + 静默授权
 */
const { logger } = require('../utils/logger');
const { redis, OAUTH2_SESSION_KEY } = require('../db/redis.db');
const { OAUTH2_SESSION_COOKIE_NAME } = require('../utils/constants');
const { findClientByOrigin, resolveGrantedScope } = require('../service/client.service');
const { findUserById } = require('../service/user.service');
const { createAuthCode } = require('../service/token.service');

async function resolveOAuth2User(req) {
  const oauth2Token = req.cookies?.[OAUTH2_SESSION_COOKIE_NAME];
  if (!oauth2Token) {
    return { oauth2Token: null, userId: null, user: null };
  }
  const userId = await redis.get(OAUTH2_SESSION_KEY(oauth2Token));
  if (!userId) {
    return { oauth2Token, userId: null, user: null };
  }
  const user = await findUserById(userId);
  return { oauth2Token, userId, user };
}

async function getSession(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  try {
    const { oauth2Token, userId, user } = await resolveOAuth2User(req);
    if (!oauth2Token || !userId || !user) {
      return res.json({ session: null });
    }
    res.json({
      session: { userId, type: 'oidc', oauth2Token },
      userInfo: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('[CAS] /session 反查失败:', error.message);
    res.json({ session: null });
  }
}

async function silentAuthorize(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const {
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      state,
      client_id: requestedClientId,
    } = req.query || {};

    if (!redirect_uri) {
      return res
        .status(400)
        .json({ error: 'invalid_request', error_description: '缺少 redirect_uri 参数' });
    }
    if (!requestedClientId) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: '缺少 client_id 参数（CAS 端点强制要求显式声明 client_id）',
      });
    }
    if (!code_challenge || !code_challenge_method) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: '缺少 PKCE 参数（code_challenge / code_challenge_method）',
      });
    }
    if (code_challenge_method !== 'S256') {
      return res
        .status(400)
        .json({ error: 'invalid_request', error_description: 'code_challenge_method 仅支持 S256' });
    }

    const { userId, user } = await resolveOAuth2User(req);
    if (!userId || !user) {
      return res.status(401).json({
        error: 'not_authenticated',
        error_description: '未检测到 OAuth2 登录态，请走完整登录流程',
      });
    }

    let clientOrigin;
    try {
      clientOrigin = new URL(redirect_uri).origin;
    } catch {
      return res
        .status(400)
        .json({ error: 'invalid_redirect_uri', error_description: 'redirect_uri 格式非法' });
    }

    const client = await findClientByOrigin(clientOrigin);
    if (!client) {
      return res.status(400).json({
        error: 'unauthorized_client',
        error_description: `redirect_uri 的 origin [${clientOrigin}] 未在 OAuth2 服务注册`,
      });
    }
    if (client.clientId !== requestedClientId) {
      return res.status(400).json({
        error: 'unauthorized_client',
        error_description: `client_id [${requestedClientId}] 与 redirect_uri 注册的 [${client.clientId}] 不匹配`,
      });
    }

    const grantedScope = resolveGrantedScope(scope, client?.scope || ['openid', 'profile']);
    const code = await createAuthCode(
      userId,
      client.clientId,
      redirect_uri,
      grantedScope,
      code_challenge,
      code_challenge_method,
      null,
    );

    logger.info(`🤫 [CAS] 静默授权成功: 用户 [${user.username}] → client [${client.clientId}]`);
    res.json({ code, state: state || null, scope: grantedScope });
  } catch (error) {
    logger.error('[CAS] /silent-authorize 失败:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
}

module.exports = { getSession, silentAuthorize };
