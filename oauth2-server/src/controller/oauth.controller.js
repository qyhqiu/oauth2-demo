/**
 * OAuth Controller — OAuth2 / OIDC 核心业务逻辑
 */
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const {
  redis,
  OAUTH2_SESSION_KEY,
  SESSION_KEY,
  USER_SESSION_KEY,
  USER_REFRESH_KEY,
  REFRESH_KEY,
  LOGIN_FAIL_KEY,
  LOGIN_LOCK_KEY,
} = require('../db/redis.db');
const {
  OAUTH2_SERVER_URL,
  OAUTH2_LOGIN_URL,
  OAUTH2_SESSION_COOKIE_NAME,
  OAUTH2_SESSION_EXPIRES_SECONDS,
  ACCESS_TOKEN_EXPIRES_SECONDS,
  ID_TOKEN_SIGNING_ALG,
} = require('../utils/constants');
const { getPublicKey } = require('../utils/keystore');
const {
  validateClient,
  isRegisteredRedirectUri,
  resolveGrantedScope,
  getAllClients,
  findClientById,
  isConfidentialClient,
  isPublicClient,
} = require('../service/client.service');
const Client = require('../model/client.model');
const { checkAccessControl } = require('../service/accessControl.service');
const {
  findUserByCredentials,
  findUserByIdentifier,
  findUserById,
  generateAccessToken,
  generateRefreshToken,
  generateIdToken,
  createUser,
  isUserLocked,
  incrementMfaFailure,
  clearMfaFailure,
} = require('../service/user.service');
const {
  createAuthCode,
  consumeAuthCode,
  verifyPkceChallenge,
} = require('../service/token.service');
const { buildClaims, parseScope } = require('../service/oidcClaims.service');
const { sendVerifyCode, verifyCode } = require('../service/verifyCode.service');
const { consumeVerifyToken } = require('../router/v1/registerCaptcha.routes');
const { verifyTotpToken } = require('../service/totp.service');
const User = require('../model/user.model');
const LoginLog = require('../model/loginLog.model');
const { extractRequestMeta } = require('../utils/requestMeta');

// MFA 临时令牌 Redis Key
const MFA_TOKEN_KEY = (token) => `oauth:mfa_token:${token}`;
const MFA_TOKEN_TTL = 5 * 60;
const MFA_RESEND_RATE_KEY = (token) => `oauth:mfa_resend_rate:${token}`;
const MFA_RESEND_INTERVAL_SECONDS = 60;

// 注册参数校验
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;

// ==================== 工具函数 ====================

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return String(origin).replace(/\/+$/, '');
  }
}

function writeLoginLog(req, payload) {
  LoginLog.create({ ...extractRequestMeta(req), ...payload }).catch((err) => {
    logger.error('⚠️ LoginLog 写入失败:', err.message);
  });
}

function getEffectivePolicies(client) {
  const loginPolicy = {
    allowRegister: false,
    ssoEnabled: true,
    maxLoginFailures: 5,
    lockoutDurationMinutes: 30,
    ...(client?.loginPolicy || {}),
  };
  const accessPolicy = {
    allowedRoles: [],
    requirePkce: true,
    tokenExpiresInSeconds: ACCESS_TOKEN_EXPIRES_SECONDS,
    ...(client?.accessPolicy || {}),
  };
  return { loginPolicy, accessPolicy };
}

// ==================== 授权端点 ====================

