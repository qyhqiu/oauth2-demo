const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const {
  redis,
  SESSION_KEY,
  REFRESH_KEY,
  USER_SESSION_KEY,
  USER_REFRESH_KEY,
  LOGIN_FAIL_KEY,
  LOGIN_LOCK_KEY,
} = require('../db/redis.db');
const {
  ID_TOKEN_SIGNING_ALG,
  ACCESS_TOKEN_EXPIRES_SECONDS,
  REFRESH_TOKEN_EXPIRES_SECONDS,
} = require('../utils/constants');
const { getPrivateKey, getKid } = require('../utils/keystore');
const User = require('../model/user.model');
const Whitelist = require('../model/whitelist.model');
const { getSystemConfig } = require('../model/systemConfig.model');
const { buildClaims } = require('./oidcClaims.service');
const { OAUTH2_SERVER_URL } = require('../utils/constants');

const BCRYPT_SALT_ROUNDS = 10;

/**
 * 校验账号是否在注册白名单内（仅在 whitelistEnabled=true 时调用）
 *
 * 匹配规则：
 *   - phone：精确匹配
 *   - email：精确匹配 + 域名后缀匹配（白名单值以 @ 开头时按域名匹配，如 @company.com）
 *   - username：精确匹配
 *
 * 任一字段命中即视为通过白名单。
 */
async function isAccountInWhitelist({ username, phone, email }) {
  // 收集需要查询的条件：精确匹配 + 邮箱域名匹配
  const orConditions = [];
  if (username) {
    orConditions.push({ type: 'username', value: username });
  }
  if (phone) {
    orConditions.push({ type: 'phone', value: phone });
  }
  if (email) {
    const lowerEmail = email.toLowerCase();
    orConditions.push({ type: 'email', value: lowerEmail });
    // 域名后缀匹配（白名单值形如 @company.com）
    const atIndex = lowerEmail.lastIndexOf('@');
    if (atIndex >= 0) {
      const domainSuffix = lowerEmail.slice(atIndex);
      orConditions.push({ type: 'email', value: domainSuffix });
    }
  }
  if (orConditions.length === 0) {
    return false;
  }

  const hit = await Whitelist.findOne({ $or: orConditions }).lean();
  return !!hit;
}

// 校验 ObjectId 合法性，避免历史 JWT 中遗留的非法 id（如旧 mock 数据的 "1"/"2"/"3"）抛 CastError
function isValidObjectId(id) {
  return (
    id &&
    mongoose.Types.ObjectId.isValid(id) &&
    String(new mongoose.Types.ObjectId(id)) === String(id)
  );
}

// ==================== 查询 ====================

async function findUserByCredentials(usernameOrPhoneOrEmail, password) {
  // 三选一登录：username / phone / email 任一匹配即可
  const query = {
    $or: [
      { username: usernameOrPhoneOrEmail },
      { phone: usernameOrPhoneOrEmail },
      { email: usernameOrPhoneOrEmail.toLowerCase() },
    ],
    status: 'active',
    blocked: { $ne: true },
  };
  // 显式 select +totpSecret：避免 oauth.js MFA 拦截块再做一次重复查询（A4 修复）
  // password 用完即剔除，totpSecret 留给后续 MFA 校验使用
  const user = await User.findOne(query).select('+password +totpSecret');
  if (!user) {
    return null;
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return null;
  }
  // B1/C1 修复：与 findUserById 返回结构保持一致 — 剔除 password + _id，统一暴露 id
  // totpSecret 保留（MFA totp 通道需要校验）；toObject 把 mongoose 文档转 plain object
  const obj = user.toObject();
  const { password: _pwd, _id, ...rest } = obj;
  return { ...rest, id: _id.toString() };
}

