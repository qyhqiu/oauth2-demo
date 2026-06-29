/**
 * 数据库初始化种子脚本
 * 用途：MongoDB 数据丢失后，根据代码中的固定配置重建初始数据
 * 运行：node scripts/seed.js
 */
const { logger } = require('../utils/logger');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { connectMongoDB, mongoose } = require('../db/mongo.db');
const Client = require('../model/client.model');
const User = require('../model/user.model');
const { TOTP_ISSUER } = require('../service/totp.service');

const BCRYPT_SALT_ROUNDS = 10;

// ===== Demo TOTP 密钥（D1：固定 base32，方便演示无需现场扫码）=====
// ⚠️ 注意：仅用于本地 demo / 教学演示！生产环境的 totpSecret 必须通过 speakeasy.generateSecret 随机生成
// base32 字符集：A-Z + 2-7（这些字符串都是合法 base32）
const DEMO_TOTP_SECRETS = {
  user1: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  user2: 'KRSXG5BAONUW2ZLOMFXGI33UMVZGS3DG',
};

/**
 * 根据固定密钥构造 otpauth URL（不调用 speakeasy.generateSecret，因为 demo 要保证密钥固定）
 */
function buildOtpauthUrlForDemo(username, base32Secret) {
  return speakeasy.otpauthURL({
    secret: base32Secret,
    encoding: 'base32',
    label: encodeURIComponent(`${TOTP_ISSUER}:${username}`),
    issuer: TOTP_ISSUER,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });
}

const initialClients = [
  {
    _id: '69fd4bee385c54fc05b45681',
    clientId: 'app-a',
    name: '应用 A',
    origin: 'http://localhost:3002',
    description: '演示应用 A (React SPA)',
    scope: ['openid', 'profile'],
    pkce: true,
    loginPolicy: {
      enabled: true,
      ssoEnabled: true,
      allowRegister: true,
      maxLoginFailures: 3,
      lockoutDurationMinutes: 1,
      enabledLoginMethods: {
        password: true,
        verifyCode: true,
        qrcode: false,
        social: true,
        enterprise: false,
      },
    },
    accessPolicy: {
      allowedRoles: [],
      requirePkce: true,
      tokenExpiresInSeconds: 7200,
    },
    branding: {
      logoUrl: 'https://example.com/logo.png',
      primaryColor: '#ff6b00',
      welcomeText: '欢迎登录企业内网',
      copyright: '© 2026 Demo',
    },
    createdAt: '2026-05-08T02:35:26.813Z',
    updatedAt: '2026-05-15T09:37:14.436Z',
    clientSecret: 'daa069daef1f4e7c68fcfb9b8cb46bf6eb5b1f080510dbca1c0e558687c322db',
    clientType: 'spa',
    socialConnectionIds: ['6a059439df095a71386df699'],
  },
  {
    _id: '69fd4bee385c54fc05b45682',
    clientId: 'app-b',
    name: '应用 B',
    origin: 'http://localhost:3003',
    description: '演示应用 B (React SPA)',
    scope: ['openid', 'profile'],
    pkce: true,
    loginPolicy: {
      enabled: true,
      ssoEnabled: true,
      allowRegister: false,
      maxLoginFailures: 5,
      lockoutDurationMinutes: 30,
      enabledLoginMethods: {
        password: true,
        verifyCode: true,
        qrcode: false,
        social: true,
        enterprise: false,
      },
    },
    accessPolicy: {
      allowedRoles: [],
      requirePkce: true,
      tokenExpiresInSeconds: 7200,
    },
    branding: {
      logoUrl: '',
      primaryColor: '#5b50e8',
      welcomeText: '',
      copyright: '',
    },
    createdAt: '2026-05-08T02:35:26.820Z',
    updatedAt: '2026-05-15T11:14:47.563Z',
    clientSecret: 'a14b25bab6625581b0082ea0ad323f990e160a0ccbbcdf576f090d69dd03712e',
    clientType: 'spa',
    socialConnectionIds: ['6a059439df095a71386df699'],
  },
  {
    _id: '69fd47b4c716b49ed42c52fa',
    clientId: 'console-app',
    name: 'OAuth2 控制台',
    origin: 'http://localhost:3010',
    description: '控制台自身（系统应用，请勿删除）',
    scope: ['openid'],
    pkce: true,
    loginPolicy: {
      enabled: true,
      allowRegister: false,
      maxLoginFailures: 5,
      lockoutDurationMinutes: 30,
      ssoEnabled: true,
    },
    accessPolicy: {
      allowedRoles: ['admin'],
      requirePkce: true,
      tokenExpiresInSeconds: 28800,
    },
    branding: {
      logoUrl: '',
      primaryColor: '#5b50e8',
      welcomeText: '欢迎登录 OAuth2 控制台',
      copyright: 'OAuth2 Demo · Aone Copilot',
    },
    createdAt: '2026-05-08T02:17:24.418Z',
    updatedAt: '2026-05-09T03:08:20.653Z',
    clientSecret: '9473267d3cc7d4f0d6ceac5cba6ce49f44fcfac88fc34af34807e2c079a9d0fe',
    clientType: 'spa',
  },
];