async function authorize(req, res) {
  const {
    response_type,
    redirect_uri,
    state,
    scope,
    code_challenge,
    code_challenge_method,
    post_login_redirect_uri,
    client_id: requestedClientId,
    nonce,
  } = req.query;

  function redirectToLoginWithError(errorCode, errorDescription) {
    const loginUrl = new URL(OAUTH2_LOGIN_URL);
    loginUrl.searchParams.set('error', errorCode);
    loginUrl.searchParams.set('error_description', errorDescription);
    Object.entries(req.query || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        loginUrl.searchParams.set(k, String(v));
      }
    });
    return res.redirect(loginUrl.toString());
  }

  const { valid, error, client, clientId } = await validateClient(redirect_uri, requestedClientId);
  if (!valid) {
    return redirectToLoginWithError('invalid_client', error);
  }

  const { loginPolicy, accessPolicy } = getEffectivePolicies(client);

  if (response_type !== 'code') {
    const errorUrl = new URL(redirect_uri);
    errorUrl.searchParams.set('error', 'unsupported_response_type');
    errorUrl.searchParams.set('error_description', '仅支持 response_type=code');
    if (state) {
      errorUrl.searchParams.set('state', state);
    }
    return res.redirect(errorUrl.toString());
  }

  const requirePkce =
    accessPolicy.requirePkce !== undefined ? accessPolicy.requirePkce : client.pkce;
  if (requirePkce) {
    if (!code_challenge || !code_challenge_method) {
      const errorUrl = new URL(redirect_uri);
      errorUrl.searchParams.set('error', 'invalid_request');
      errorUrl.searchParams.set(
        'error_description',
        'PKCE 客户端必须携带 code_challenge 和 code_challenge_method',
      );
      if (state) {
        errorUrl.searchParams.set('state', state);
      }
      return res.redirect(errorUrl.toString());
    }
    if (code_challenge_method !== 'S256') {
      const errorUrl = new URL(redirect_uri);
      errorUrl.searchParams.set('error', 'invalid_request');
      errorUrl.searchParams.set('error_description', '仅支持 code_challenge_method=S256');
      if (state) {
        errorUrl.searchParams.set('state', state);
      }
      return res.redirect(errorUrl.toString());
    }
  }

  const grantedScope = resolveGrantedScope(scope, client.scope);

  const oauth2SessionToken = req.cookies[OAUTH2_SESSION_COOKIE_NAME];
  if (oauth2SessionToken && loginPolicy.ssoEnabled !== false) {
    const userId = await redis.get(OAUTH2_SESSION_KEY(oauth2SessionToken));
    if (userId) {
      const user = await findUserById(userId);
      if (user) {
        // 校验用户状态（锁定 / 停用），阻止被禁用的用户通过 OAuth2 Cookie 免登
        if (user.blocked) {
          await redis.del(OAUTH2_SESSION_KEY(oauth2SessionToken));
          res.clearCookie(OAUTH2_SESSION_COOKIE_NAME, { path: '/' });
          writeLoginLog(req, {
            clientId,
            username: user.username,
            userId: user.id,
            status: 'failure',
            failureReason: '账号已被锁定（OAuth2 免登拦截）',
          });
          const errorUrl = new URL(redirect_uri);
          errorUrl.searchParams.set('error', 'account_blocked');
          errorUrl.searchParams.set('error_description', '该账号已被锁定，请联系管理员解锁');
          if (state) {
            errorUrl.searchParams.set('state', state);
          }
          return res.redirect(errorUrl.toString());
        }
        if (user.status === 'disabled' || user.status === 'inactive') {
          await redis.del(OAUTH2_SESSION_KEY(oauth2SessionToken));
          res.clearCookie(OAUTH2_SESSION_COOKIE_NAME, { path: '/' });
          writeLoginLog(req, {
            clientId,
            username: user.username,
            userId: user.id,
            status: 'failure',
            failureReason: '账号已被停用（OAuth2 免登拦截）',
          });
          const errorUrl = new URL(redirect_uri);
          errorUrl.searchParams.set('error', 'account_disabled');
          errorUrl.searchParams.set('error_description', '该账号已被停用，请联系管理员');
          if (state) {
            errorUrl.searchParams.set('state', state);
          }
          return res.redirect(errorUrl.toString());
        }

        // 访问控制判断（defaultPermission + accessControlList）
        const accessCheck = await checkAccessControl(accessPolicy, user);
        if (!accessCheck.allowed) {
          const errorUrl = new URL(redirect_uri);
          errorUrl.searchParams.set('error', 'access_denied');
          errorUrl.searchParams.set('error_description', accessCheck.reason);
          if (state) {
            errorUrl.searchParams.set('state', state);
          }
          writeLoginLog(req, {
            clientId,
            username: user.username,
            userId: user.id,
            status: 'failure',
            failureReason: accessCheck.reason,
          });
          return res.redirect(errorUrl.toString());
        }

        const code = await createAuthCode(
          user.id,
          clientId,
          redirect_uri,
          grantedScope,
          code_challenge,
          code_challenge_method,
          nonce,
        );
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('code', code);
        if (state) {
          redirectUrl.searchParams.set('state', state);
        }
        if (post_login_redirect_uri) {
          redirectUrl.searchParams.set('post_login_redirect_uri', post_login_redirect_uri);
        }
        logger.info(
          `🍪 OAuth2 Cookie 验证通过，用户 [${user.username}] 免登录授权 [${client.name}]，scope: ${grantedScope}`,
        );
        writeLoginLog(req, {
          clientId,
          username: user.username,
          userId: user.id,
          status: 'success',
        });
        return res.redirect(redirectUrl.toString());
      }
    }
  }

  const loginUrl = new URL(OAUTH2_LOGIN_URL);
  loginUrl.searchParams.set('redirect_uri', redirect_uri);
  loginUrl.searchParams.set('state', state || '');
  loginUrl.searchParams.set('scope', grantedScope);
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', clientId);
  if (code_challenge) {
    loginUrl.searchParams.set('code_challenge', code_challenge);
  }
  if (code_challenge_method) {
    loginUrl.searchParams.set('code_challenge_method', code_challenge_method);
  }
  if (post_login_redirect_uri) {
    loginUrl.searchParams.set('post_login_redirect_uri', post_login_redirect_uri);
  }
  res.redirect(loginUrl.toString());
}

// ==================== 登录并授权 ====================

