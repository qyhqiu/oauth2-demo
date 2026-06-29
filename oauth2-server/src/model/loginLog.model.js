const { mongoose } = require('../db/mongo.db');

/**
 * 登录日志（用于审计 + 趋势统计）
 *
 * 写入时机（routes/oauth.js#login-and-authorize）：
 * - 登录成功 → status='success' + userId 关联
 * - 登录失败 → status='failure' + failureReason 描述失败原因（密码错误 / 账号锁定 / 角色不允许 等）
 *
 * 读取场景：
 * - 控制台「登录趋势」折线图：按日期聚合 count + distinct(userId)
 * - 控制台「审计日志」列表（后续扩展）
 */
const loginLogSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    username: { type: String, required: true, index: true },
    userId: { type: String, default: null }, // 失败场景可能没有 userId
    status: { type: String, enum: ['success', 'failure'], required: true, index: true },
    failureReason: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    // ===== UA 解析（ua-parser-js） =====
    browser: { type: String, default: '' }, // 例: "Chrome 120"
    os: { type: String, default: '' }, // 例: "macOS 14"
    device: { type: String, default: 'desktop' }, // desktop / mobile / tablet

    // ===== IP 反查（geoip-lite） =====
    country: { type: String, default: '' }, // 例: "CN"
    region: { type: String, default: '' }, // 例: "ZJ"（省/州）
    city: { type: String, default: '' }, // 例: "Hangzhou"

    loggedInAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

// 复合索引：按应用 + 时间范围聚合趋势时的常用查询路径
loginLogSchema.index({ clientId: 1, loggedInAt: -1 });

const LoginLog = mongoose.model('LoginLog', loginLogSchema);

module.exports = LoginLog;
