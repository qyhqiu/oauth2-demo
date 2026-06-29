/**
 * API Controller — 健康检查 + 受保护数据接口
 */

function healthCheck(req, res) {
  res.json({
    code: 0,
    data: { status: 'ok', timestamp: new Date().toISOString() },
    message: 'OAuth2 认证服务运行正常',
  });
}

function getProtectedData(req, res) {
  res.json({
    code: 0,
    message: '获取成功',
    data: {
      message: `欢迎 ${req.user.name}！这是受 OAuth2 保护的数据。`,
      items: [
        { id: 1, title: '订单 #001', status: '已完成', amount: '¥299.00' },
        { id: 2, title: '订单 #002', status: '处理中', amount: '¥599.00' },
        { id: 3, title: '订单 #003', status: '待支付', amount: '¥199.00' },
      ],
      accessTime: new Date().toLocaleString(),
      clientId: req.user.client_id,
    },
  });
}

module.exports = { healthCheck, getProtectedData };
