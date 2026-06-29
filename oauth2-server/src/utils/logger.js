/**
 * 日志工具 — 基于 pino + pino-pretty
 * 提供统一的日志输出（pino-pretty 自带颜色和格式化）
 */
const pino = require('pino');

// 敏感字段列表（日志输出时自动脱敏）
const SENSITIVE_KEYS = ['password', 'client_secret', 'clientSecret', 'code_verifier', 'token'];

/**
 * 创建 pino 实例
 * - 开发环境：使用 pino-pretty 输出带颜色的可读日志
 * - 生产环境：输出 JSON 结构化日志（便于日志采集系统消费）
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
});

/**
 * 对象脱敏（隐藏密码类字段）
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitizeValue = (value) => {
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object') {
      return sanitize(value);
    }
    return value;
  };

  const safe = Array.isArray(obj) ? [] : {};

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (SENSITIVE_KEYS.includes(key) && value != null) {
      safe[key] = '***';
    } else {
      safe[key] = sanitizeValue(value);
    }
  });

  return safe;
}

/**
 * HTTP 请求日志（用于 Express 中间件）
 * @param {object} options
 * @param {string} options.method - 请求方式
 * @param {string} options.url - 请求 URL
 * @param {number} options.statusCode - 响应状态码
 * @param {number} options.duration - 响应耗时(ms)
 * @param {object} [options.query] - query 参数
 * @param {object} [options.body] - body 参数
 * @param {string} [options.ip] - 客户端 IP
 * @param {string} [options.traceId] - 请求追踪 ID
 */
function httpLog({ method, url, statusCode, duration, query, body, ip, traceId }) {
  const logData = { method, url, statusCode, duration };
  if (traceId) {
    logData.traceId = traceId;
  }
  if (ip) {
    logData.ip = ip;
  }

  const hasQuery = query && Object.keys(query).length > 0;
  const hasBody = body && Object.keys(body).length > 0;
  if (hasQuery) {
    logData.query = sanitize(query);
  }
  if (hasBody) {
    logData.body = sanitize(body);
  }

  const message = `${method} ${url} → ${statusCode} (${duration}ms)`;

  if (statusCode >= 500) {
    logger.error(logData, message);
  } else if (statusCode >= 400) {
    logger.warn(logData, message);
  } else {
    logger.info(logData, message);
  }
}

module.exports = {
  logger,
  httpLog,
  sanitize,
};
