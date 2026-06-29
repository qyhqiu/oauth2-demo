/**
 * OIDC Claims 投影服务
 *
 * 标准参考：
 * - OpenID Connect Core 1.0 §5.1 Standard Claims
 *   https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
 * - OIDC Core §5.4 Requesting Claims using Scope Values
 *
 * 职责：
 * - 把内部 User 模型按授权 scope 投影成符合 OIDC StandardClaims 规范的 claim 对象
 * - userinfo 端点 / id_token payload 都复用本服务，确保两边输出一致
 *
 * Scope → Claims 映射规则（OIDC Core §5.4）：
 *   openid  → sub
 *   profile → name, given_name, family_name, middle_name, nickname, preferred_username,
 *             profile, picture, website, gender, birthdate, zoneinfo, locale, updated_at
 *   email   → email, email_verified
 *   phone   → phone_number, phone_number_verified
 *   address → address (formatted)
 */

/**
 * 把 Date 对象转为 OIDC 规范的 birthdate 字符串（YYYY-MM-DD）
 * 缺失时返回 undefined（OIDC 规定缺失的 claim 不应输出 null）
 */
function formatBirthdate(date) {
  if (!date) {
    return undefined;
  }
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return undefined;
  }
}

/**
 * 把 Date 对象转为 OIDC 规范的 updated_at（Unix 秒级时间戳）
 */
function toUnixSeconds(date) {
  if (!date) {
    return Math.floor(Date.now() / 1000);
  }
  try {
    return Math.floor(new Date(date).getTime() / 1000);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * 解析 scope 字符串为数组（兼容空格分隔 / 数组传入）
 */
function parseScope(scope) {
  if (Array.isArray(scope)) {
    return scope;
  }
  if (!scope || typeof scope !== 'string') {
    return ['openid'];
  }
  return scope.split(/\s+/).filter(Boolean);
}

/**
 * 删除值为 undefined / null / '' 的字段
 * OIDC 规定：缺失的 claim 不应出现在 JSON 中（避免客户端误判为已绑定空值）
 */
function compact(obj) {
  const result = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') {
      return;
    }
    result[k] = v;
  });
  return result;
}

/**
 * 按 scope 投影 user → OIDC StandardClaims
 *
 * @param {object} user - userService.findUserById 返回的对象（含 id 字段）
 * @param {string|string[]} scope - 'openid profile email phone' 或数组
 * @param {object} [options]
 * @param {boolean} [options.includeLegacy=true] - 是否同时附带旧字段（username/role），保持向后兼容
 * @returns {object} 投影后的 claims 对象
 */
function buildClaims(user, scope, options = {}) {
  const { includeLegacy = true } = options;
  const scopes = parseScope(scope);
  const has = (s) => scopes.includes(s);

  // —— openid（必备）——
  // sub = 用户在 OAuth2 内的稳定唯一标识
  const claims = {
    sub: user.id || user._id?.toString(),
  };

  // —— profile —— OIDC StandardClaims 个人资料类
  if (has('profile')) {
    Object.assign(
      claims,
      compact({
        name: user.name,
        given_name: user.givenName,
        family_name: user.familyName,
        middle_name: user.middleName,
        nickname: user.nickname,
        preferred_username: user.preferredUsername || user.username,
        profile: user.profile,
        // 统一使用 picture 字段，兼容回退到老字段 photo
        picture: user.picture || user.photo || '',
        website: user.website,
        // OIDC §5.1：gender 推荐用 'female' / 'male'，其它值也允许
        gender: user.gender === 'M' ? 'male' : user.gender === 'F' ? 'female' : undefined,
        birthdate: formatBirthdate(user.birthdate),
        zoneinfo: user.zoneinfo,
        locale: user.locale,
        updated_at: toUnixSeconds(user.updatedAt),
      }),
    );
  }

  // —— email ——
  if (has('email')) {
    Object.assign(
      claims,
      compact({
        email: user.email,
        // OIDC StandardClaims：email_verified 必须是 boolean（即使 false 也输出，让客户端确认验证状态）
        email_verified: user.email ? !!user.emailVerified : undefined,
      }),
    );
  }

  // —— phone ——
  if (has('phone')) {
    Object.assign(
      claims,
      compact({
        phone_number: user.phone,
        phone_number_verified: user.phone ? !!user.phoneVerified : undefined,
      }),
    );
  }

  // —— address —— OIDC §5.1.1 Address Claim 是 JSON 对象（formatted 子字段）
  if (has('address') && user.address) {
    claims.address = { formatted: user.address };
  }

  // —— 向后兼容：旧版 userinfo 一直返回 username/role/name/email/updated_at
  // 业务前端（HomePage 等）已硬编码读这些字段，迁移期保持兼容
  // 不在 OIDC StandardClaims 范围内，但作为"自定义 claim"附加输出
  if (includeLegacy) {
    if (user.username && !claims.preferred_username) {
      claims.preferred_username = user.username;
    }
    Object.assign(
      claims,
      compact({
        username: user.username,
        role: user.role,
        // ISO 字符串格式的 updated_at（兼容老前端的 new Date() 解析）
        // 与上面 profile scope 中的数字 updated_at 不冲突（profile 没开时此处仍输出）
        ...(claims.updated_at
          ? {}
          : { updated_at: new Date(user.updatedAt || Date.now()).toISOString() }),
      }),
    );
    if (claims.name === undefined) {
      claims.name = user.name;
    }
    if (claims.email === undefined && user.email) {
      claims.email = user.email;
    }
  }

  return claims;
}

/**
 * 当前 OAuth2 实现支持的所有 OIDC StandardClaims 列表
 * 用于 /.well-known/openid-configuration 的 claims_supported 字段
 */
const SUPPORTED_CLAIMS = [
  // openid
  'sub',
  // profile
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'nickname',
  'preferred_username',
  'profile',
  'picture',
  'website',
  'gender',
  'birthdate',
  'zoneinfo',
  'locale',
  'updated_at',
  // email
  'email',
  'email_verified',
  // phone
  'phone_number',
  'phone_number_verified',
  // address
  'address',
  // 自定义扩展（业务侧使用）
  'username',
  'role',
];

/**
 * 当前 OAuth2 实现支持的所有 scope 列表
 * 用于 /.well-known/openid-configuration 的 scopes_supported 字段
 */
const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'phone', 'address', 'offline_access'];

module.exports = {
  buildClaims,
  parseScope,
  SUPPORTED_CLAIMS,
  SUPPORTED_SCOPES,
};