async function findUserById(id) {
  // 防御非法 ObjectId（例如旧 JWT 中的字符串 "1"/"2"/"3"）：直接返回 null，不抛异常
  if (!isValidObjectId(id)) {
    return null;
  }
  // 显式 select +totpSecret 用于派生 totpBound 布尔字段（前端 UI 据此显示「已绑定/未绑定」+ TOTP 选项可用性）
  // totpSecret 本身不返回给前端（避免泄漏共享密钥），仅暴露 totpBound: boolean
  const user = await User.findById(id).select('+totpSecret').lean();
  if (!user) {
    return null;
  }
  const { password, _id, totpSecret, ...rest } = user;
  return { ...rest, id: _id.toString(), totpBound: !!totpSecret };
}

/**
 * 仅根据账号标识查找用户（不过滤 status/blocked），用于登录时区分"用户不存在"和"状态异常"
 */
async function findUserByIdentifier(usernameOrPhoneOrEmail) {
  if (!usernameOrPhoneOrEmail) {
    return null;
  }
  const user = await User.findOne({
    $or: [
      { username: usernameOrPhoneOrEmail },
      { phone: usernameOrPhoneOrEmail },
      { email: usernameOrPhoneOrEmail.toLowerCase() },
    ],
  }).lean();
  if (!user) {
    return null;
  }
  const { password, _id, ...rest } = user;
  return { ...rest, id: _id.toString() };
}

async function findUserByUsername(username) {
  if (!username) {
    return null;
  }
  return User.findOne({ username }).lean();
}

async function findUserByPhone(phone) {
  if (!phone) {
    return null;
  }
  return User.findOne({ phone }).lean();
}

async function findUserByEmail(email) {
  if (!email) {
    return null;
  }
  return User.findOne({ email: email.toLowerCase() }).lean();
}

/**
 * 获取用户列表
 *
 * @param {object} [options]
 * @param {'all'|'locked'|'normal'} [options.lockStatus='all'] 锁定状态筛选（E1）
 *   - all    : 全部用户
 *   - locked : 已锁定（blocked=true 或 lockedUntil>now）
 *   - normal : 正常（blocked=false 且 lockedUntil 为空 / 已过期）
 */
async function getAllUsers(options = {}) {
  const { lockStatus = 'all' } = options;

  // 列表场景也要 totpBound：用户列表 / MFA 通道选择器都依赖此布尔字段
  let filter = {};
  if (lockStatus === 'locked') {
    // E1：管理员锁（blocked=true）+ MFA 持久化锁（lockedUntil > now）任一命中即视为已锁定
    filter = { $or: [{ blocked: true }, { lockedUntil: { $gt: new Date() } }] };
  } else if (lockStatus === 'normal') {
    filter = {
      blocked: { $ne: true },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }],
    };
  }

  const users = await User.find(filter).select('+totpSecret').sort({ createdAt: 1 }).lean();
  return users.map(({ _id, password, totpSecret, ...rest }) => ({
    id: _id.toString(),
    ...rest,
    totpBound: !!totpSecret,
  }));
}

// ==================== 新增 ====================

/**
 * 创建用户（支持 username/phone/email 三种身份标识）
 *
 * 管理员创建账号 vs 用户自行注册的差异（按 Authing 文档）：
 * - 管理员创建：跳过「禁止注册」配置 / 跳过「注册白名单」 / 手机号无需验证码 / phoneVerified=false
 * - 用户自注册：必须通过白名单 + 验证码校验 / phoneVerified=true
 *
 * @param {object} data 用户数据
 * @param {'admin'|'self-register'|'import'} [data.registerSource] 注册来源
 */
