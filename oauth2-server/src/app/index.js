/**
 * Express 应用核心
 *
 * 职责：
 * - 创建 Express 实例
 * - 注册安全中间件（helmet、CORS、限流）
 * - 注册通用中间件（cookie、body-parser、日志）
 * - 动态注册路由（router/index.js）
 * - 全局错误处理
 */
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { mergeParams } = require('../middleware/mergeParams.middleware');
const { traceIdMiddleware } = require('../middleware/traceId.middleware');
const { httpLog, logger } = require('../utils/logger');
const { OAUTH2_LOGIN_URL, CONSOLE_URL } = require('../utils/constants');
const { findClientByOrigin } = require('../service/client.service');
const { getRateLimitConfig } = require('../model/systemConfig.model');
const { registerRoutes } = require('../router');

const app = express();

app.set('trust proxy', 1);

// ==================== 安全中间件 ====================

app.use(
  helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: process.env.NODE_ENV === 'production',
  }),
);

// ==================== 动态限流 ====================

const BROWSER_NAV_PATH_PREFIXES = [
  '/v1/oauth/authorize',
  '/v1/oauth/logout',
  '/v1/oauth/set-cookie-and-redirect',
  '/v1/api/console/admin/oauth2-login',
];

function buildRateLimitHandler(errorDescription) {
  return (req, res, _next, options) => {
    const isBrowserNav =
      req.method === 'GET' &&
      BROWSER_NAV_PATH_PREFIXES.some(
        (prefix) => req.path === prefix || req.path.startsWith(prefix + '/'),
      );
    if (isBrowserNav) {
      const target = new URL(OAUTH2_LOGIN_URL);
      target.searchParams.set('error', 'too_many_requests');
      target.searchParams.set('error_description', errorDescription);
      Object.entries(req.query || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          target.searchParams.set(k, String(v));
        }
      });
      return res.redirect(target.toString());
    }
    res.status(options.statusCode || 429).json({
      error: 'too_many_requests',
      error_description: errorDescription,
    });
  };
}

const _limiterCache = new Map();
function getOrCreateLimiter(windowMs, max, options) {
  const key = `${options.kind}:${windowMs}:${max}`;
  if (_limiterCache.has(key)) {
    return _limiterCache.get(key);
  }
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.skip ? { skip: options.skip } : {}),
    handler: options.handler,
  });
  _limiterCache.set(key, limiter);
  return limiter;
}

function createDynamicRateLimiter(kind, errorDescription) {
  const handler = buildRateLimitHandler(errorDescription);
  const skip = kind === 'login' ? (req) => req.query?.dry_run === '1' : undefined;

  return async (req, res, next) => {
    try {
      const cfg = await getRateLimitConfig();
      if (!cfg.enabled) {
        return next();
      }
      const slot = kind === 'login' ? cfg.login : cfg.general;
      const limiter = getOrCreateLimiter(slot.windowMs, slot.max, { kind, skip, handler });
      return limiter(req, res, next);
    } catch (err) {
      logger.warn(`[RateLimit/${kind}] 配置读取异常，本次请求放行:`, err.message);
      return next();
    }
  };
}

const loginRateLimiter = createDynamicRateLimiter('login', '请求过于频繁，请稍后再试（登录限流）');
const generalRateLimiter = createDynamicRateLimiter('general', '请求过于频繁，请稍后再试');

// ==================== 通用中间件 ====================

app.use(
  cors({
    origin: async (requestOrigin, callback) => {
      if (!requestOrigin) {
        return callback(null, true);
      }
      const isAllowedStatic = requestOrigin === OAUTH2_LOGIN_URL || requestOrigin === CONSOLE_URL;
      const client = await findClientByOrigin(requestOrigin);
      if (isAllowedStatic || client) {
        callback(null, true);
      } else {
        callback(new Error(`[CORS] origin [${requestOrigin}] 未在 oauthClients 中注册`));
      }
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 登录接口严格限流
app.use('/v1/oauth/login-and-authorize', loginRateLimiter);
// 通用限流
app.use(generalRateLimiter);
// 合并请求参数（query + body 统一访问）
app.use(mergeParams);
// TraceId（请求追踪）
app.use(traceIdMiddleware);

// 请求日志（pino-pretty）
app.use((req, res, next) => {
  const startTime = Date.now();

  // 监听响应结束事件，计算耗时并输出日志
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    httpLog({
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration,
      query: req.query,
      body: req.body,
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
      traceId: req.traceId,
    });
  });

  next();
});

// ==================== 动态路由注册 ====================

logger.info('📌 注册路由:');
registerRoutes(app);

// ==================== 全局错误处理 ====================

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const error = err.error || 'server_error';
  const description = err.errorDescription || err.message || '服务器内部错误';

  if (status >= 500) {
    logger.error(`[${req.method} ${req.path}] ${status} ${error}:`, err.message);
  }

  res.status(status).json({
    error,
    error_description: description,
  });
});

module.exports = app;
