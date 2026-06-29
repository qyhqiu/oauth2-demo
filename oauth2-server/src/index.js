/**
 * OAuth2 Server 启动入口
 *
 * 职责：加载环境变量 → 初始化密钥 → 连接数据库 → 数据迁移 → 启动 HTTP 服务
 */
require('dotenv').config();

const { logger } = require('./utils/logger');
const app = require('./app/index');
const { connectMongoDB } = require('./db/mongo.db');
const { initKeys } = require('./utils/keystore');
const { PORT, CONSOLE_URL } = require('./utils/constants');
const {
  getAllClients,
  ensureConsoleClientRegistered,
  ensureClientSecretsBackfilled,
} = require('./service/client.service');
const { getAllUsers } = require('./service/user.service');

async function startServer() {
  initKeys();
  await connectMongoDB();
  await ensureConsoleClientRegistered(CONSOLE_URL);
  await ensureClientSecretsBackfilled().catch((err) => {
    logger.warn('⚠️ K3 backfill 失败（不影响启动）:', err.message);
  });

  app.listen(PORT, async () => {
    const isDev = process.env.NODE_ENV !== 'production';

    const [clients, users] = await Promise.all([
      getAllClients().catch(() => []),
      getAllUsers().catch(() => []),
    ]);

    logger.info('');
    logger.info('🚀 OAuth2 认证服务端启动成功！');
    logger.info(`📡 服务地址: http://localhost:${PORT}`);
    logger.info(
      `🗃️  数据库:   MongoDB (${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/oauth2-server-db'})`,
    );
    logger.info(`🔑 已注册客户端: ${clients.length} 个 | 👤 用户: ${users.length} 位`);

    if (isDev) {
      logger.info('');
      logger.info('📦 Redis Key 规则:');
      logger.info('   oauth:code:<code>            -> codeData  (TTL 10分钟，一次性)');
      logger.info('   oauth:session:<access_token> -> userId    (TTL 2小时)');
      logger.info('   oauth:refresh:<token>        -> tokenData (TTL 7天)');
      logger.info('   oauth:oauth2_session:<token>    -> userId    (TTL 7天)');
      logger.info('   oauth:user_sessions:<userId> -> Set<token>(全局登出用)');
      logger.info('');
      logger.info('📋 OAuth2 端点:');
      logger.info('  GET  /oauth/authorize                - 授权端点（授权码流程入口）');
      logger.info('  POST /oauth/login-and-authorize      - 登录并授权');
      logger.info('  POST /oauth/token                    - Token 端点');
      logger.info('  GET  /oauth/userinfo                 - 用户信息端点');
      logger.info('  GET  /oauth/logout                   - 单点登出');
      logger.info('  POST /oauth/revoke                   - Token 撤销');
      logger.info('  GET  /cas/session                    - CAS trackSession');
      logger.info('  GET  /cas/silent-authorize           - CAS 静默授权');
      logger.info('');
      clients.forEach((c) => logger.info(`  🔑 [${c.clientId}] ${c.name} -> ${c.origin}`));
      logger.info('');
      users.forEach((u) => logger.info(`  👤 ${u.username} (${u.name}) - ${u.role}`));
      logger.info('');
      logger.info('💡 提示：首次运行请执行 node scripts/initDb.js 初始化默认数据');
    }

    logger.info('');
  });
}

startServer().catch((err) => {
  logger.error('❌ 服务启动失败:', err);
  process.exit(1);
});
