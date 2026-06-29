const { redis } = require('../db/redis.db');
const { logger } = require('../utils/logger');
const nodemailer = require('nodemailer');

/**
 * 邮件传输器配置
 * 通过环境变量配置 SMTP 参数，支持 QQ邮箱 / 163邮箱 / 企业邮箱 等
 *
 * 环境变量：
 *   SMTP_HOST    - SMTP 服务器地址（如 smtp.qq.com）
 *   SMTP_PORT    - SMTP 端口（默认 465）
 *   SMTP_SECURE  - 是否使用 SSL（默认 true）
 *   SMTP_USER    - 邮箱账号
 *   SMTP_PASS    - 邮箱授权码（非登录密码）
 *   SMTP_FROM    - 发件人显示名（默认用 SMTP_USER）
 */
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@oauth2-server.local';

/**
 * 验证码服务（Demo 实现）
 *
 * 真实生产环境应接入：
 *   - 短信网关（阿里云短信、腾讯云 SMS 等）
 *   - 邮件服务（SMTP / 阿里云邮件推送 / SendGrid 等）
 *
 * 本 Demo 将验证码存入 Redis（5 分钟有效）+ 控制台日志输出，便于本地测试。
 *
 * Redis Key 规则：
 *   verify:code:phone:13800000001  -> "123456"
 *   verify:code:email:user@xx.com  -> "654321"
 */

const CODE_TTL_SECONDS = 5 * 60; // 5 分钟有效
const CODE_RATE_LIMIT_SECONDS = 60; // 同一目标 60 秒内不可重复发送

const VERIFY_CODE_KEY = (channel, target) => `verify:code:${channel}:${target}`;
const VERIFY_RATE_KEY = (channel, target) => `verify:rate:${channel}:${target}`;

/**
 * 生成 6 位数字验证码
 */
const crypto = require('crypto');

function generateCode() {
  // 使用 crypto 生成安全随机验证码，避免 Math.random 可预测性
  return String(crypto.randomInt(100000, 999999));
}

/**
 * 发送验证码
 *
 * @param {'phone'|'email'} channel 渠道
 * @param {string} target 手机号或邮箱
 * @param {string} purpose 用途（bind-phone / bind-email / mfa 等，仅作日志区分）
 * @returns {Promise<{code: string, devCode?: string}>}
 */
async function sendVerifyCode(channel, target, purpose = 'verify') {
  if (!['phone', 'email', 'sms'].includes(channel)) {
    throw new Error('channel 必须为 phone 或 email');
  }
  if (!target) {
    throw new Error('target 不能为空');
  }

  // 频率限制：同一目标 60 秒内不可重复发送
  const rateKey = VERIFY_RATE_KEY(channel, target);
  const sent = await redis.get(rateKey);
  if (sent) {
    const ttl = await redis.ttl(rateKey);
    throw new Error(`请求过于频繁，请 ${ttl} 秒后重试`);
  }

  const code = generateCode();
  const codeKey = VERIFY_CODE_KEY(channel, target);

  // 存验证码（5 分钟有效）
  await redis.set(codeKey, code, 'EX', CODE_TTL_SECONDS);
  // 设置发送频率锁（60 秒）
  await redis.set(rateKey, '1', 'EX', CODE_RATE_LIMIT_SECONDS);

  // 邮箱渠道：使用 nodemailer 发送验证码邮件
  if (channel === 'email') {
    try {
      await smtpTransporter.sendMail({
        from: `Demo "验证码" <${SMTP_FROM}>`,
        to: target,
        subject: `【Demo】您的验证码：${code}`,
        html: `
          <div style="max-width:480px;margin:0 auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <h2 style="color:#1a1a2e;margin-bottom:24px;">验证码</h2>
            <p style="color:#333;font-size:14px;">您正在进行 <strong>${purpose}</strong> 操作，验证码为：</p>
            <div style="background:#f0f4ff;border-radius:8px;padding:16px 24px;text-align:center;margin:16px 0;">
              <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#4f46e5;">${code}</span>
            </div>
            <p style="color:#666;font-size:13px;">验证码有效期 5 分钟，请勿泄露给他人。</p>
            <p style="color:#999;font-size:12px;margin-top:24px;">如非本人操作，请忽略此邮件。</p>
          </div>
        `,
      });
      logger.info(`📨 [${purpose}] 邮件验证码已发送到 ${target}`);
    } catch (emailError) {
      logger.error(`📨 [${purpose}] 邮件发送失败: ${emailError.message}`);
      // 邮件发送失败时仍在日志输出验证码，便于开发调试
      logger.info(`📨 [${purpose}] 邮件发送失败，验证码: ${code}（5 分钟有效）`);
    }
  } else {
    // 短信渠道：控制台输出验证码（生产环境应接入短信网关）
    logger.info(`📨 [${purpose}] 发送验证码到 ${channel}=${target}：${code}（5 分钟有效）`);
  }

  // Dev 模式返回 devCode 方便联调；生产环境应删除此字段
  return { code: 'sent', devCode: code };
}

/**
 * 校验验证码
 *
 * @param {'phone'|'email'} channel
 * @param {string} target
 * @param {string} inputCode
 * @returns {Promise<boolean>}
 */
async function verifyCode(channel, target, inputCode) {
  if (!inputCode) {
    return false;
  }
  const codeKey = VERIFY_CODE_KEY(channel, target);
  const stored = await redis.get(codeKey);
  if (!stored) {
    return false;
  }
  if (String(stored) !== String(inputCode)) {
    return false;
  }
  // 一次性消费
  await redis.del(codeKey);
  return true;
}

module.exports = {
  sendVerifyCode,
  verifyCode,
  VERIFY_CODE_KEY,
};
