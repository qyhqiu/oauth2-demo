/**
 * 合并请求参数中间件
 * 将 query 参数合并到 body，将 body 参数合并到 query
 * 使得无论 GET 还是 POST 请求，都能通过 req.body 或 req.query 拿到完整参数
 *
 * 优先级：body 中的同名字段优先于 query（body 覆盖 query）
 */
function mergeParams(req, res, next) {
  req.body = Object.assign({}, req.query, req.body);
  req.query = Object.assign({}, req.body);
  next();
}

module.exports = { mergeParams };
