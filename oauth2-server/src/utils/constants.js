// ==================== 服务配置 ====================

const PORT = parseInt(process.env.PORT, 10) || 3000;
const OAUTH2_SERVER_URL = process.env.OAUTH2_SERVER_URL || `http://localhost:${PORT}`;
const OAUTH2_LOGIN_URL = process.env.OAUTH2_LOGIN_URL || 'http://localhost:3001';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3010';

// ==================== JWT ====================

// 签名算法由 keystore 动态决定（ES256 或 RS256），通过 getter 延迟求值避免循环依赖。
// keystore 初始化时根据已有密钥类型或环境变量 KEY_ALGORITHM 自动确定。
const ACCESS_TOKEN_EXPIRES_IN = '2h';

// ==================== TTL（秒） ====================

const ACCESS_TOKEN_EXPIRES_SECONDS = 2 * 60 * 60; // 2 小时
const REFRESH_TOKEN_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 天
const AUTH_CODE_EXPIRES_SECONDS = 10 * 60; // 10 分钟
const OAUTH2_SESSION_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 天

// ==================== Cookie ====================

const OAUTH2_SESSION_COOKIE_NAME = 'oauth2_session';

const _exports = {
  PORT,
  OAUTH2_SERVER_URL,
  OAUTH2_LOGIN_URL,
  CONSOLE_URL,
  ACCESS_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_EXPIRES_SECONDS,
  REFRESH_TOKEN_EXPIRES_SECONDS,
  AUTH_CODE_EXPIRES_SECONDS,
  OAUTH2_SESSION_EXPIRES_SECONDS,
  OAUTH2_SESSION_COOKIE_NAME,
};

// ID_TOKEN_SIGNING_ALG 通过 getter 延迟求值，避免与 keystore.js 循环依赖
let _signingAlg = null;
Object.defineProperty(_exports, 'ID_TOKEN_SIGNING_ALG', {
  enumerable: true,
  get() {
    if (!_signingAlg) {
      const { getSigningAlgorithm } = require('./keystore');
      _signingAlg = getSigningAlgorithm();
    }
    return _signingAlg;
  },
});

module.exports = _exports;
