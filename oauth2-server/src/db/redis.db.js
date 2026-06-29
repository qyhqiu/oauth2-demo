const Redis = require('ioredis');
const { logger } = require('../utils/logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB, 10) || 0,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('❌ Redis 连接失败，请确认 Redis 服务已启动');
      return null;
    }
    return Math.min(times * 200, 1000);
  },
});

redis.on('connect', () => logger.info('✅ Redis 连接成功'));
redis.on('error', (err) => logger.error('❌ Redis 错误:', err.message));

// Redis Key 规则
const CODE_KEY = (code) => `oauth:code:${code}`;
const SESSION_KEY = (token) => `oauth:session:${token}`;
const REFRESH_KEY = (token) => `oauth:refresh:${token}`;
const USER_SESSION_KEY = (userId) => `oauth:user_sessions:${userId}`;
const USER_REFRESH_KEY = (userId) => `oauth:user_refreshes:${userId}`;
const OAUTH2_SESSION_KEY = (token) => `oauth:oauth2_session:${token}`;
// 登录失败计数（按 应用 + 用户ID 维度独立计数）
const LOGIN_FAIL_KEY = (clientId, userId) => `oauth:login_fail:${clientId}:${userId}`;
// 账号锁定标记（值为锁定原因；TTL 决定锁定时长）
const LOGIN_LOCK_KEY = (clientId, userId) => `oauth:login_lock:${clientId}:${userId}`;
// 控制台 OAuth2 登录的 state + PKCE verifier 暂存（5 分钟有效，一次性消费）
const CONSOLE_OAUTH2_STATE_KEY = (state) => `oauth:console_oauth2_state:${state}`;

module.exports = {
  redis,
  CODE_KEY,
  SESSION_KEY,
  REFRESH_KEY,
  USER_SESSION_KEY,
  USER_REFRESH_KEY,
  OAUTH2_SESSION_KEY,
  LOGIN_FAIL_KEY,
  LOGIN_LOCK_KEY,
  CONSOLE_OAUTH2_STATE_KEY,
};