const initialUsers = [
  {
    username: 'admin',
    password: '123456',
    name: '管理员',
    nickname: '超级管理员',
    role: 'admin',
    email: 'admin@oauth2-server.com',
    emailVerified: true,
    phone: '13800000001',
    phoneVerified: true,
    gender: 'M',
    company: 'OAuth2 Demo Inc.',
    status: 'active',
    blocked: false,
    registerSource: 'admin',
  },
  {
    username: 'user1',
    password: '123456',
    name: '老鼠🐭爱大米',
    nickname: '小老鼠',
    role: 'user',
    email: 'user1@oauth2-server.com',
    emailVerified: true,
    phone: '13800000002',
    phoneVerified: false,
    gender: 'M',
    address: '上海市浦东新区',
    status: 'active',
    blocked: false,
    registerSource: 'self-register',
    // D1：演示主账号 — 默认开启 TOTP MFA，登录会触发动态码校验
    mfaEnabled: true,
    mfaChannel: 'totp',
    totpSecret: DEMO_TOTP_SECRETS.user1,
  },
  {
    username: 'user2',
    password: '123456',
    name: '测试用户2',
    nickname: '小二',
    role: 'user',
    email: 'user2@oauth2-server.com',
    emailVerified: false,
    gender: 'F',
    status: 'active',
    blocked: false,
    registerSource: 'admin',
    // D1：备用账号 — TOTP 已预绑但默认未启用，需要时在控制台一键开启 mfaEnabled
    mfaEnabled: false,
    mfaChannel: 'totp',
    totpSecret: DEMO_TOTP_SECRETS.user2,
  },
];

async function seed() {
  try {
    // 主动连接 MongoDB
    await connectMongoDB();

    logger.info('🌱 开始初始化数据...\n');

    // ===== 初始化 Clients =====
    for (const clientData of initialClients) {
      const existing = await Client.findOne({ clientId: clientData.clientId });
      if (existing) {
        logger.info(`  ⏭️  客户端 [${clientData.clientId}] 已存在，跳过`);
      } else {
        await Client.create(clientData);
        logger.info(
          `  ✅ 客户端 [${clientData.clientId}] → ${clientData.name} (${clientData.origin})`,
        );
      }
    }

    logger.info('');

    // ===== 初始化 Users =====
    for (const userData of initialUsers) {
      const existing = await User.findOne({ username: userData.username });
      if (existing) {
        logger.info(`  ⏭️  用户 [${userData.username}] 已存在，跳过`);
      } else {
        const hashedPassword = await bcrypt.hash(userData.password, BCRYPT_SALT_ROUNDS);
        await User.create({ ...userData, password: hashedPassword });
        logger.info(`  ✅ 用户 [${userData.username}] → ${userData.name} (${userData.role})`);
      }
    }

    logger.info('\n🎉 数据库初始化完成！');
    logger.info('\n📋 账号信息：');
    logger.info('  管理员：admin / 123456');
    logger.info('  普通用户：user1 / 123456 [🔐 已开启 TOTP MFA]');
    logger.info('  普通用户：user2 / 123456 [🔐 TOTP 已预绑，未启用]');

    // ===== D1：打印 demo TOTP otpauth URL + 当前动态码，方便管理员快速绑定认证器 App =====
    logger.info('\n🔐 Demo TOTP 密钥（请手动添加到 Google Authenticator / 1Password / Authy）：');
    for (const [username, secret] of Object.entries(DEMO_TOTP_SECRETS)) {
      const otpauthUrl = buildOtpauthUrlForDemo(username, secret);
      const currentCode = speakeasy.totp({ secret, encoding: 'base32', step: 30 });
      logger.info(`\n  [${username}]`);
      logger.info(`    Base32 密钥（手动输入）: ${secret}`);
      logger.info(`    otpauth URL（扫码用）:  ${otpauthUrl}`);
      logger.info(`    🔢 当前动态码（30s 内有效）: ${currentCode}`);
      // 同步生成二维码 ASCII 输出（终端可直接扫描）
      try {
        const ascii = await QRCode.toString(otpauthUrl, { type: 'terminal', small: true });
        logger.info('    二维码（终端扫码）:');
        // 给二维码每行加缩进，与上方信息对齐
        ascii.split('\n').forEach((line) => logger.info(`    ${line}`));
      } catch (e) {
        logger.info(`    （二维码生成失败：${e.message}，请用 Base32 密钥手动输入）`);
      }
    }

    logger.info(
      '\n💡 提示：用 user1 登录任意应用时，密码通过后会要求输入 6 位动态码 → 打开认证器 App 输入即可',
    );
  } catch (error) {
    logger.error('❌ 初始化失败:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
