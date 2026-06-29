const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  generateImageCaptcha,
  verifyAndConsumeImageCaptcha,
} = require('../../service/imageCaptcha.service');
const { sendVerifyCode, verifyCode } = require('../../service/verifyCode.service');
const { redis } = require('../../db/redis.db');
const { logger } = require('../../utils/logger');

/**
 * 注册验证 Token
 * 验证码校验通过后，生成一次性 token 存入 Redis，绑定具体的手机号/邮箱。
 * 注册时后端通过此 token 验证用户确实通过了验证码校验，且 token 与注册的手机号/邮箱一致。
 */
const REGISTER_VERIFY_TOKEN_TTL = 10 * 60; // 10 分钟有效
const REGISTER_VERIFY_TOKEN_KEY = (token) => `register:verify_token:${token}`;

async function generateVerifyToken(channel, target) {
  const token = uuidv4();
  const key = REGISTER_VERIFY_TOKEN_KEY(token);
  await redis.set(key, JSON.stringify({ channel, target }), 'EX', REGISTER_VERIFY_TOKEN_TTL);
  return token;
}

async function consumeVerifyToken(token, expectedChannel, expectedTarget) {
  if (!token) {
    return false;
  }
  const key = REGISTER_VERIFY_TOKEN_KEY(token);
  const stored = await redis.get(key);
  if (!stored) {
    return false;
  }
  try {
    const { channel, target } = JSON.parse(stored);
    if (channel !== expectedChannel || target !== expectedTarget) {
      return false;
    }
    // 一次性消费
    await redis.del(key);
    return true;
  } catch {
    return false;
  }
}

const router = express.Router();

/**
 * GET /image-captcha
 * 获取图形验证码
 */
router.get('/image-captcha', async (req, res) => {
  try {
    const { sessionId, svg } = await generateImageCaptcha();
    res.json({ code: 0, data: { sessionId, svg }, message: '' });
  } catch (error) {
    logger.error('[register-captcha] 图形验证码生成失败:', error.message);
    res.status(500).json({ code: 500, data: null, message: '服务器内部错误' });
  }
});

/**
 * POST /send-sms-code
 * 发送短信验证码（需先通过图形验证码）
 * Body: { phone, imageCaptchaSessionId, imageCaptchaText }
 */
router.post('/send-sms-code', async (req, res) => {
  const { phone, imageCaptchaSessionId, imageCaptchaText } = req.body;

  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: 400, data: null, message: '手机号格式不正确' });
  }
  if (!imageCaptchaSessionId || !imageCaptchaText) {
    return res.status(400).json({ code: 400, data: null, message: '请完成图形验证码校验' });
  }

  const isValid = await verifyAndConsumeImageCaptcha(imageCaptchaSessionId, imageCaptchaText);
  if (!isValid) {
    return res
      .status(400)
      .json({ code: 400, data: null, message: '图形验证码错误或已过期，请刷新后重试' });
  }

  try {
    const result = await sendVerifyCode('phone', phone, 'register');
    res.json({ code: 0, data: { devCode: result.devCode }, message: '验证码已发送，请注意查收' });
  } catch (error) {
    res.status(429).json({ code: 429, data: null, message: error.message });
  }
});

/**
 * POST /verify-sms-code
 * 校验短信验证码
 * Body: { phone, code }
 */
router.post('/verify-sms-code', async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ code: 400, data: null, message: '参数不完整' });
  }

  const passed = await verifyCode('phone', phone, code);
  if (!passed) {
    return res.status(400).json({ code: 400, data: null, message: '验证码错误或已过期' });
  }

  // 生成一次性 verifyToken，绑定手机号，注册时后端校验
  const verifyToken = await generateVerifyToken('phone', phone);
  res.json({ code: 0, data: { verified: true, verifyToken }, message: '验证通过' });
});

/**
 * POST /send-email-code
 * 发送邮箱验证码
 * Body: { email }
 */
router.post('/send-email-code', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ code: 400, data: null, message: '邮箱格式不正确' });
  }

  try {
    const result = await sendVerifyCode('email', email, 'register');
    res.json({ code: 0, data: { devCode: result.devCode }, message: '验证码已发送到邮箱' });
  } catch (error) {
    res.status(429).json({ code: 429, data: null, message: error.message });
  }
});

/**
 * POST /verify-email-code
 * 校验邮箱验证码
 * Body: { email, code }
 */
router.post('/verify-email-code', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ code: 400, data: null, message: '参数不完整' });
  }

  const passed = await verifyCode('email', email, code);
  if (!passed) {
    return res.status(400).json({ code: 400, data: null, message: '验证码错误或已过期' });
  }

  // 生成一次性 verifyToken，绑定邮箱，注册时后端校验
  const verifyToken = await generateVerifyToken('email', email);
  res.json({ code: 0, data: { verified: true, verifyToken }, message: '验证通过' });
});

module.exports = { prefix: '/api/public/register-captcha', router, consumeVerifyToken };
