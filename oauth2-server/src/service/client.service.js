const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const crypto = require('crypto');
const Client = require('../model/client.model');

// ==================== K3：App Secret 工具 ====================
/**
 * 生成一个 App Secret（64 位 hex = 32 字节随机熵）
 * 安全要求：必须用 crypto.randomBytes，不能用 Math.random / uuid（uuid 熵只有 122 bit 且可预测格式）
 */
function generateAppSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Confidential Client 类型（必须强制校验 client_secret 才能换 token）
// web / spa 运行在浏览器端，不应暴露 client_secret，统一走 PKCE 流程
// 只有 native（客户端应用）、service（后端应用）、miniapp（小程序）有安全后端，才需要 secret
const CONFIDENTIAL_CLIENT_TYPES = new Set(['native', 'service', 'miniapp']);
function isConfidentialClient(client) {
  return CONFIDENTIAL_CLIENT_TYPES.has(client?.clientType);
}

// Public Client 类型（浏览器端应用，强制走 PKCE）
const PUBLIC_CLIENT_TYPES = new Set(['web', 'spa']);
function isPublicClient(client) {
  return PUBLIC_CLIENT_TYPES.has(client?.clientType);
}

// ==================== 查询 ====================

async function getAllClients() {
  // 列表接口默认不返回 clientSecret（敏感字段），需要时调 findClientByIdWithSecret
  const clients = await Client.find().sort({ createdAt: 1 }).lean();
  return clients.map((c) => ({ ...c, _id: undefined }));
}

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return String(origin).replace(/\/\/+$/, '');
  }
}

async function findClientByOrigin(origin) {
  // findClientByOrigin 在 oauth 流程中用于校验 redirect_uri，不需要 secret（PKCE/secret 校验在 token 端点单独做）
  const normalizedOrigin = normalizeOrigin(origin);
  return Client.findOne({ origin: { $in: [normalizedOrigin, `${normalizedOrigin}/`] } }).lean();
}

async function findClientById(clientId) {
  return Client.findOne({ clientId }).lean();
}

/**
 * K3：获取应用详情（含 clientSecret，仅控制台 GET /apps/:id 使用）
 * 普通 OAuth 流程不应调用本方法，避免 secret 泄漏到非控制台路径
 */
async function findClientByIdWithSecret(clientId) {
  return Client.findOne({ clientId }).select('+clientSecret').lean();
}

// ==================== 新增 ====================

async function createClient(data) {
  const {
    name,
    origin,
    description = '',
    scope = ['openid', 'profile'],
    type,
    clientType,
    redirectUris = [],
  } = data;

  if (!name || !origin) {
    throw new Error('name 和 origin 为必填项');
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const existing = await findClientByOrigin(normalizedOrigin);
  if (existing) {
    throw new Error(`origin [${normalizedOrigin}] 已被应用 [${existing.name}] 占用`);
  }

  // 兼容前端 CreateAppDrawer 传 'type' 字段（参数名）→ 持久化为 clientType
  const finalClientType = clientType || type || 'web';
  const allowedTypes = ['web', 'spa', 'native', 'service', 'miniapp'];
  if (!allowedTypes.includes(finalClientType)) {
    throw new Error(`不支持的应用类型 [${finalClientType}]`);
  }

  const client = await Client.create({
    clientId: `app-${uuidv4().split('-')[0]}`,
    // K3：自动生成 App Secret（所有应用都生成，仅 web/service 在 token 端点强制校验）
    clientSecret: generateAppSecret(),
    clientType: finalClientType,
    name,
    origin: normalizedOrigin,
    redirectUris: Array.isArray(redirectUris) ? redirectUris.filter((uri) => uri).map(String) : [],
    description,
    scope: Array.isArray(scope) ? scope : String(scope).split(' ').filter(Boolean),
    pkce: true,
  });

  // 创建时把 clientSecret 一次性返回（前端可立即展示一次"明文"，之后须主动刷新）
  const obj = client.toObject();
  return { ...obj, _id: undefined, clientSecret: client.clientSecret };
}

/**
 * K3：刷新（重置）App Secret
 * 旧 secret 立即失效；返回新生成的 secret（一次性明文，之后只能再次刷新）
 */
async function refreshClientSecret(clientId) {
  const newSecret = generateAppSecret();
  const updated = await Client.findOneAndUpdate(
    { clientId },
    { $set: { clientSecret: newSecret } },
    { returnDocument: 'after' },
  )
    .select('+clientSecret')
    .lean();
  if (!updated) {
    throw new Error(`客户端 [${clientId}] 不存在`);
  }
  return { clientId: updated.clientId, clientSecret: updated.clientSecret };
}

// ==================== 更新 ====================

async function updateClient(clientId, updates) {
  const existing = await Client.findOne({ clientId });
  if (!existing) {
    throw new Error(`客户端 [${clientId}] 不存在`);
  }

  const allowedFields = [
    'name',
    'origin',
    'redirectUris',
    'postLoginRedirectUri',
    'description',
    'scope',
    'pkce',
    // K3：clientType 允许更新（仅控制台），但不在此处直接更新 clientSecret（必须走 refreshClientSecret）
    'clientType',
    // 新增的策略字段：登录控制 / 访问授权 / 品牌化
    'loginPolicy',
    'accessPolicy',
    'branding',
    // 社会化身份源关联
    'socialConnectionIds',
  ];
  const safeUpdates = {};

  if (updates.origin) {
    const normalizedUpdateOrigin = normalizeOrigin(updates.origin);
    if (normalizedUpdateOrigin !== existing.origin) {
      const conflicting = await Client.findOne({
        origin: normalizedUpdateOrigin,
        clientId: { $ne: clientId },
      });
      if (conflicting) {
        throw new Error(`origin [${normalizedUpdateOrigin}] 已被应用 [${conflicting.name}] 占用`);
      }
      safeUpdates.origin = normalizedUpdateOrigin;
    }
  }

  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  });

  const updated = await Client.findOneAndUpdate(
    { clientId },
    { $set: safeUpdates },
    { returnDocument: 'after', runValidators: true },
  ).lean();

  return updated;
}

