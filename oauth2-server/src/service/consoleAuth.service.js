/**
 * 控制台管理员鉴权服务
 *
 * 设计：
 * - 复用 oauth2-server 的 RS256 + keystore 体系，签发的 console JWT 与 Access Token 同算法、同 kid
 * - audience（aud）固定为 'oauth2-console'，与业务 access token 区分（避免 access token 被滥用为控制台 token）
 * - 强制 role=admin 才能登录控制台
 * - Token TTL 默认 8 小时（控制台日常办公时长）
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { findUserById, findUserByIdentifier } = require('./user.service');
const User = require('../model/user.model');
const { getPrivateKey, getPublicKey, getKid } = require('../utils/keystore');
const { ID_TOKEN_SIGNING_ALG } = require('../utils/constants');

const CONSOLE_AUDIENCE = 'oauth2-console';
const CONSOLE_TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 小时

/**
 * 控制台管理员登录：用户名密码 → 校验 → 校验 admin 角色 → 签发 JWT
 * @returns {Promise<{token, user, expiresIn} | null>} 失败抛 Error
 */
async function loginAdmin(username, password) {
  if (!username || !password) {
    const err = new Error('用户名和密码不能为空');
    err.code = 'invalid_request';
    throw err;
  }

  // 先不过滤状态地查找用户，以便区分具体失败原因
  const existingUser = await findUserByIdentifier(username);
  if (!existingUser) {
    const err = new Error('用户不存在');
    err.code = 'user_not_found';
    throw err;
  }

  // 检查账户状态
  if (existingUser.blocked) {
    const err = new Error('该账号已被锁定，请联系管理员解锁');
    err.code = 'account_blocked';
    throw err;
  }
  if (existingUser.status === 'disabled' || existingUser.status === 'inactive') {
    const err = new Error('该账号已被停用，请联系管理员');
    err.code = 'account_disabled';
    throw err;
  }

  // 校验密码（需要从数据库重新查询带 password 的文档）
  const userDoc = await User.findById(existingUser.id).select('+password +totpSecret');
  const isMatch = await bcrypt.compare(password, userDoc.password);
  if (!isMatch) {
    const err = new Error('密码错误');
    err.code = 'invalid_password';
    throw err;
  }

  // 构造用户对象
  const userObj = userDoc.toObject();
  const { password: _pwd, _id, ...rest } = userObj;
  const user = { ...rest, id: _id.toString() };

  if (user.role !== 'admin') {
    const err = new Error('该账号无控制台访问权限（仅 admin 角色可登录）');
    err.code = 'forbidden';
    throw err;
  }

  // C1：findUserByCredentials 已统一暴露 user.id（剔除 _id），无需兜底
  const userId = user.id;
  const token = jwt.sign(
    {
      sub: userId,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      token_type: 'console_admin_token',
    },
    getPrivateKey(),
    {
      algorithm: ID_TOKEN_SIGNING_ALG,
      expiresIn: CONSOLE_TOKEN_TTL_SECONDS,
      keyid: getKid(),
      audience: CONSOLE_AUDIENCE,
      issuer: 'oauth2-server',
    },
  );

  return {
    token,
    expiresIn: CONSOLE_TOKEN_TTL_SECONDS,
    user: {
      id: userId,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
    },
  };
}

/**
 * Express 中间件：校验 Bearer JWT + role=admin
 * 通过后把 req.consoleUser 挂到请求上，业务路由可读取
 */
async function requireConsoleAuth(req, res, next) {
  // 1. 读取 Token：优先 Authorization 头；否则降级到 query.access_token（用于浏览器原生下载场景，
  //    a[download] / window.open 无法注入自定义请求头，只能把 token 放 query）
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  let token = match ? match[1] : '';
  if (!token && typeof req.query.access_token === 'string') {
    token = req.query.access_token;
  }
  if (!token) {
    return res.status(401).json({
      error: 'unauthorized',
      error_description: '请先登录控制台（缺少 Bearer Token）',
    });
  }

  // 2. 验签 + 校验 audience/issuer
  let decoded;
  try {
    decoded = jwt.verify(token, getPublicKey(), {
      algorithms: [ID_TOKEN_SIGNING_ALG],
      audience: CONSOLE_AUDIENCE,
      issuer: 'oauth2-server',
    });
  } catch {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token 无效或已过期，请重新登录',
    });
  }

  // 3. 二次校验 token_type 和 role（防止业务 access token 被复用）
  if (decoded.token_type !== 'console_admin_token' || decoded.role !== 'admin') {
    return res.status(403).json({
      error: 'forbidden',
      error_description: '该 Token 无控制台访问权限',
    });
  }

  // 4. 校验用户依然存在且仍是 admin（防止用户被禁用/降级后旧 token 还能用）
  const user = await findUserById(decoded.sub);
  if (!user || user.role !== 'admin' || user.status !== 'active') {
    return res.status(403).json({
      error: 'forbidden',
      error_description: '账号已被禁用或权限已变更，请重新登录',
    });
  }

  req.consoleUser = {
    id: decoded.sub,
    username: decoded.username,
    name: decoded.name,
    role: decoded.role,
    email: decoded.email,
  };
  next();
}

/**
 * 为已认证用户签发控制台 JWT（用于 OAuth2 登录回调场景）
 * - 走 OAuth2 流程时，用户身份已通过 oauth2-server 的 OAuth2 验证，无需再校验密码
 * - 仍要校验 admin 角色 + active 状态（防止非 admin 用户通过 OAuth2 绕过控制台限制）
 *
 * @param {object} user 已通过 OAuth2 验证的用户对象
 * @returns {{token, user, expiresIn}}
 * @throws {Error} role 非 admin 或 status 非 active 时抛 forbidden
 */
function issueConsoleTokenForUser(user) {
  if (!user) {
    const err = new Error('用户不存在');
    err.code = 'invalid_credentials';
    throw err;
  }
  if (user.role !== 'admin') {
    const err = new Error(`角色 [${user.role}] 无控制台访问权限（仅 admin 可登录）`);
    err.code = 'forbidden';
    throw err;
  }
  if (user.status && user.status !== 'active') {
    const err = new Error('账号已被禁用');
    err.code = 'forbidden';
    throw err;
  }

  // C1：findUserById 已统一暴露 user.id，无需兜底
  const userId = user.id;
  const token = jwt.sign(
    {
      sub: userId,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      token_type: 'console_admin_token',
      // 标记登录方式，便于审计区分密码登录 vs OAuth2 登录
      login_method: 'oauth2',
    },
    getPrivateKey(),
    {
      algorithm: ID_TOKEN_SIGNING_ALG,
      expiresIn: CONSOLE_TOKEN_TTL_SECONDS,
      keyid: getKid(),
      audience: CONSOLE_AUDIENCE,
      issuer: 'oauth2-server',
    },
  );

  return {
    token,
    expiresIn: CONSOLE_TOKEN_TTL_SECONDS,
    user: {
      id: userId,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
    },
  };
}

module.exports = {
  loginAdmin,
  requireConsoleAuth,
  issueConsoleTokenForUser,
  CONSOLE_AUDIENCE,
  CONSOLE_TOKEN_TTL_SECONDS,
};