async function createUser(data) {
  const {
    username = '',
    phone = '',
    email = '',
    password,
    name,
    role = 'user',
    status = 'active',
    nickname = '',
    picture = '',
    gender = 'U',
    registerSource = 'self-register',
    // 当 registerSource === 'admin' 时，下面两个验证状态默认为 false（按 Authing 规范）
    emailVerified,
    phoneVerified,
  } = data;

  // ① 至少需要一个标识字段
  if (!username && !phone && !email) {
    throw new Error('用户名、手机号、邮箱至少需要填写一项');
  }
  if (!password) {
    throw new Error('密码不能为空');
  }
  if (!name) {
    throw new Error('姓名不能为空');
  }

  // ②【注册策略校验】仅对 self-register 来源生效；admin / import 跳过
  //   - registrationEnabled=false：直接拒绝（除非管理员创建）
  //   - whitelistEnabled=true：检查账号是否在白名单内
  if (registerSource === 'self-register') {
    const sysConfig = await getSystemConfig();
    if (!sysConfig.registrationEnabled) {
      throw new Error('系统已禁止用户自行注册，请联系管理员开通账号');
    }
    if (sysConfig.whitelistEnabled) {
      const inWhitelist = await isAccountInWhitelist({ username, phone, email });
      if (!inWhitelist) {
        throw new Error('当前账号不在注册白名单内，无法完成注册');
      }
    }
  }

  // ③ 唯一性校验（无论哪种创建方式都要校验，避免重复账号）
  if (username) {
    const dup = await findUserByUsername(username);
    if (dup) {
      throw new Error(`用户名 [${username}] 已被占用`);
    }
  }
  if (phone) {
    const dup = await findUserByPhone(phone);
    if (dup) {
      throw new Error(`手机号 [${phone}] 已被占用`);
    }
  }
  if (email) {
    const dup = await findUserByEmail(email);
    if (dup) {
      throw new Error(`邮箱 [${email}] 已被占用`);
    }
  }

  // ③ 验证状态默认值（管理员创建为 false；用户自注册为 true）
  const finalEmailVerified =
    emailVerified !== undefined
      ? emailVerified
      : registerSource === 'admin'
        ? false
        : Boolean(email);
  const finalPhoneVerified =
    phoneVerified !== undefined
      ? phoneVerified
      : registerSource === 'admin'
        ? false
        : Boolean(phone);

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // 显式构造 doc：仅在字段真正有值时才 set，避免空串落库破坏 sparse 唯一索引（V1 修复）
  // 即使前端传 phone:'' / email:''，也按未填处理，保证多个「仅用 username 注册」的账号能共存
  const userDoc = {
    password: hashedPassword,
    name,
    nickname,
    picture,
    gender,
    role,
    status,
    emailVerified: finalEmailVerified,
    phoneVerified: finalPhoneVerified,
    registerSource,
  };
  if (username) {
    userDoc.username = username;
  }
  if (phone) {
    userDoc.phone = phone;
  }
  if (email) {
    userDoc.email = email.toLowerCase();
  }

  const user = await User.create(userDoc);

  const obj = user.toObject();
  const { password: _, _id, ...rest } = obj;
  return { id: _id.toString(), ...rest };
}

// ==================== 更新 ====================

async function updateUser(userId, updates) {
  if (!isValidObjectId(userId)) {
    throw new Error(`用户 [${userId}] 不存在`);
  }

  const existing = await User.findById(userId);
  if (!existing) {
    throw new Error(`用户 [${userId}] 不存在`);
  }

  // 唯一字段冲突检查（username / phone / email）
  if (updates.username && updates.username !== existing.username) {
    const conflict = await findUserByUsername(updates.username);
    if (conflict) {
      throw new Error(`用户名 [${updates.username}] 已被占用`);
    }
  }
  if (updates.phone && updates.phone !== existing.phone) {
    const conflict = await findUserByPhone(updates.phone);
    if (conflict) {
      throw new Error(`手机号 [${updates.phone}] 已被占用`);
    }
  }
  if (updates.email && updates.email.toLowerCase() !== (existing.email || '').toLowerCase()) {
    const conflict = await findUserByEmail(updates.email);
    if (conflict) {
      throw new Error(`邮箱 [${updates.email}] 已被占用`);
    }
  }

  const allowedFields = [
    // 账号标识
    'username',
    'phone',
    'email',
    // 资料
    'name',
    'nickname',
    'picture',
    'gender',
    'birthdate',
    'address',
    'company',
    'website',
    'profile',
    'preferredUsername',
    // 验证状态
    'emailVerified',
    'phoneVerified',
    // 系统
    'role',
    'status',
    'blocked',
    // MFA
    'mfaEnabled',
    'mfaChannel',
    // 国际化
    'zoneinfo',
    'locale',
    // 自定义
    'customData',
  ];
  const safeUpdates = {};
  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  });

  if (safeUpdates.email) {
    safeUpdates.email = safeUpdates.email.toLowerCase();
  }

  // 密码单独处理：有值则加密
  if (updates.password) {
    safeUpdates.password = await bcrypt.hash(updates.password, BCRYPT_SALT_ROUNDS);
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: safeUpdates },
    { returnDocument: 'after', runValidators: true },
  ).lean();

  const { _id, password, ...rest } = updated;
  return { id: _id.toString(), ...rest };
}