// ==================== 删除 ====================

async function deleteClient(clientId) {
  const result = await Client.deleteOne({ clientId });
  if (result.deletedCount === 0) {
    throw new Error(`客户端 [${clientId}] 不存在`);
  }
  return true;
}

// ==================== 校验 ====================

/**
 * 校验客户端身份（OIDC 标准做法）
 * - 有 clientId：用 clientId 精确查找，再校验 redirect_uri 的 origin 匹配
 * - 无 clientId：退化为用 redirect_uri 的 origin 反查（向后兼容）
 */
function normalizeRedirectUri(uri) {
  try {
    const url = new URL(uri);
    return `${url.origin}${url.pathname}${url.search}`.replace(/\/+$/, '');
  } catch {
    return String(uri).replace(/\/+$/, '');
  }
}

function normalizeRedirectUriBase(uri) {
  try {
    const url = new URL(uri);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function validateClient(redirectUri, clientId) {
  if (!redirectUri) {
    return { valid: false, error: '缺少 redirect_uri' };
  }

  let requestOrigin;
  try {
    requestOrigin = new URL(redirectUri).origin;
  } catch {
    return { valid: false, error: '无效的 redirect_uri 格式' };
  }

  // 标准路径：用 clientId 精确查找
  if (clientId) {
    const client = await findClientById(clientId);
    if (!client) {
      return { valid: false, error: `未找到 client_id [${clientId}] 对应的客户端` };
    }

    const registeredUris = client.redirectUris || [];
    if (registeredUris.length > 0) {
      const normalizedRequestUri = normalizeRedirectUri(redirectUri);
      const match = registeredUris.some(
        (uri) => normalizeRedirectUri(uri) === normalizedRequestUri,
      );
      if (!match) {
        return {
          valid: false,
          error: `redirect_uri [${redirectUri}] 未在应用注册的回调地址列表中`,
        };
      }
      return { valid: true, client, clientId: client.clientId };
    }

    // normalize：统一去除尾部斜杠后比较 origin
    const registeredOrigin = client.origin.replace(/\/+$/, '');
    if (registeredOrigin !== requestOrigin) {
      return {
        valid: false,
        error: `redirect_uri 的 origin [${requestOrigin}] 与客户端注册的 [${registeredOrigin}] 不匹配`,
      };
    }
    return { valid: true, client, clientId: client.clientId };
  }

  // 兼容路径：用 origin 反查
  const client = await findClientByOrigin(requestOrigin);
  if (!client) {
    return {
      valid: false,
      error: `未找到 origin [${requestOrigin}] 对应的客户端，请联系管理员注册`,
    };
  }

  return { valid: true, client, clientId: client.clientId };
}

async function isRegisteredRedirectUri(redirectUri) {
  try {
    const normalizedRedirectUri = normalizeRedirectUri(redirectUri);
    const requestOrigin = new URL(redirectUri).origin;
    const client = await findClientByOrigin(requestOrigin);
    if (!client) {
      logger.info(
        `[client.service] isRegisteredRedirectUri: no client found for origin ${requestOrigin} (redirectUri=${redirectUri})`,
      );
      return false;
    }
    if (Array.isArray(client.redirectUris) && client.redirectUris.length > 0) {
      const normalizedRedirectUriBase = normalizeRedirectUriBase(redirectUri);
      const matched = client.redirectUris.some((uri) => {
        if (normalizeRedirectUri(uri) === normalizedRedirectUri) {
          return true;
        }
        const registeredBase = normalizeRedirectUriBase(uri);
        return (
          registeredBase &&
          normalizedRedirectUriBase &&
          registeredBase === normalizedRedirectUriBase
        );
      });
      if (!matched) {
        logger.info(
          `[client.service] isRegisteredRedirectUri: redirectUri ${redirectUri} did not match registered redirectUris [${(client.redirectUris || []).join(', ')}] for client ${client.clientId}`,
        );
      }
      return matched;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveGrantedScope(requestedScope, registeredScopes) {
  const requested = (requestedScope || '').split(' ').filter(Boolean);
  const granted = requested.filter((s) => registeredScopes.includes(s));
  return granted.length > 0 ? granted.join(' ') : registeredScopes.join(' ');
}

/**
 * 启动时确保控制台自身的 OAuth2 client 已注册
 * - clientId 固定为 'console-app'，origin 为 CONSOLE_URL
 * - 已存在则跳过；origin 变更（端口调整）会自动同步更新
 * - accessPolicy.allowedRoles 限制为 ['admin']，仅管理员可登录控制台
 */
async function ensureConsoleClientRegistered(consoleOrigin) {
  const CONSOLE_CLIENT_ID = 'console-app';
  const desired = {
    clientId: CONSOLE_CLIENT_ID,
    // K3：控制台是 SPA（运行在浏览器，无法保密 secret），强制走 PKCE
    clientType: 'spa',
    name: 'OAuth2 控制台',
    origin: consoleOrigin,
    description: '控制台自身（系统应用，请勿删除）',
    scope: ['openid', 'profile'],
    pkce: true,
    loginPolicy: {
      enabled: true,
      allowRegister: false,
      maxLoginFailures: 5,
      lockoutDurationMinutes: 30,
      ssoEnabled: true,
    },
    accessPolicy: {
      allowedRoles: ['admin'],
      requirePkce: true,
      tokenExpiresInSeconds: 8 * 60 * 60,
    },
    branding: {
      logoUrl: '',
      primaryColor: '#5b50e8',
      welcomeText: '欢迎登录 OAuth2 控制台',
      copyright: 'OAuth2 Demo · Aone Copilot',
    },
  };

  const existing = await Client.findOne({ clientId: CONSOLE_CLIENT_ID }).select('+clientSecret');
  if (!existing) {
    // 控制台是 SPA，仍然生成一个 secret（不强制使用，但保持字段一致）
    await Client.create({ ...desired, clientSecret: generateAppSecret() });
    logger.info(`🆕 已自动注册控制台 OAuth2 client：[${CONSOLE_CLIENT_ID}] -> ${consoleOrigin}`);
    return;
  }
  // origin 变更（如改端口）时自动同步，避免手动维护
  if (existing.origin !== consoleOrigin) {
    await Client.updateOne({ clientId: CONSOLE_CLIENT_ID }, { $set: { origin: consoleOrigin } });
    logger.info(`🔄 控制台 client origin 已同步：${existing.origin} → ${consoleOrigin}`);
  }
  // K3 兼容：老数据缺 clientType / clientSecret 时补齐
  const patch = {};
  if (!existing.clientType) {
    patch.clientType = 'spa';
  }
  if (!existing.clientSecret) {
    patch.clientSecret = generateAppSecret();
  }
  if (Object.keys(patch).length > 0) {
    await Client.updateOne({ clientId: CONSOLE_CLIENT_ID }, { $set: patch });
    logger.info(`🔧 控制台 client 已补齐 K3 字段：${Object.keys(patch).join(', ')}`);
  }
}

/**
 * K3：批量给现有 Client 数据补齐 clientType / clientSecret（启动时一次性数据迁移）
 * 不影响已有的 console-app（在 ensureConsoleClientRegistered 单独处理）
 */
async function ensureClientSecretsBackfilled() {
  const candidates = await Client.find({
    $or: [
      { clientSecret: { $in: [null, '', undefined] } },
      { clientType: { $in: [null, '', undefined] } },
    ],
  })
    .select('+clientSecret')
    .lean();
  if (candidates.length === 0) {
    return 0;
  }

  for (const c of candidates) {
    const patch = {};
    if (!c.clientSecret) {
      patch.clientSecret = generateAppSecret();
    }
    // 默认按 SPA（Public Client）处理：现有老应用均通过 oauth2-js-sdk 在浏览器前端调 /oauth/token，
    // 不可能携带 secret，必须走 PKCE。如果确实是后端服务型应用，管理员在控制台手动改为 web/service。
    if (!c.clientType) {
      patch.clientType = 'spa';
    }
    if (Object.keys(patch).length > 0) {
      await Client.updateOne({ clientId: c.clientId }, { $set: patch });
    }
  }
  logger.info(`🔧 已为 ${candidates.length} 个老应用补齐 K3 字段（clientSecret / clientType）`);
  return candidates.length;
}

module.exports = {
  getAllClients,
  findClientByOrigin,
  findClientById,
  findClientByIdWithSecret,
  createClient,
  updateClient,
  deleteClient,
  validateClient,
  isRegisteredRedirectUri,
  resolveGrantedScope,
  ensureConsoleClientRegistered,
  ensureClientSecretsBackfilled,
  // K3：App Secret 工具
  generateAppSecret,
  refreshClientSecret,
  isConfidentialClient,
  isPublicClient,
};