async function loginAndAuthorize(req, res) {
  const {
    username,
    password,
    redirect_uri,
    state,
    scope,
    code_challenge,
    code_challenge_method,
    post_login_redirect_uri,
    nonce,
    client_id: requestedClientId,
  } = req.body;
  const isDryRun = req.query?.dry_run === '1';

  function respondError(errorMsg, status = 400) {
    if (isDryRun) {
      return res.status(status).json({ error: 'login_failed', error_description: errorMsg });
    }
    const loginUrl = new URL(OAUTH2_LOGIN_URL);
    loginUrl.searchParams.set('redirect_uri', redirect_uri || '');
    loginUrl.searchParams.set('state', state || '');
    loginUrl.searchParams.set('scope', scope || 'openid profile');
    loginUrl.searchParams.set('response_type', 'code');
    if (code_challenge) {
      loginUrl.searchParams.set('code_challenge', code_challenge);
    }
    if (code_challenge_method) {
      loginUrl.searchParams.set('code_challenge_method', code_challenge_method);
    }
    if (post_login_redirect_uri) {
      loginUrl.searchParams.set('post_login_redirect_uri', post_login_redirect_uri);
    }
    loginUrl.searchParams.set('error', errorMsg);
    return res.redirect(loginUrl.toString());
  }

  if (!username || !password) {
    return respondError('用户名和密码不能为空');
  }

  const {
    valid,
    error,
    client: loginClient,
    clientId,
  } = await validateClient(redirect_uri, requestedClientId);
  if (!valid) {
    return respondError(error);
  }
  const { loginPolicy, accessPolicy } = getEffectivePolicies(loginClient);

  // 先查用户，获取 userId（用于 Redis 锁定 key）
  const userForLockCheck = await User.findOne({
    $or: [{ username }, { phone: username }, { email: username.toLowerCase() }],
  })
    .select('_id')
    .lean();
  // 用于 Redis key 的用户标识：优先 userId，用户不存在时用 _unknown_:username 兜底
  const lockIdentifier = userForLockCheck
    ? userForLockCheck._id.toString()
    : `_unknown_:${username}`;

  // 账号锁定检查（双层）
  const lockReason = await redis.get(LOGIN_LOCK_KEY(clientId, lockIdentifier));
  if (lockReason) {
    const ttl = await redis.ttl(LOGIN_LOCK_KEY(clientId, lockIdentifier));
    writeLoginLog(req, {
      clientId,
      username,
      userId: userForLockCheck ? userForLockCheck._id.toString() : null,
      status: 'failure',
      failureReason: `账号已锁定 (${lockReason})`,
    });
    return respondError(`账号已锁定，请 ${Math.ceil(ttl / 60)} 分钟后重试`);
  }

  if (userForLockCheck) {
    const lockState = await isUserLocked(userForLockCheck._id.toString());
    if (lockState.locked) {
      const remainText =
        lockState.remainSeconds > 0
          ? `请 ${Math.ceil(lockState.remainSeconds / 60)} 分钟后重试`
          : '请联系管理员解锁';
      writeLoginLog(req, {
        clientId,
        username,
        userId: userForLockCheck._id.toString(),
        status: 'failure',
        failureReason: `账号已锁定（${lockState.reason}）`,
      });
      return respondError(`账号已锁定（${lockState.reason}），${remainText}`, 423);
    }
  }

  const user = await findUserByCredentials(username, password);
  if (!user) {
    // 区分"用户不存在/密码错误"和"账号停用/锁定"——给出具体原因
    const existingUser = await findUserByIdentifier(username);
    if (existingUser && existingUser.status === 'disabled') {
      const failureReason = '账号已被管理员停用，请联系管理员';
      writeLoginLog(req, {
        clientId,
        username,
        userId: existingUser.id,
        status: 'failure',
        failureReason,
      });
      return respondError(failureReason, 403);
    }
    if (existingUser && existingUser.blocked === true) {
      const failureReason = '账号已被锁定，请联系管理员';
      writeLoginLog(req, {
        clientId,
        username,
        userId: existingUser.id,
        status: 'failure',
        failureReason,
      });
      return respondError(failureReason, 423);
    }

    let failureReason = '用户名或密码错误';
    if (!isDryRun) {
      const failKey = LOGIN_FAIL_KEY(clientId, lockIdentifier);
      const failCount = await redis.incr(failKey);
      if (failCount === 1) {
        await redis.expire(failKey, loginPolicy.lockoutDurationMinutes * 60);
      }
      if (failCount >= loginPolicy.maxLoginFailures) {
        await redis.set(
          LOGIN_LOCK_KEY(clientId, lockIdentifier),
          '连续登录失败次数过多',
          'EX',
          loginPolicy.lockoutDurationMinutes * 60,
        );
        await redis.del(failKey);
        failureReason = `连续失败 ${failCount} 次，账号已锁定 ${loginPolicy.lockoutDurationMinutes} 分钟`;
        logger.info(`🔒 [${clientId}] 账号 [${username}] 已锁定`);
      }
    }
    writeLoginLog(req, { clientId, username, status: 'failure', failureReason });
    return respondError(failureReason);
  }

  // 访问控制判断（defaultPermission + accessControlList）
  const accessCheck = await checkAccessControl(accessPolicy, user);
  if (!accessCheck.allowed) {
    writeLoginLog(req, {
      clientId,
      username,
      userId: user.id,
      status: 'failure',
      failureReason: accessCheck.reason,
    });
    return respondError(accessCheck.reason, 403);
  }

  // MFA 拦截
  const userId = user.id;
  if (user.mfaEnabled) {
    const mfaChannel = user.mfaChannel || 'phone';
    let mfaTarget = '';
    let mfaTargetMasked = '认证器 App';
    if (mfaChannel === 'phone') {
      if (!user.phone) {
        return respondError('MFA 已开启但未绑定手机号，请联系管理员');
      }
      mfaTarget = user.phone;
      mfaTargetMasked = mfaTarget.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    } else if (mfaChannel === 'email') {
      if (!user.email) {
        return respondError('MFA 已开启但未绑定邮箱，请联系管理员');
      }
      mfaTarget = user.email;
      mfaTargetMasked = mfaTarget.replace(/(.{2}).*(@.*)/, '$1***$2');
    } else if (mfaChannel === 'totp') {
      if (!user.totpSecret) {
        return respondError('MFA 已开启但未绑定认证器 App，请联系管理员');
      }
    }

    if (isDryRun) {
      return res.json({
        ok: false,
        mfa_required: true,
        mfa_channel: mfaChannel,
        mfa_target_masked: mfaTargetMasked,
      });
    }

    const mfaToken = `MFA-${uuidv4()}`;
    const mfaPayload = JSON.stringify({
      userId,
      clientId,
      username,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
      post_login_redirect_uri,
      nonce: nonce || null,
    });
    await redis.set(MFA_TOKEN_KEY(mfaToken), mfaPayload, 'EX', MFA_TOKEN_TTL);

    if (mfaChannel !== 'totp') {
      try {
        await sendVerifyCode(mfaChannel, mfaTarget, 'mfa-login');
      } catch (sendErr) {
        logger.error('⚠️ MFA 验证码发送失败:', sendErr.message);
      }
    }

    return res.status(200).json({
      mfa_required: true,
      mfa_token: mfaToken,
      mfa_channel: mfaChannel,
      mfa_target_masked: mfaTargetMasked,
    });
  }

  if (isDryRun) {
    return res.json({ ok: true });
  }

  // 登录成功
  await redis.del(LOGIN_FAIL_KEY(clientId, userId));
  const grantedScope = resolveGrantedScope(scope, loginClient?.scope || ['openid', 'profile']);
  const code = await createAuthCode(
    userId,
    clientId,
    redirect_uri,
    grantedScope,
    code_challenge,
    code_challenge_method,
    nonce,
  );
  const oauth2SessionToken = `OAUTH2-${uuidv4()}`;
  await redis.set(
    OAUTH2_SESSION_KEY(oauth2SessionToken),
    userId,
    'EX',
    OAUTH2_SESSION_EXPIRES_SECONDS,
  );

  logger.info(`✅ 用户 [${username}] 登录成功，生成 Authorization Code`);
  writeLoginLog(req, { clientId, username, userId, status: 'success' });

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set('code', code);
  if (state) {
    callbackUrl.searchParams.set('state', state);
  }
  if (post_login_redirect_uri) {
    callbackUrl.searchParams.set('post_login_redirect_uri', post_login_redirect_uri);
  }

  const setCookieUrl = new URL(`${OAUTH2_SERVER_URL}/v1/oauth/set-cookie-and-redirect`);
  setCookieUrl.searchParams.set('oauth2_token', oauth2SessionToken);
  setCookieUrl.searchParams.set('redirect', callbackUrl.toString());
  res.redirect(setCookieUrl.toString());
}