// ==================== 删除 ====================

async function deleteUser(userId) {
  if (!isValidObjectId(userId)) {
    throw new Error(`用户 [${userId}] 不存在`);
  }
  const result = await User.findByIdAndDelete(userId);
  if (!result) {
    throw new Error(`用户 [${userId}] 不存在`);
  }
  return true;
}

// ==================== Token 相关 ====================

/**
 * 生成 Access Token（RS256 签名）
 *
 * 按 OAuth2 §1.4 / OIDC Core 规范，access_token 应保持精简，
 * 主要承载身份标识（sub）+ 受众（aud=client_id）+ 有效期（exp）。
 * 详细的 user profile 应通过 /oauth/userinfo 按 scope 拉取，避免 access_token 过大。
 *
 * 兼容历史：保留 username/name/role/email 字段（业务前端 jwt-decode 后直接用），
 * 但新增 aud / iss / iat 等 OIDC 标准 claim，符合 RFC 7519。
 *
 * @param {object} user 用户对象
 * @param {string} clientId 客户端 ID
 * @param {number} [expiresInSeconds] 自定义有效期（秒）。默认使用全局 ACCESS_TOKEN_EXPIRES_SECONDS
 * @returns {Promise<string>} JWT
 */
async function generateAccessToken(user, clientId, expiresInSeconds, scope) {
  // C1：findUserById / findUserByCredentials 都已统一暴露 user.id，无需兜底
  const userId = user.id;
  const ttl = expiresInSeconds || ACCESS_TOKEN_EXPIRES_SECONDS;

  // 用 RSA 私钥 + RS256 签名；header 携带 kid，方便客户端通过 jwks.json 找到对应公钥验签
  const accessToken = jwt.sign(
    {
      // —— OIDC / RFC 7519 标准 claim ——
      iss: OAUTH2_SERVER_URL, // Issuer：识别 Token 颁发方
      sub: userId, // Subject：用户唯一标识
      aud: clientId, // Audience：Token 受众（哪个 client）
      // scope：授权时的 scope 字符串。userinfo 端点据此按 OIDC StandardClaims 投影
      // 缺省 'openid profile email phone'，保证老调用方能拿到原有字段
      scope: scope || 'openid profile email phone',
      // exp / iat 由 jsonwebtoken 自动注入（依赖 expiresIn 选项）
      // —— 兼容字段（业务前端 jwt-decode 直接读，迁移期保留）——
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      client_id: clientId,
      token_type: 'access_token',
    },
    getPrivateKey(),
    {
      algorithm: ID_TOKEN_SIGNING_ALG,
      expiresIn: ttl,
      keyid: getKid(),
    },
  );

  await redis.set(SESSION_KEY(accessToken), userId, 'EX', ttl);
  await redis.sadd(USER_SESSION_KEY(userId), accessToken);
  await redis.expire(USER_SESSION_KEY(userId), ttl);

  return accessToken;
}

