/**
 * 验证 Access Token 中间件（JWT 签名 + Redis Session 双重验证）
 * OpenID Connect Core §5.3.3 / RFC 6750 §3.1：
 * 401 响应必须携带 WWW-Authenticate: Bearer 头
 */
const jwt = require('jsonwebtoken');
const { redis, SESSION_KEY } = require('../db/redis.db');
const { ID_TOKEN_SIGNING_ALG } = require('../utils/constants');
const { getPublicKey } = require('../utils/keystore');

async function verifyAccessToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.set(
      'WWW-Authenticate',
      'Bearer realm="oauth2-server", error="invalid_token", error_description="No access token provided"',
    );
    return res
      .status(401)
      .json({ error: 'invalid_token', error_description: '未提供 Access Token' });
  }

  // 第一步：验证 JWT 签名和有效期（RS256 + RSA 公钥）
  let decoded;
  try {
    decoded = jwt.verify(token, getPublicKey(), { algorithms: [ID_TOKEN_SIGNING_ALG] });
  } catch {
    res.set(
      'WWW-Authenticate',
      'Bearer realm="oauth2-server", error="invalid_token", error_description="Token is invalid or expired"',
    );
    return res
      .status(401)
      .json({ error: 'invalid_token', error_description: 'Token 无效或已过期' });
  }

  // 第二步：验证 Redis Session（登出后 Session 被删除，立即失效）
  const sessionUserId = await redis.get(SESSION_KEY(token));
  if (!sessionUserId) {
    res.set(
      'WWW-Authenticate',
      'Bearer realm="oauth2-server", error="invalid_token", error_description="Session has expired, please re-authorize"',
    );
    return res
      .status(401)
      .json({ error: 'invalid_token', error_description: '登录状态已失效，请重新授权' });
  }

  req.user = decoded;
  req.accessToken = token;
  next();
}

module.exports = { verifyAccessToken };