// ==================== MFA 验证 ====================

async function mfaVerify(req, res) {
  const { mfa_token, code: mfaCode } = req.body;
  if (!mfa_token || !mfaCode) {
    return res
      .status(400)
      .json({ error: 'invalid_request', error_description: '缺少 mfa_token 或验证码' });
  }

  const raw = await redis.get(MFA_TOKEN_KEY(mfa_token));
  if (!raw) {
    writeLoginLog(req, { status: 'failure', failureReason: 'MFA 令牌过期或无效' });
    return res
      .status(400)
      .json({ error: 'mfa_token_expired', error_description: 'MFA 令牌无效或已过期，请重新登录' });
  }

  const mfaContext = JSON.parse(raw);
  const {
    userId,
    clientId,
    username,
    redirect_uri,
    state,
    scope,
    code_challenge,
    code_challenge_method,
    post_login_redirect_uri,
    nonce,
  } = mfaContext;

  const user = await User.findById(userId).select('+totpSecret').lean();
  if (!user) {
    await redis.del(MFA_TOKEN_KEY(mfa_token));
    writeLoginLog(req, {
      clientId,
      username,
      status: 'failure',
      failureReason: 'MFA 验证时用户不存在',
    });
    return res.status(400).json({ error: 'user_not_found', error_description: '用户不存在' });
  }

  const mfaChannel = user.mfaChannel || 'phone';
  let isValid = false;
  if (mfaChannel === 'totp') {
    isValid = verifyTotpToken(user.totpSecret, mfaCode);
  } else {
    const mfaTarget = mfaChannel === 'phone' ? user.phone : user.email;
    isValid = await verifyCode(mfaChannel, mfaTarget, mfaCode);
  }

  if (!isValid) {
    const loginClientForPolicy = await findClientById(clientId);
    const requestMeta = extractRequestMeta(req);
    const failResult = await incrementMfaFailure(userId, loginClientForPolicy, requestMeta);

    let baseReason = mfaChannel === 'totp' ? 'TOTP 动态码错误' : 'MFA 验证码错误或已过期';
    let baseDescription =
      mfaChannel === 'totp' ? '动态码错误，请确认认证器 App 时间同步' : '验证码错误或已过期';

    if (failResult.locked) {
      await redis.del(MFA_TOKEN_KEY(mfa_token));
      const lockReason = `连续 MFA 失败 ${failResult.failedAttempts} 次，账号已锁定 ${failResult.lockoutMinutes} 分钟`;
      logger.info(
        `🔒 用户 [${username}] MFA 失败次数达上限，账号已锁定 ${failResult.lockoutMinutes} 分钟`,
      );
      writeLoginLog(req, {
        clientId,
        username,
        userId,
        status: 'failure',
        failureReason: lockReason,
      });
      return res.status(423).json({ error: 'account_locked', error_description: lockReason });
    }

    const remainAttempts = failResult.threshold - failResult.failedAttempts;
    if (remainAttempts > 0 && remainAttempts <= 2) {
      baseReason = `${baseReason}（剩余 ${remainAttempts} 次重试机会）`;
      baseDescription = `${baseDescription}，剩余 ${remainAttempts} 次重试机会`;
    }
    writeLoginLog(req, {
      clientId,
      username,
      userId,
      status: 'failure',
      failureReason: baseReason,
    });
    return res.status(400).json({ error: 'invalid_code', error_description: baseDescription });
  }

  // 验证通过
  await redis.del(MFA_TOKEN_KEY(mfa_token));
  await redis.del(LOGIN_FAIL_KEY(clientId, userId));
  await clearMfaFailure(userId);

  const loginClient = await findClientById(clientId);
  const grantedScope = resolveGrantedScope(scope, loginClient?.scope || ['openid', 'profile']);
  const authCode = await createAuthCode(
    userId,
    clientId,
    redirect_uri,
    grantedScope,
    code_challenge,
    code_challenge_method,
    nonce,
  );
  const oauth2SessionToken = `OAUTH2-${uuidv4()}`;
  await redis.set(
    OAUTH2_SESSION_KEY(oauth2SessionToken),
    userId,
    'EX',
    OAUTH2_SESSION_EXPIRES_SECONDS,
  );

  logger.info(`✅ 用户 [${username}] MFA 验证通过，颁发 Authorization Code`);
  writeLoginLog(req, { clientId, username, userId, status: 'success' });

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set('code', authCode);
  if (state) {
    callbackUrl.searchParams.set('state', state);
  }
  if (post_login_redirect_uri) {
    callbackUrl.searchParams.set('post_login_redirect_uri', post_login_redirect_uri);
  }

  const setCookieUrl = new URL(`${OAUTH2_SERVER_URL}/v1/oauth/set-cookie-and-redirect`);
  setCookieUrl.searchParams.set('oauth2_token', oauth2SessionToken);
  setCookieUrl.searchParams.set('redirect', callbackUrl.toString());

  return res.json({ mfa_verified: true, redirect_url: setCookieUrl.toString() });
}