/**
 * 生成 ID Token（OIDC Core §2 ID Token）
 *
 * 触发条件：scope 含 'openid' 时，token 端点必须额外返回 id_token（OIDC 严格规范）。
 * id_token 是用户身份的"自包含凭证"：客户端拿到后无需再调 userinfo 即可获取已授权的 claim。
 *
 * 标准 claim（OIDC Core §2）：
 *   iss / sub / aud / exp / iat - 必备
 *   auth_time - 用户最近一次完成认证的 Unix 秒级时间
 *   nonce     - 透传授权请求中的 nonce，防重放（如客户端有传）
 *
 * @param {object} user 用户对象（含 id / username / lastLogin 等）
 * @param {string} clientId 客户端 ID（id_token 的 aud）
 * @param {string} scope 授权 scope，决定 claims 投影范围
 * @param {object} [options]
 * @param {string} [options.nonce] 授权请求透传的 nonce（OIDC §3.1.2.1）
 * @param {number} [options.expiresInSeconds] 自定义 id_token 有效期（默认与 access_token 一致）
 * @returns {string} JWT
 */
function generateIdToken(user, clientId, scope, options = {}) {
  const { nonce, expiresInSeconds } = options;
  const ttl = expiresInSeconds || ACCESS_TOKEN_EXPIRES_SECONDS;
  // 按 scope 投影出本次授权允许返回的 claim
  const claims = buildClaims(user, scope, { includeLegacy: false });

  const payload = {
    // OIDC §2 必备 claim
    iss: OAUTH2_SERVER_URL,
    aud: clientId,
    auth_time: Math.floor(
      (user.lastLogin ? new Date(user.lastLogin).getTime() : Date.now()) / 1000,
    ),
    // 透传授权请求中的 nonce，防重放攻击（OIDC §3.1.2.1 / §3.1.3.7）
    ...(nonce ? { nonce } : {}),
    // 投影后的 StandardClaims（已含 sub）
    ...claims,
  };

  return jwt.sign(payload, getPrivateKey(), {
    algorithm: ID_TOKEN_SIGNING_ALG,
    expiresIn: ttl,
    keyid: getKid(),
  });
}

async function generateRefreshToken(userId, clientId, scope) {
  const refreshToken = `RT-${uuidv4()}`;
  const payload = JSON.stringify({ userId, clientId, scope });
  await redis.set(REFRESH_KEY(refreshToken), payload, 'EX', REFRESH_TOKEN_EXPIRES_SECONDS);
  // 记录 refresh_token 到用户维度索引，force-logout 时可一并撤销
  await redis.sadd(USER_REFRESH_KEY(userId), refreshToken);
  await redis.expire(USER_REFRESH_KEY(userId), REFRESH_TOKEN_EXPIRES_SECONDS);
  return refreshToken;
}

// ==================== 绑定/换绑（带验证码校验，由路由层调用前先 verifyCode） ====================

/**
 * 绑定/换绑手机号
 * @param {string} userId
 * @param {string} newPhone 新手机号
 */
async function bindPhone(userId, newPhone) {
  if (!newPhone) {
    throw new Error('新手机号不能为空');
  }
  // 唯一性校验（排除自己）
  const existing = await findUserByPhone(newPhone);
  if (existing && existing._id.toString() !== userId) {
    throw new Error(`手机号 [${newPhone}] 已被其他账号占用`);
  }
  return updateUser(userId, { phone: newPhone, phoneVerified: true });
}

/**
 * 绑定/换绑邮箱
 * @param {string} userId
 * @param {string} newEmail 新邮箱
 */
async function bindEmail(userId, newEmail) {
  if (!newEmail) {
    throw new Error('新邮箱不能为空');
  }
  const existing = await findUserByEmail(newEmail);
  if (existing && existing._id.toString() !== userId) {
    throw new Error(`邮箱 [${newEmail}] 已被其他账号占用`);
  }
  return updateUser(userId, { email: newEmail, emailVerified: true });
}

/**
 * 解绑手机号（仅在还有其他登录方式时允许）
 */
async function unbindPhone(userId) {
  if (!isValidObjectId(userId)) {
    throw new Error(`用户 [${userId}] 不存在`);
  }
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('用户不存在');
  }
  if (!user.username && !user.email) {
    throw new Error('解绑后将无任何登录方式，请先绑定用户名或邮箱');
  }
  user.phone = '';
  user.phoneVerified = false;
  await user.save();
  return findUserById(userId);
}

// ==================== D2: MFA 失败联动账号锁定 ====================

