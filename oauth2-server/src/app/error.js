/**
 * 错误类型枚举
 *
 * 统一定义业务错误码和 HTTP 状态码的映射关系，
 * 供全局错误处理中间件和各路由/服务使用。
 */

const ErrorTypes = {
  // 400 系列
  INVALID_REQUEST: { status: 400, error: 'invalid_request', message: '请求参数无效' },
  INVALID_GRANT: { status: 400, error: 'invalid_grant', message: '授权凭证无效' },
  INVALID_SCOPE: { status: 400, error: 'invalid_scope', message: '请求的 scope 无效' },
  DUPLICATE: { status: 400, error: 'duplicate', message: '资源已存在' },
  UNSUPPORTED_GRANT_TYPE: {
    status: 400,
    error: 'unsupported_grant_type',
    message: '不支持的授权类型',
  },

  // 401 系列
  UNAUTHORIZED: { status: 401, error: 'unauthorized', message: '未认证或认证已过期' },
  INVALID_CLIENT: { status: 401, error: 'invalid_client', message: '客户端认证失败' },
  INVALID_TOKEN: { status: 401, error: 'invalid_token', message: 'Token 无效或已过期' },

  // 403 系列
  FORBIDDEN: { status: 403, error: 'forbidden', message: '无权限访问' },
  ACCESS_DENIED: { status: 403, error: 'access_denied', message: '访问被拒绝' },
  ACCOUNT_LOCKED: { status: 403, error: 'account_locked', message: '账号已被锁定' },

  // 404 系列
  NOT_FOUND: { status: 404, error: 'not_found', message: '资源不存在' },

  // 409 系列
  CONFLICT: { status: 409, error: 'conflict', message: '资源冲突' },

  // 429 系列
  TOO_MANY_REQUESTS: {
    status: 429,
    error: 'too_many_requests',
    message: '请求过于频繁，请稍后再试',
  },

  // 500 系列
  SERVER_ERROR: { status: 500, error: 'server_error', message: '服务器内部错误' },
};

/**
 * 业务错误类
 * 用于在 service / controller 中抛出可被全局错误处理捕获的业务异常
 */
class AppError extends Error {
  constructor(errorType, description) {
    super(description || errorType.message);
    this.status = errorType.status;
    this.error = errorType.error;
    this.errorDescription = description || errorType.message;
  }
}

module.exports = { ErrorTypes, AppError };