// ==================== MFA 重发 ====================

async function mfaResend(req, res) {
  const { mfa_token } = req.body;
  if (!mfa_token) {
    return res.status(400).json({ error: 'invalid_request', error_description: '缺少 mfa_token' });
  }

  const raw = await redis.get(MFA_TOKEN_KEY(mfa_token));
  if (!raw) {
    return res
      .status(400)
      .json({ error: 'mfa_token_expired', error_description: 'MFA 令牌已过期，请重新登录' });
  }

  const { userId } = JSON.parse(raw);
  const user = await findUserById(userId);
  if (!user) {
    return res.status(400).json({ error: 'user_not_found', error_description: '用户不存在' });
  }

  if (user.mfaChannel === 'totp') {
    return res.status(400).json({
      error: 'unsupported_channel',
      error_description: 'TOTP 通道由认证器 App 本地生成动态码，无需重发',
    });
  }

  const rateKey = MFA_RESEND_RATE_KEY(mfa_token);
  const rateExist = await redis.get(rateKey);
  if (rateExist) {
    const ttl = await redis.ttl(rateKey);
    return res
      .status(429)
      .json({ error: 'too_many_requests', error_description: `请等待 ${ttl} 秒后再重发验证码` });
  }

  const mfaChannel = user.mfaChannel || 'phone';
  const mfaTarget = mfaChannel === 'phone' ? user.phone : user.email;

  try {
    const result = await sendVerifyCode(mfaChannel, mfaTarget, 'mfa-login');
    await redis.set(rateKey, '1', 'EX', MFA_RESEND_INTERVAL_SECONDS);
    return res.json({ code: 0, message: '验证码已重新发送', devCode: result.devCode });
  } catch (sendErr) {
    const isRateLimitErr = /频繁|frequent|too many/i.test(sendErr.message || '');
    if (isRateLimitErr) {
      return res
        .status(429)
        .json({ error: 'too_many_requests', error_description: sendErr.message });
    }
    logger.error('⚠️ MFA 验证码重发失败:', sendErr.message);
    return res
      .status(500)
      .json({ error: 'send_failed', error_description: '验证码发送失败，请稍后重试' });
  }
}

// ==================== Cookie 写入中转 ====================

async function setCookieAndRedirect(req, res) {
  const { oauth2_token, redirect } = req.query;
  if (!oauth2_token || !redirect) {
    return res.status(400).json({ error: 'invalid_request', error_description: '缺少必要参数' });
  }
  logger.info('[oauth] setCookieAndRedirect called with redirect:', redirect);
  let userId;
  try {
    userId = await redis.get(OAUTH2_SESSION_KEY(oauth2_token));
  } catch (err) {
    logger.error('[oauth] redis get error in setCookieAndRedirect:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: '内部错误' });
  }
  if (!userId) {
    return res
      .status(400)
      .json({ error: 'invalid_token', error_description: 'OAuth2 Token 无效或已过期' });
  }
  try {
    logger.info('[oauth] validating redirect origin for setCookieAndRedirect');
    const urlOrigin = new URL(redirect).origin;
    logger.info(`[oauth] redirect origin: ${urlOrigin}`);
  } catch (err) {
    logger.warn('[oauth] setCookieAndRedirect: invalid redirect URL format', err.message);
  }

  const isValidRedirect = await isRegisteredRedirectUri(redirect);
  if (!isValidRedirect) {
    return res
      .status(400)
      .json({ error: 'invalid_redirect', error_description: '非法的重定向地址' });
  }
  logger.info(`🍪 设置 OAuth2 Cookie 并重定向到: ${redirect}`);
  res.cookie(OAUTH2_SESSION_COOKIE_NAME, oauth2_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: OAUTH2_SESSION_EXPIRES_SECONDS * 1000,
  });
  res.redirect(redirect);
}