// 默认策略：当 client.loginPolicy 缺失时回退到这套（与 oauth.js getEffectivePolicies 保持一致）
const DEFAULT_LOGIN_POLICY = {
  maxLoginFailures: 5,
  lockoutDurationMinutes: 30,
};

/**
 * 检查用户是否处于持久化锁定状态（D2）
 *
 * 与 redis LOGIN_LOCK_KEY 的差异：
 *   - redis 锁是「客户端 + 用户名」维度，重启 redis 即失效，适合短期保护
 *   - 持久化锁基于 user.lockedUntil，跨服务重启依然有效，适合 MFA 锁这种安全级更高的场景
 *
 * 副作用：如果 lockedUntil <= now（已过期），自动清零并解锁，调用方无需手动维护
 *
 * @param {string} userId
 * @returns {Promise<{locked: boolean, reason: string, remainSeconds: number}>}
 */
async function isUserLocked(userId) {
  if (!isValidObjectId(userId)) {
    return { locked: false, reason: '', remainSeconds: 0 };
  }
  const user = await User.findById(userId).select('lockedUntil failedLoginAttempts blocked').lean();
  if (!user) {
    return { locked: false, reason: '', remainSeconds: 0 };
  }

  // 区分两类锁定（按 lockedUntil 是否存在判断）：
  //   1. 持久化 MFA/密码自动锁：blocked=true + lockedUntil>now，到期自动清零
  //   2. 管理员手动锁：blocked=true + lockedUntil=null，永久生效，必须管理员显式 PUT blocked=false 解锁
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return { locked: true, reason: '连续 MFA 验证失败次数过多', remainSeconds };
  }
  if (user.blocked && !user.lockedUntil) {
    return { locked: true, reason: '账号已被管理员锁定', remainSeconds: -1 };
  }

  // lockedUntil 已过期 → 自动清零（写库一次即可，避免每次登录都比较时间）
  // 注意：仅在 lockedUntil 真实存在且已过期时才清零；纯管理员锁（lockedUntil=null）不会进入此分支
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await User.updateOne(
      { _id: userId },
      { $set: { lockedUntil: null, failedLoginAttempts: 0, blocked: false } },
    );
  }
  return { locked: false, reason: '', remainSeconds: 0 };
}

/**
 * MFA 验证失败 — 累计失败次数，达到阈值时锁定账号（D2 / E3）
 *
 * 复用 client.loginPolicy.maxLoginFailures + lockoutDurationMinutes，
 * 与密码失败的 redis LOGIN_LOCK_KEY 形成「短期内存锁 + 持久化数据库锁」双层保护
 *
 * E3：如果传入 requestMeta，会同步写入 lastFailedLoginIp / lastFailedLoginAt，
 * 便于管理员在用户详情页快速判断「是否疑似攻击」（O(1) 查询，避免每次去 LoginLog 翻流水）
 *
 * @param {string} userId
 * @param {object} [client] 客户端对象，可选；不传时用默认策略
 * @param {object} [requestMeta] 请求元数据，可选；形如 { ip, userAgent, ... }（来自 extractRequestMeta(req)）
 * @returns {Promise<{locked: boolean, failedAttempts: number, threshold: number, lockoutMinutes: number}>}
 */
async function incrementMfaFailure(userId, client, requestMeta) {
  if (!isValidObjectId(userId)) {
    return { locked: false, failedAttempts: 0, threshold: 0, lockoutMinutes: 0 };
  }
  const policy = { ...DEFAULT_LOGIN_POLICY, ...(client?.loginPolicy || {}) };

  const user = await User.findById(userId);
  if (!user) {
    return {
      locked: false,
      failedAttempts: 0,
      threshold: policy.maxLoginFailures,
      lockoutMinutes: policy.lockoutDurationMinutes,
    };
  }

  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  let triggeredLock = false;
  if (user.failedLoginAttempts >= policy.maxLoginFailures) {
    user.blocked = true;
    user.lockedUntil = new Date(Date.now() + policy.lockoutDurationMinutes * 60 * 1000);
    triggeredLock = true;
  }

  // E3：写入风控审计字段（如果提供了 requestMeta）
  if (requestMeta && requestMeta.ip) {
    user.lastFailedLoginIp = requestMeta.ip;
    user.lastFailedLoginAt = new Date();
  }

  await user.save();

  return {
    locked: triggeredLock,
    failedAttempts: user.failedLoginAttempts,
    threshold: policy.maxLoginFailures,
    lockoutMinutes: policy.lockoutDurationMinutes,
  };
}

