const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { redis, CODE_KEY, SESSION_KEY } = require('../db/redis.db');
const { ID_TOKEN_SIGNING_ALG, AUTH_CODE_EXPIRES_SECONDS } = require('../utils/constants');
const { getPublicKey } = require('../utils/keystore');

/**
 * 生成 Authorization Code，存入 Redis（TTL 10分钟，一次性）
 * 对于 PKCE Public Client，额外存储 code_challenge 和 code_challenge_method（RFC 7636 §4.4）
 * @param {string} userId
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} scope
 * @param {string} [codeChallenge]
 * @param {string} [codeChallengeMethod]
 * @returns {Promise<string>} code
 */
async function createAuthCode(
  userId,
  clientId,
  redirectUri,
  scope,
  codeChallenge,
  codeChallengeMethod,
  nonce,
) {
  const code = `AC-${uuidv4()}`;
  const payload = JSON.stringify({
    userId,
    clientId,
    redirectUri,
    scope,
    codeChallenge: codeChallenge || null,
    codeChallengeMethod: codeChallengeMethod || null,
    // OIDC Core §3.1.2.1：透传授权请求的 nonce，token 端点颁发 id_token 时回填
    // 客户端后续比对 id_token.nonce === 自己存的 nonce，防 token 重放（如果未传则 null）
    nonce: nonce || null,
    used: false,
  });
  await redis.set(CODE_KEY(code), payload, 'EX', AUTH_CODE_EXPIRES_SECONDS);
  return code;
}

/**
 * 消费 Authorization Code（原子操作，防重放）
 * @param {string} code
 * @returns {Promise<object|null>} codeData 或 null（无效/已使用）
 */
async function consumeAuthCode(code) {
  const key = CODE_KEY(code);
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }

  const data = JSON.parse(raw);
  if (data.used) {
    return null;
  }

  // 标记为已使用（原子删除）
  await redis.del(key);
  return data;
}

/**
 * 验证 PKCE code_verifier（RFC 7636 §4.6）
 * 服务端计算 BASE64URL(SHA256(code_verifier)) 并与存储的 code_challenge 比较
 * @param {string} codeVerifier
 * @param {string} codeChallenge
 * @param {string} codeChallengeMethod - 目前仅支持 S256
 * @returns {boolean}
 */
function verifyPkceChallenge(codeVerifier, codeChallenge, codeChallengeMethod) {
  if (codeChallengeMethod !== 'S256') {
    return false;
  }
  const computed = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return computed === codeChallenge;
}

module.exports = {
  createAuthCode,
  consumeAuthCode,
  verifyPkceChallenge,
};