// ==================== 登出（GET — 浏览器跳转） ====================

async function logoutGet(req, res) {
  const { redirect_uri } = req.query;
  const oauth2SessionToken = req.cookies[OAUTH2_SESSION_COOKIE_NAME];
  if (oauth2SessionToken) {
    const userId = await redis.get(OAUTH2_SESSION_KEY(oauth2SessionToken));
    if (userId) {
      const pipeline = redis.pipeline();
      const allTokens = await redis.smembers(USER_SESSION_KEY(userId));
      allTokens.forEach((token) => pipeline.del(SESSION_KEY(token)));
      pipeline.del(USER_SESSION_KEY(userId));
      const allRefreshTokens = await redis.smembers(USER_REFRESH_KEY(userId));
      allRefreshTokens.forEach((token) => pipeline.del(REFRESH_KEY(token)));
      pipeline.del(USER_REFRESH_KEY(userId));
      await pipeline.exec();
      logger.info(
        `👋 用户登出，已撤销 ${allTokens.length} 个 AccessToken + ${allRefreshTokens.length} 个 RefreshToken`,
      );
    }
    await redis.del(OAUTH2_SESSION_KEY(oauth2SessionToken));
  }
  res.clearCookie(OAUTH2_SESSION_COOKIE_NAME, { path: '/' });

  const targetUrl = redirect_uri || OAUTH2_LOGIN_URL;
  const allClients = await getAllClients();
  const normalizedTargetOrigin = normalizeOrigin(targetUrl);
  const isAllowed = allClients.some((c) => {
    const normalizedOrigin = normalizeOrigin(c.origin);
    return (
      normalizedTargetOrigin === normalizedOrigin || targetUrl.startsWith(`${normalizedOrigin}/`)
    );
  });
  if (!isAllowed) {
    return res
      .status(400)
      .json({ error: 'invalid_redirect_uri', error_description: '非法的重定向地址' });
  }
  logger.info(`🔄 登出完成，重定向到: ${targetUrl}`);
  res.redirect(targetUrl);
}

// ==================== 登出（POST — SPA） ====================

async function logoutPost(req, res) {
  let userId = null;
  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.split(' ')[1];
  if (bearer) {
    try {
      const decoded = jwt.verify(bearer, getPublicKey(), {
        algorithms: [ID_TOKEN_SIGNING_ALG],
        ignoreExpiration: true,
      });
      userId = decoded.sub;
    } catch {
      /* fallback to cookie */
    }
  }

  const oauth2SessionToken = req.cookies[OAUTH2_SESSION_COOKIE_NAME];
  if (!userId && oauth2SessionToken) {
    userId = await redis.get(OAUTH2_SESSION_KEY(oauth2SessionToken));
  }

  let revokedAccessCount = 0;
  let revokedRefreshCount = 0;
  if (userId) {
    const pipeline = redis.pipeline();
    const allTokens = await redis.smembers(USER_SESSION_KEY(userId));
    allTokens.forEach((token) => pipeline.del(SESSION_KEY(token)));
    pipeline.del(USER_SESSION_KEY(userId));
    revokedAccessCount = allTokens.length;
    const allRefreshTokens = await redis.smembers(USER_REFRESH_KEY(userId));
    allRefreshTokens.forEach((token) => pipeline.del(REFRESH_KEY(token)));
    pipeline.del(USER_REFRESH_KEY(userId));
    revokedRefreshCount = allRefreshTokens.length;
    await pipeline.exec();
    logger.info(
      `👋 [POST /logout] 用户 [${userId}] 全局登出，已撤销 ${revokedAccessCount} 个 AccessToken + ${revokedRefreshCount} 个 RefreshToken`,
    );
  }

  if (oauth2SessionToken) {
    await redis.del(OAUTH2_SESSION_KEY(oauth2SessionToken));
  }
  res.clearCookie(OAUTH2_SESSION_COOKIE_NAME, { path: '/' });

  res.json({
    code: 0,
    data: {
      revokedAccessTokens: revokedAccessCount,
      revokedRefreshTokens: revokedRefreshCount,
      oauth2SessionCleared: Boolean(oauth2SessionToken),
    },
  });
}

// ==================== Token 端点 ====================