/**
 * 一键解锁账号（E2）— 清零所有锁定相关状态 + 同步清 redis 短期锁
 *
 * 与原 PUT /:userId 仅改 blocked 的差异：
 *   - blocked = false（解除管理员锁定 / 自动锁定标记）
 *   - lockedUntil = null（解除持久化锁定）
 *   - failedLoginAttempts = 0（清零计数，避免下次再失败 1 次就直接锁定）
 *   - 扫描所有 client 的 LOGIN_LOCK_KEY / LOGIN_FAIL_KEY 并删除（避免「换个 client 还是被锁」）
 *
 * @param {string} userId
 * @returns {Promise<{user: object, clearedRedisKeys: number}>}
 */
async function unlockUser(userId) {
  if (!isValidObjectId(userId)) {
    throw new Error(`用户 [${userId}] 不存在`);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error(`用户 [${userId}] 不存在`);
  }

  // 清零持久化锁定状态
  user.blocked = false;
  user.lockedUntil = null;
  user.failedLoginAttempts = 0;
  await user.save();

  // 清 redis 短期锁（按 userId 维度清除所有 client 下的锁定/失败计数）
  const failPattern = LOGIN_FAIL_KEY('*', userId);
  const lockPattern = LOGIN_LOCK_KEY('*', userId);
  let clearedRedisKeys = 0;
  // ioredis keys 在 demo 体量下没问题；生产建议用 SCAN 替代避免阻塞
  const failKeys = await redis.keys(failPattern);
  const lockKeys = await redis.keys(lockPattern);
  if (failKeys.length > 0) {
    await redis.del(...failKeys);
    clearedRedisKeys += failKeys.length;
  }
  if (lockKeys.length > 0) {
    await redis.del(...lockKeys);
    clearedRedisKeys += lockKeys.length;
  }

  const result = await findUserById(userId);
  return { user: result, clearedRedisKeys };
}

/**
 * MFA 验证成功 / 密码登录成功 — 清零失败计数（D2）
 *
 * 注意：不会主动解除 blocked，因为 blocked 也可能是管理员手动锁定的；
 * 但会清除 lockedUntil（持久化锁过期解锁的场景）和 failedLoginAttempts
 *
 * @param {string} userId
 */
async function clearMfaFailure(userId) {
  if (!isValidObjectId(userId)) {
    return;
  }
  await User.updateOne({ _id: userId }, { $set: { failedLoginAttempts: 0, lockedUntil: null } });
}

/**
 * 解绑邮箱（仅在还有其他登录方式时允许）
 */
async function unbindEmail(userId) {
  if (!isValidObjectId(userId)) {
    throw new Error(`用户 [${userId}] 不存在`);
  }
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('用户不存在');
  }
  if (!user.username && !user.phone) {
    throw new Error('解绑后将无任何登录方式，请先绑定用户名或手机号');
  }
  user.email = '';
  user.emailVerified = false;
  await user.save();
  return findUserById(userId);
}

module.exports = {
  getAllUsers,
  findUserByCredentials,
  findUserByIdentifier,
  findUserById,
  findUserByUsername,
  findUserByPhone,
  findUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  bindPhone,
  bindEmail,
  unbindPhone,
  unbindEmail,
  generateAccessToken,
  generateRefreshToken,
  // K1·OIDC：id_token 颁发（scope 含 openid 时由 token 端点调用）
  generateIdToken,
  // D2：MFA 失败联动账号锁定
  isUserLocked,
  incrementMfaFailure,
  clearMfaFailure,
  // E2：一键解锁
  unlockUser,
};
