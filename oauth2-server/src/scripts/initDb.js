/**
 * 数据库初始化脚本
 * 用途：首次部署时写入默认的 OAuth2 客户端和测试用户
 * 运行：node scripts/initDb.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { logger } = require('../utils/logger');
const bcrypt = require('bcryptjs');
const { connectMongoDB, mongoose } = require('../db/mongo.db');
const Client = require('../model/client.model');
const User = require('../model/user.model');

const DEFAULT_CLIENTS = [
  {
    clientId: 'app-a',
    origin: 'http://localhost:3002',
    name: '应用 A',
    description: '演示应用 A（React SPA）',
    scope: ['openid', 'profile'],
    pkce: true,
  },
  {
    clientId: 'app-b',
    origin: 'http://localhost:3003',
    name: '应用 B',
    description: '演示应用 B（React SPA）',
    scope: ['openid', 'profile'],
    pkce: true,
  },
  {
    clientId: 'app-c-test',
    origin: 'http://localhost:5001',
    name: '应用 C',
    description: '静态 HTML 页面演示',
    scope: ['openid', 'profile'],
    pkce: true,
  },
  {
    clientId: 'app-d-test',
    origin: 'http://localhost:3007',
    name: '应用 D',
    description: '自定义端口演示',
    scope: ['openid', 'profile'],
    pkce: true,
  },
];

const DEFAULT_USERS = [
  {
    username: 'admin',
    password: '123456',
    name: '管理员',
    role: 'admin',
    email: 'admin@oauth2-server.com',
    status: 'active',
  },
  {
    username: 'user1',
    password: '123456',
    name: '张三',
    role: 'user',
    email: 'user1@oauth2-server.com',
    status: 'active',
  },
  {
    username: 'user2',
    password: '123456',
    name: '李四',
    role: 'user',
    email: 'user2@oauth2-server.com',
    status: 'active',
  },
];

async function initClients() {
  const existingCount = await Client.countDocuments();
  if (existingCount > 0) {
    logger.info(`⏭️  clients 集合已有 ${existingCount} 条数据，跳过初始化（如需重置请先清空集合）`);
    return;
  }

  await Client.insertMany(DEFAULT_CLIENTS);
  logger.info(`✅ 已写入 ${DEFAULT_CLIENTS.length} 个默认 OAuth2 客户端`);
  DEFAULT_CLIENTS.forEach((c) => logger.info(`   [${c.clientId}] ${c.name} -> ${c.origin}`));
}

async function initUsers() {
  const existingCount = await User.countDocuments();
  if (existingCount > 0) {
    logger.info(`⏭️  users 集合已有 ${existingCount} 条数据，跳过初始化（如需重置请先清空集合）`);
    return;
  }

  const usersWithHashedPassword = await Promise.all(
    DEFAULT_USERS.map(async (user) => ({
      ...user,
      password: await bcrypt.hash(user.password, 10),
    })),
  );

  await User.insertMany(usersWithHashedPassword);
  logger.info(`✅ 已写入 ${DEFAULT_USERS.length} 个默认用户（密码已 bcrypt 加密）`);
  DEFAULT_USERS.forEach((u) => logger.info(`   ${u.username} (${u.name}) / 密码: ${u.password}`));
}

async function main() {
  logger.info('');
  logger.info('🗃️  OAuth2 Demo - 数据库初始化脚本');
  logger.info('='.repeat(50));

  await connectMongoDB();

  await initClients();
  logger.info('');
  await initUsers();

  logger.info('');
  logger.info('✨ 初始化完成！');
  logger.info('   现在可以运行 npm start 启动服务');
  logger.info('');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error('❌ 初始化失败:', err);
  process.exit(1);
});
