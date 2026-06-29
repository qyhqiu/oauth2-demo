const { mongoose } = require('../db/mongo.db');
const { logger } = require('../utils/logger');

/**
 * 系统配置（单例模式，全局只有一条记录）
 *
 * 用于存储全局开关和系统级配置，如：
 *   - registrationEnabled：是否允许用户自行注册
 *   - whitelistEnabled：注册白名单是否启用
 */
const systemConfigSchema = new mongoose.Schema(
  {
    // 是否允许自行注册（false = 禁止注册，仅管理员可创建）
    registrationEnabled: { type: Boolean, default: true },
    // 注册白名单开关（仅在 registrationEnabled=true 时有意义）
    whitelistEnabled: { type: Boolean, default: false },
    // MFA 全局开关
    mfaEnabled: { type: Boolean, default: false },

    // ==================== API 限流（K2：动态开关）====================
    // 限流总开关：关闭后所有限流中间件直接 next()，方便压测/紧急调整
    rateLimitEnabled: { type: Boolean, default: true },
    // 登录接口限流（更严格，防暴力破解）
    loginRateLimit: {
      windowMs: { type: Number, default: 15 * 60 * 1000, min: 1000 }, // 时间窗口（毫秒）
      max: { type: Number, default: 10, min: 1 }, // 窗口内最大请求数
    },
    // 通用接口限流（适用于所有非登录端点）
    generalRateLimit: {
      windowMs: { type: Number, default: 60 * 1000, min: 1000 },
      max: { type: Number, default: 60, min: 1 },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

systemConfigSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

/**
 * 获取全局配置（单例：如果不存在则自动创建默认配置）
 */
async function getSystemConfig() {
  let config = await SystemConfig.findOne().lean();
  if (!config) {
    config = await SystemConfig.create({});
    config = config.toObject();
  }
  const { _id, ...rest } = config;
  return { id: _id.toString(), ...rest };
}

/**
 * 更新全局配置
 *
 * 白名单字段：
 * - registrationEnabled / whitelistEnabled / mfaEnabled：基础开关
 * - rateLimitEnabled / loginRateLimit / generalRateLimit：API 限流（K2）
 *
 * 嵌套对象（loginRateLimit / generalRateLimit）做合并赋值，避免 PUT 时缺字段被清零
 */
async function updateSystemConfig(updates) {
  const flatFields = ['registrationEnabled', 'whitelistEnabled', 'mfaEnabled', 'rateLimitEnabled'];
  const nestedFields = ['loginRateLimit', 'generalRateLimit'];

  const safeUpdates = {};
  flatFields.forEach((field) => {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  });

  let config = await SystemConfig.findOne();
  if (!config) {
    config = await SystemConfig.create({});
  }

  Object.assign(config, safeUpdates);

  // 嵌套对象逐字段合并（避免 PUT 时漏传 max 把整个对象重置）
  nestedFields.forEach((field) => {
    if (updates[field] && typeof updates[field] === 'object') {
      config[field] = {
        ...(config[field]?.toObject?.() || config[field] || {}),
        ...updates[field],
      };
    }
  });

  await config.save();

  const obj = config.toObject();
  const { _id, ...rest } = obj;
  return { id: _id.toString(), ...rest };
}

// ==================== K2：限流配置内存缓存（避免每个请求查 DB） ====================

const RATE_LIMIT_CACHE_TTL_MS = 5 * 1000; // 5 秒缓存
let _rateLimitCache = null;
let _rateLimitCacheAt = 0;

/**
 * 获取限流配置（带 5 秒内存缓存）
 * 控制台调用 PUT /system-config 后会主动 invalidate，避免下次请求等到 5s 才生效
 */
async function getRateLimitConfig() {
  const now = Date.now();
  if (_rateLimitCache && now - _rateLimitCacheAt < RATE_LIMIT_CACHE_TTL_MS) {
    return _rateLimitCache;
  }
  try {
    const cfg = await getSystemConfig();
    _rateLimitCache = {
      enabled: cfg.rateLimitEnabled !== false,
      login: {
        windowMs: cfg.loginRateLimit?.windowMs || 15 * 60 * 1000,
        max: cfg.loginRateLimit?.max || 10,
      },
      general: {
        windowMs: cfg.generalRateLimit?.windowMs || 60 * 1000,
        max: cfg.generalRateLimit?.max || 60,
      },
    };
    _rateLimitCacheAt = now;
  } catch (err) {
    // DB 未连接或异常时兜底为默认值（保留限流，避免裸奔）
    logger.warn('[SystemConfig] getRateLimitConfig 异常，使用默认配置:', err.message);
    _rateLimitCache = {
      enabled: true,
      login: { windowMs: 15 * 60 * 1000, max: 10 },
      general: { windowMs: 60 * 1000, max: 60 },
    };
    _rateLimitCacheAt = now;
  }
  return _rateLimitCache;
}

/**
 * 主动失效缓存（PUT /system-config 后调用，下次请求立即拿到最新值）
 */
function invalidateRateLimitCache() {
  _rateLimitCache = null;
  _rateLimitCacheAt = 0;
}

module.exports = {
  SystemConfig,
  getSystemConfig,
  updateSystemConfig,
  getRateLimitConfig,
  invalidateRateLimitCache,
};