async function token(req, res) {
  const { grant_type, code, redirect_uri, refresh_token, client_id: reqClientId } = req.body;
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  if (grant_type === 'authorization_code') {
    if (!code || !redirect_uri) {
      return res.status(400).json({ error: 'invalid_request', error_description: '缺少必要参数' });
    }
    const {
      valid,
      error,
      client: tokenClient,
      clientId: tokenClientId,
    } = await validateClient(redirect_uri, reqClientId);
    if (!valid) {
      res.set('WWW-Authenticate', 'Basic realm="oauth2-server"');
      return res.status(401).json({ error: 'invalid_client', error_description: error });
    }
    const codeData = await consumeAuthCode(code);
    if (!codeData) {
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Authorization Code 无效或已过期' });
    }
    if (codeData.clientId !== tokenClientId || codeData.redirectUri !== redirect_uri) {
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Code 与客户端信息不匹配' });
    }

    // Confidential Client 必须校验 client_secret
    if (isConfidentialClient(tokenClient)) {
      let presentedSecret = req.body.client_secret;
      const basicAuth = req.headers.authorization;
      if (!presentedSecret && basicAuth?.startsWith('Basic ')) {
        try {
          const decoded = Buffer.from(basicAuth.slice(6), 'base64').toString('utf8');
          const idx = decoded.indexOf(':');
          if (idx > 0) {
            presentedSecret = decoded.slice(idx + 1);
          }
        } catch {
          /* ignore */
        }
      }
      if (!presentedSecret) {
        res.set('WWW-Authenticate', 'Basic realm="oauth2-server"');
        return res.status(401).json({
          error: 'invalid_client',
          error_description: `Confidential Client [${tokenClient.clientType}] 必须携带 client_secret`,
        });
      }
      const fullClient = await Client.findOne({ clientId: tokenClientId })
        .select('+clientSecret')
        .lean();
      if (!fullClient?.clientSecret || fullClient.clientSecret !== presentedSecret) {
        res.set('WWW-Authenticate', 'Basic realm="oauth2-server"');
        return res
          .status(401)
          .json({ error: 'invalid_client', error_description: 'client_secret 校验失败' });
      }
    }

    // PKCE 校验：Public Client（web/spa）强制走 PKCE，Confidential Client 根据配置决定
    const tokenRequirePkce =
      isPublicClient(tokenClient) ||
      ((tokenClient.accessPolicy?.requirePkce !== undefined
        ? tokenClient.accessPolicy.requirePkce
        : tokenClient.pkce) &&
        !isConfidentialClient(tokenClient));
    if (tokenRequirePkce) {
      const { code_verifier } = req.body;
      if (!code_verifier) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'PKCE 客户端必须携带 code_verifier',
        });
      }
      if (!codeData.codeChallenge || !codeData.codeChallengeMethod) {
        return res
          .status(400)
          .json({ error: 'invalid_grant', error_description: '授权码未关联 PKCE challenge' });
      }
      if (
        !verifyPkceChallenge(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod)
      ) {
        return res
          .status(400)
          .json({ error: 'invalid_grant', error_description: 'code_verifier 验证失败' });
      }
    }

    const user = await findUserById(codeData.userId);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: '用户不存在' });
    }

    const tokenTtl =
      tokenClient.accessPolicy?.tokenExpiresInSeconds || ACCESS_TOKEN_EXPIRES_SECONDS;
    const accessToken = await generateAccessToken(user, tokenClientId, tokenTtl, codeData.scope);
    const newRefreshToken = await generateRefreshToken(user.id, tokenClientId, codeData.scope);

    const grantedScopes = parseScope(codeData.scope);
    const tokenResponse = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: tokenTtl,
      refresh_token: newRefreshToken,
      scope: codeData.scope,
    };
    if (grantedScopes.includes('openid')) {
      tokenResponse.id_token = generateIdToken(user, tokenClientId, codeData.scope, {
        nonce: codeData.nonce,
        expiresInSeconds: tokenTtl,
      });
    }
    logger.info(
      `🎫 [${tokenClientId}] 用 Authorization Code 换取 Access Token 成功，用户: [${user.username}]，TTL=${tokenTtl}s${tokenResponse.id_token ? '，已颁发 id_token' : ''}`,
    );
    return res.json(tokenResponse);
  }

  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: '缺少必要参数' });
    }
    const raw = await redis.get(REFRESH_KEY(refresh_token));
    if (!raw) {
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Refresh Token 无效或已过期' });
    }

    const refreshData = JSON.parse(raw);
    const { userId, clientId: refreshClientId } = refreshData;
    const refreshClient = await findClientById(refreshClientId);
    if (!refreshClient) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: `客户端 [${refreshClientId}] 配置不存在`,
      });
    }

    const user = await findUserById(userId);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: '用户不存在' });
    }

    const refreshTokenTtl =
      refreshClient.accessPolicy?.tokenExpiresInSeconds || ACCESS_TOKEN_EXPIRES_SECONDS;
    const newAccessToken = await generateAccessToken(
      user,
      refreshClientId,
      refreshTokenTtl,
      refreshData.scope,
    );

    const refreshScope = refreshData.scope || 'openid profile';
    const refreshScopes = parseScope(refreshScope);
    const refreshResponse = {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: refreshTokenTtl,
      refresh_token: refresh_token,
      scope: refreshScope,
    };
    if (refreshScopes.includes('openid')) {
      refreshResponse.id_token = generateIdToken(user, refreshClientId, refreshScope, {
        expiresInSeconds: refreshTokenTtl,
      });
    }
    logger.info(
      `🔄 [${refreshClientId}] 使用 Refresh Token 刷新 Access Token，用户: [${user.username}]${refreshResponse.id_token ? '，已刷新 id_token' : ''}`,
    );
    return res.json(refreshResponse);
  }

  return res
    .status(400)
    .json({ error: 'unsupported_grant_type', error_description: '不支持的 grant_type' });
}

// ==================== UserInfo ====================

async function getUserInfo(req, res) {
  const user = await findUserById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found', error_description: '用户不存在' });
  }
  const scope = req.user.scope || 'openid profile email phone';
  res.json(buildClaims(user, scope, { includeLegacy: true }));
}

