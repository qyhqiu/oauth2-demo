/**
 * SocialConnections Controller — 社会化身份源管理 + Gitee OAuth2 + 公开接口
 */
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const SocialConnection = require('../model/socialConnection.model');
const Client = require('../model/client.model');
const { findUserByEmail, findUserByUsername, createUser } = require('../service/user.service');
const { validateClient } = require('../service/client.service');
const { redis, OAUTH2_SESSION_KEY } = require('../db/redis.db');
const {
  OAUTH2_SERVER_URL,
  OAUTH2_LOGIN_URL,
  OAUTH2_SESSION_EXPIRES_SECONDS,
  OAUTH2_SESSION_COOKIE_NAME,
} = require('../utils/constants');
const LoginLog = require('../model/loginLog.model');
const { extractRequestMeta } = require('../utils/requestMeta');

function writeLoginLog(req, payload) {
  LoginLog.create({ ...extractRequestMeta(req), ...payload }).catch((err) => {
    logger.error('⚠️ [social] LoginLog 写入失败:', err.message);
  });
}

const { checkAccessControl } = require('../service/accessControl.service');

const GITEE_AUTHORIZE_URL = 'https://gitee.com/oauth/authorize';
const GITEE_TOKEN_URL = 'https://gitee.com/oauth/token';
const GITEE_USER_API = 'https://gitee.com/api/v5/user';
const GITEE_EMAILS_API = 'https://gitee.com/api/v5/emails';

const SUPPORTED_PROVIDERS = [
  {
    id: 'gitee',
    name: 'Gitee',
    description: 'Gitee 是基于 Git 的代码托管和研发协作平台。',
    logoUrl: 'https://gitee.com/favicon.ico',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub 是一个面向开源及私有软件项目的托管平台。',
    logoUrl: 'https://github.githubassets.com/favicons/favicon-dark.svg',
  },
  { id: 'wechat', name: '微信', description: '微信是一款跨平台的通讯工具。', logoUrl: '' },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab 是一个用于仓库管理系统的开源项目。',
    logoUrl: '',
  },
];

// ==================== 控制台管理 API ====================

function getTypes(req, res) {
  res.json({ code: 0, data: SUPPORTED_PROVIDERS, message: '' });
}

