/**
 * TraceId + 统一响应格式中间件
 *
 * 职责（最小化）：
 * 1. 为每个请求生成唯一 traceId，写入 Response Header
 * 2. 劫持 res.json，对标准格式响应（含 code 字段）补充 success + traceId
 *    - 标准格式：controller 自行返回 { code, data, message }
 *    - 非标准格式（OAuth2 协议端点等）：原样透传，不做任何包装
 *
 * 设计原则：
 * - 从源头规范化，controller 负责返回 { code, data, message }
 * - 中间件不猜测、不兜底，只做补充
 */
const crypto = require('crypto');

function generateTraceId() {
  return crypto.randomBytes(15).toString('hex');
}

function traceIdMiddleware(req, res, next) {
  // 优先从请求头读取（支持链路透传），否则自动生成
  const traceId = req.headers['x-trace-id'] || generateTraceId();
  req.traceId = traceId;

  // 写入 Response Header
  res.setHeader('x-trace-id', traceId);

  // 劫持 res.json，对标准格式响应补充 success + traceId
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // 仅对标准业务响应（含 code 字段且为数字）补充 success + traceId
    // OAuth2 协议端点返回的裸对象（tokenResponse、userinfo 等）原样透传
    if (
      body &&
      typeof body === 'object' &&
      !Buffer.isBuffer(body) &&
      'code' in body &&
      typeof body.code === 'number'
    ) {
      body.success = body.code === 0;
      body.traceId = traceId;
    }
    return originalJson(body);
  };

  next();
}

module.exports = { traceIdMiddleware };