// ==================== 自助注册 ====================

async function register(req, res) {
  const { username, phone, email, password, name, verifyToken } = req.body || {};
  const accountIdentifier = username || phone || email || '';

  const validationErrors = [];
  if (!username && !phone && !email) {
    validationErrors.push('用户名 / 手机号 / 邮箱 至少填写一项');
  }
  if (username && !USERNAME_PATTERN.test(username)) {
    validationErrors.push('用户名需以字母开头，3-32 位字母 / 数字 / 下划线');
  }
  if (phone && !PHONE_PATTERN.test(phone)) {
    validationErrors.push('手机号格式不正确（应为 11 位 1 开头的中国大陆手机号）');
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    validationErrors.push('邮箱格式不正确');
  }
  if (!password || typeof password !== 'string') {
    validationErrors.push('密码不能为空');
  } else if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    validationErrors.push(`密码长度需在 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 位之间`);
  }
  if (validationErrors.length > 0) {
    const reason = validationErrors.join('；');
    writeLoginLog(req, {
      clientId: 'self-register',
      username: accountIdentifier,
      status: 'failure',
      failureReason: `注册参数校验失败: ${reason}`,
    });
    return res.status(400).json({ error: 'invalid_request', error_description: reason });
  }

  // 校验 verifyToken：手机号/邮箱注册必须通过验证码校验
  if (phone || email) {
    if (!verifyToken) {
      return res.status(400).json({
        error: 'verify_required',
        error_description: '请先完成验证码校验',
      });
    }
    const expectedChannel = phone ? 'phone' : 'email';
    const expectedTarget = phone || email;
    const tokenValid = await consumeVerifyToken(verifyToken, expectedChannel, expectedTarget);
    if (!tokenValid) {
      writeLoginLog(req, {
        clientId: 'self-register',
        username: accountIdentifier,
        status: 'failure',
        failureReason: '验证码校验 token 无效或与注册信息不匹配',
      });
      return res.status(400).json({
        error: 'verify_failed',
        error_description: '验证码校验已失效或与注册信息不匹配，请重新验证',
      });
    }
  }

  try {
    const newUser = await createUser({
      username,
      phone,
      email,
      password,
      name: name || username || phone || (email ? email.split('@')[0] : 'New User'),
      role: 'user',
      registerSource: 'self-register',
    });
    logger.info(`📝 自助注册成功: ${newUser.username || newUser.phone || newUser.email}`);
    writeLoginLog(req, {
      clientId: 'self-register',
      username: accountIdentifier,
      userId: newUser.id,
      status: 'success',
      failureReason: '',
    });
    res.json({
      code: 0,
      data: {
        id: newUser.id,
        username: newUser.username,
        phone: newUser.phone,
        email: newUser.email,
        name: newUser.name,
      },
      message: '注册成功',
    });
  } catch (err) {
    writeLoginLog(req, {
      clientId: 'self-register',
      username: accountIdentifier,
      status: 'failure',
      failureReason: err.message || '注册失败',
    });
    res
      .status(400)
      .json({ error: 'register_failed', error_description: err.message || '注册失败' });
  }
}

// ==================== Token 撤销 ====================

async function revokeToken(req, res) {
  const { token: revokeTargetToken, client_id, revoke_all } = req.body;
  const revokeClient = client_id ? await findClientById(client_id) : null;
  if (!revokeClient) {
    return res.status(401).json({ error: 'invalid_client', error_description: '无效的 client_id' });
  }
  if (!revokeTargetToken) {
    return res.status(400).json({ error: 'invalid_request', error_description: '缺少 token 参数' });
  }

  let decoded;
  try {
    decoded = jwt.verify(revokeTargetToken, getPublicKey(), {
      algorithms: [ID_TOKEN_SIGNING_ALG],
      ignoreExpiration: true,
    });
  } catch {
    return res.status(400).json({ error: 'invalid_token', error_description: 'Token 格式无效' });
  }

  const userId = decoded.sub;

  if (revoke_all) {
    const allTokens = await redis.smembers(USER_SESSION_KEY(userId));
    if (allTokens.length > 0) {
      const pipeline = redis.pipeline();
      allTokens.forEach((t) => pipeline.del(SESSION_KEY(t)));
      pipeline.del(USER_SESSION_KEY(userId));
      await pipeline.exec();
    }
    logger.info(`👋 用户 [${decoded.username}] 全局登出，已撤销 ${allTokens.length} 个 Session`);
  } else {
    await redis.del(SESSION_KEY(revokeTargetToken));
    await redis.srem(USER_SESSION_KEY(userId), revokeTargetToken);
    logger.info(`👋 用户 [${decoded.username}] 撤销 Access Token`);
  }

  const oauth2SessionToken = req.cookies[OAUTH2_SESSION_COOKIE_NAME];
  if (oauth2SessionToken) {
    await redis.del(OAUTH2_SESSION_KEY(oauth2SessionToken));
  }
  res.clearCookie(OAUTH2_SESSION_COOKIE_NAME, { path: '/' });
  res.status(200).end();
}

module.exports = {
  authorize,
  loginAndAuthorize,
  mfaVerify,
  mfaResend,
  setCookieAndRedirect,
  logoutGet,
  logoutPost,
  token,
  getUserInfo,
  register,
  revokeToken,
};