async function listConnections(req, res) {
  try {
    const connections = await SocialConnection.find().sort({ createdAt: -1 });
    res.json({ code: 0, data: connections, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getSecret(req, res) {
  try {
    const connection = await SocialConnection.findById(req.params.id).select('+clientSecret');
    if (!connection) {
      return res.status(404).json({ code: 404, data: null, message: '身份源不存在' });
    }
    res.json({ code: 0, data: { clientSecret: connection.clientSecret }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getConnection(req, res) {
  try {
    const connection = await SocialConnection.findById(req.params.id).select('+clientSecret');
    if (!connection) {
      return res.status(404).json({ code: 404, data: null, message: '身份源不存在' });
    }
    const data = connection.toObject();
    if (data.clientSecret) {
      const secret = data.clientSecret;
      data.clientSecretMasked =
        secret.length > 8 ? secret.slice(0, 4) + '••••••••' + secret.slice(-4) : '••••••••';
    }
    delete data.clientSecret;
    res.json({ code: 0, data, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function createConnection(req, res) {
  try {
    const {
      provider,
      identifier,
      displayName,
      clientId,
      clientSecret,
      callbackUrl,
      scopes,
      loginMode,
      accountLinking,
      logoUrl,
      description,
    } = req.body;
    if (!provider || !identifier || !displayName || !clientId || !clientSecret) {
      return res.status(400).json({ code: 400, data: null, message: '必填字段不能为空' });
    }
    const existing = await SocialConnection.findOne({ identifier });
    if (existing) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: `唯一标识 [${identifier}] 已存在` });
    }
    const providerInfo = SUPPORTED_PROVIDERS.find((p) => p.id === provider);
    const connection = await SocialConnection.create({
      provider,
      identifier,
      displayName,
      clientId,
      clientSecret,
      callbackUrl: callbackUrl || '',
      scopes:
        scopes && scopes.length > 0
          ? scopes.includes('user_info')
            ? scopes
            : ['user_info', ...scopes]
          : ['user_info'],
      loginMode: loginMode || 'normal',
      accountLinking: accountLinking || false,
      logoUrl: logoUrl || providerInfo?.logoUrl || '',
      description: description || providerInfo?.description || '',
    });
    logger.info(`✅ 创建社会化身份源 [${displayName}] (${provider})`);
    res.json({ code: 0, data: connection, message: '身份源创建成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function updateConnection(req, res) {
  try {
    const allowed = [
      'displayName',
      'clientId',
      'clientSecret',
      'callbackUrl',
      'scopes',
      'enabled',
      'loginMode',
      'accountLinking',
      'logoUrl',
      'description',
    ];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    });
    if (updates.scopes && Array.isArray(updates.scopes) && !updates.scopes.includes('user_info')) {
      updates.scopes = ['user_info', ...updates.scopes];
    }
    const connection = await SocialConnection.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });
    if (!connection) {
      return res.status(404).json({ code: 404, data: null, message: '身份源不存在' });
    }
    res.json({ code: 0, data: connection, message: '更新成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function getLinkedApps(req, res) {
  try {
    const apps = await Client.find({ socialConnectionIds: req.params.id })
      .select('clientId name origin clientType')
      .sort({ createdAt: -1 });
    res.json({ code: 0, data: apps, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function toggleLinkedApp(req, res) {
  try {
    const { linked } = req.body;
    const client = await Client.findOne({ clientId: req.params.appClientId });
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }
    const connectionId = req.params.id;
    const currentIds = (client.socialConnectionIds || []).map(String);
    if (linked && !currentIds.includes(connectionId)) {
      client.socialConnectionIds.push(connectionId);
    } else if (!linked) {
      client.socialConnectionIds = client.socialConnectionIds.filter(
        (id) => String(id) !== connectionId,
      );
    }
    await client.save();
    res.json({ code: 0, data: { linked: !!linked }, message: linked ? '已关联' : '已取消关联' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function deleteConnection(req, res) {
  try {
    const connection = await SocialConnection.findByIdAndDelete(req.params.id);
    if (!connection) {
      return res.status(404).json({ code: 404, data: null, message: '身份源不存在' });
    }
    logger.info(`🗑️ 删除社会化身份源 [${connection.displayName}]`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

// ==================== Gitee OAuth2 ====================

async function giteeAuthorize(req, res) {
  try {
    const connection = await SocialConnection.findOne({ provider: 'gitee', enabled: true }).select(
      '+clientSecret',
    );
    if (!connection) {
      return res.status(404).json({ code: 404, data: null, message: 'Gitee 身份源未配置或已禁用' });
    }

    const stateKey = uuidv4();
    const oauthParams = {
      redirect_uri: req.query.redirect_uri || '',
      state: req.query.state || '',
      scope: req.query.scope || '',
      code_challenge: req.query.code_challenge || '',
      code_challenge_method: req.query.code_challenge_method || '',
      post_login_redirect_uri: req.query.post_login_redirect_uri || '',
    };
    await redis.set(`oauth:social_state:${stateKey}`, JSON.stringify(oauthParams), 'EX', 600);

    const callbackUrl =
      connection.callbackUrl || `${OAUTH2_SERVER_URL}/v1/oauth/social/gitee/callback`;
    const scopes = connection.scopes.length > 0 ? connection.scopes.join(' ') : 'user_info';
    const authorizeUrl = `${GITEE_AUTHORIZE_URL}?client_id=${connection.clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateKey}`;
    res.redirect(authorizeUrl);
  } catch (error) {
    logger.error('[social/gitee] authorize 失败:', error.message);
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function giteeCallback(req, res) {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.redirect(
        `${OAUTH2_LOGIN_URL}?error=missing_code&error_description=${encodeURIComponent('Gitee 授权失败：缺少 code 参数')}`,
      );
    }
    const stateData = await redis.get(`oauth:social_state:${state}`);
    if (!stateData) {
      return res.redirect(
        `${OAUTH2_LOGIN_URL}?error=invalid_state&error_description=${encodeURIComponent('授权状态已过期，请重新登录')}`,
      );
    }
    const oauthParams = JSON.parse(stateData);
    await redis.del(`oauth:social_state:${state}`);

    const connection = await SocialConnection.findOne({ provider: 'gitee', enabled: true }).select(
      '+clientSecret',
    );
    if (!connection) {
      return res.redirect(`${OAUTH2_LOGIN_URL}?error=provider_disabled`);
    }

    const callbackUrl =
      connection.callbackUrl || `${OAUTH2_SERVER_URL}/v1/oauth/social/gitee/callback`;

    // 1. 用 code 换 access_token
    const tokenResp = await axios.post(GITEE_TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      redirect_uri: callbackUrl,
    });
    const giteeAccessToken = tokenResp.data.access_token;
    if (!giteeAccessToken) {
      return res.redirect(
        `${OAUTH2_LOGIN_URL}?error=token_failed&error_description=${encodeURIComponent('获取 Gitee Token 失败')}`,
      );
    }

    // 1.1 自动同步 scope
    const grantedScopeStr = tokenResp.data.scope;
    if (grantedScopeStr) {
      const grantedScopes = grantedScopeStr.split(/[\s,+]+/).filter(Boolean);
      const configuredScopes = connection.scopes || [];
      const validScopes = configuredScopes.filter((s) => grantedScopes.includes(s));
      if (!validScopes.includes('user_info')) {
        validScopes.unshift('user_info');
      }
      const removedScopes = configuredScopes.filter((s) => !grantedScopes.includes(s));
      if (removedScopes.length > 0) {
        logger.info(
          `⚠️ Gitee 实际授权 scope [${grantedScopes.join(', ')}]，移除未授权的 scope: [${removedScopes.join(', ')}]`,
        );
        await SocialConnection.findByIdAndUpdate(connection._id, { scopes: validScopes });
      }
    }

    // 2. 获取 Gitee 用户信息
    const userResp = await axios.get(`${GITEE_USER_API}?access_token=${giteeAccessToken}`);
    const giteeUser = userResp.data;

    // 3. 尝试获取邮箱
    let giteeEmail = giteeUser.email || '';
    if (!giteeEmail) {
      try {
        const emailResp = await axios.get(`${GITEE_EMAILS_API}?access_token=${giteeAccessToken}`);
        if (Array.isArray(emailResp.data) && emailResp.data.length > 0) {
          giteeEmail = emailResp.data[0].email || '';
        }
      } catch (_) {
        /* ignore */
      }
    }

    // 4. 查找或创建本地用户
    let localUser = null;
    const username = `gitee_${giteeUser.login}`;
    localUser = await findUserByUsername(username);
    if (!localUser && giteeEmail && connection.accountLinking) {
      localUser = await findUserByEmail(giteeEmail);
    }
    if (!localUser) {
      if (connection.loginMode === 'login_only') {
        return res.redirect(
          `${OAUTH2_LOGIN_URL}?error=user_not_found&error_description=${encodeURIComponent('该 Gitee 账号未关联任何本地用户，请先用其他方式注册')}`,
        );
      }
      const randomPassword = crypto.randomBytes(16).toString('hex');
      localUser = await createUser({
        username,
        email: giteeEmail || undefined,
        password: randomPassword,
        name: giteeUser.name || giteeUser.login,
        picture: giteeUser.avatar_url || '',
        role: 'user',
        registerSource: 'social',
        emailVerified: !!giteeEmail,
      });
      logger.info(`✅ Gitee 社会化登录，自动创建用户 [${username}]`);
    } else {
      logger.info(`✅ Gitee 社会化登录，已有用户 [${username}]，直接登录`);
    }

    // 4.5 校验用户状态（锁定 / 停用）
    if (localUser.blocked) {
      logger.warn(`🚫 Gitee 社会化登录拒绝：用户 [${username}] 已被锁定`);
      return res.redirect(
        `${OAUTH2_LOGIN_URL}?error=account_blocked&error_description=${encodeURIComponent('该账号已被锁定，请联系管理员解锁')}`,
      );
    }
    if (localUser.status === 'disabled' || localUser.status === 'inactive') {
      logger.warn(`🚫 Gitee 社会化登录拒绝：用户 [${username}] 已被停用`);
      return res.redirect(
        `${OAUTH2_LOGIN_URL}?error=account_disabled&error_description=${encodeURIComponent('该账号已被停用，请联系管理员')}`,
      );
    }

    // 5. 生成 OAuth2 Session
    const oauth2Token = `OAuth2-${uuidv4()}`;
    await redis.set(
      OAUTH2_SESSION_KEY(oauth2Token),
      localUser.id || localUser._id.toString(),
      'EX',
      OAUTH2_SESSION_EXPIRES_SECONDS,
    );

    // 6. 写入 OAuth2 Cookie
    res.cookie(OAUTH2_SESSION_COOKIE_NAME, oauth2Token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: OAUTH2_SESSION_EXPIRES_SECONDS * 1000,
    });

    // 7. 如果有原始 OAuth2 参数，生成 authorization code 并回调
    if (oauthParams.redirect_uri) {
      const { clientId } = await validateClient(oauthParams.redirect_uri, oauthParams.client_id);

      // 7.1 访问控制判断
      const targetClient = await Client.findOne({ clientId });
      if (targetClient) {
        const accessPolicy = targetClient.accessPolicy || {};
        const accessCheck = await checkAccessControl(accessPolicy, localUser);
        if (!accessCheck.allowed) {
          logger.warn(
            `🚫 Gitee 社会化登录拒绝：用户 [${localUser.username}] ${accessCheck.reason}`,
          );
          writeLoginLog(req, {
            clientId,
            username: localUser.username,
            userId: localUser.id || localUser._id.toString(),
            status: 'failure',
            failureReason: accessCheck.reason,
          });
          return res.redirect(
            `${OAUTH2_LOGIN_URL}?error=access_denied&error_description=${encodeURIComponent(accessCheck.reason)}`,
          );
        }
      }

      // 7.2 生成 authorization code
      const authCode = uuidv4();
      const codeData = {
        userId: localUser.id || localUser._id.toString(),
        clientId,
        redirectUri: oauthParams.redirect_uri,
        scope: oauthParams.scope || 'openid profile',
        codeChallenge: oauthParams.code_challenge || '',
        codeChallengeMethod: oauthParams.code_challenge_method || '',
      };
      await redis.set(`oauth:code:${authCode}`, JSON.stringify(codeData), 'EX', 600);

      // 写入登录日志
      writeLoginLog(req, {
        clientId,
        username: localUser.username,
        userId: localUser.id || localUser._id.toString(),
        status: 'success',
      });

      const redirectUrl = new URL(oauthParams.redirect_uri);
      redirectUrl.searchParams.set('code', authCode);
      if (oauthParams.state) {
        redirectUrl.searchParams.set('state', oauthParams.state);
      }
      return res.redirect(redirectUrl.toString());
    }

    res.redirect(OAUTH2_LOGIN_URL);
  } catch (error) {
    logger.error('[social/gitee] callback 失败:', error.message);
    res.redirect(
      `${OAUTH2_LOGIN_URL}?error=callback_failed&error_description=${encodeURIComponent(error.message || 'Gitee 回调处理失败')}`,
    );
  }
}

// ==================== 公开接口 ====================

async function listPublicConnections(req, res) {
  try {
    const { client_id } = req.query;
    const filter = { enabled: true };
    if (client_id) {
      const client = await Client.findOne({ clientId: client_id });
      if (!client) {
        return res.json({ code: 0, data: [], message: '' });
      }
      if (!client.loginPolicy?.enabledLoginMethods?.social) {
        return res.json({ code: 0, data: [], message: '' });
      }
      if (!client.socialConnectionIds || client.socialConnectionIds.length === 0) {
        return res.json({ code: 0, data: [], message: '' });
      }
      filter._id = { $in: client.socialConnectionIds };
    }
    const connections = await SocialConnection.find(filter).select(
      'provider identifier displayName logoUrl',
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ code: 0, data: connections, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

module.exports = {
  getTypes,
  listConnections,
  getSecret,
  getConnection,
  createConnection,
  updateConnection,
  getLinkedApps,
  toggleLinkedApp,
  deleteConnection,
  giteeAuthorize,
  giteeCallback,
  listPublicConnections,
};
