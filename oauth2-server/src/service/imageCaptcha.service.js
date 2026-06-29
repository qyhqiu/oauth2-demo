const svgCaptcha = require('svg-captcha');
const crypto = require('crypto');
const { redis } = require('../db/redis.db');

const IMAGE_CAPTCHA_PREFIX = 'reg:img:captcha:';
const IMAGE_CAPTCHA_TTL = 5 * 60; // 5 分钟

/**
 * 生成图形验证码
 * @returns {{ sessionId: string, svg: string }}
 */
async function generateImageCaptcha() {
  const captcha = svgCaptcha.create({
    size: 4,
    ignoreChars: '0o1iIlL',
    noise: 3,
    color: true,
    background: '#f0f4ff',
    width: 120,
    height: 40,
    fontSize: 40,
  });

  const sessionId = crypto.randomUUID();
  const key = `${IMAGE_CAPTCHA_PREFIX}${sessionId}`;
  await redis.set(key, captcha.text.toLowerCase(), 'EX', IMAGE_CAPTCHA_TTL);

  return { sessionId, svg: captcha.data };
}

/**
 * 校验并消费图形验证码（一次性使用）
 * @param {string} sessionId
 * @param {string} inputText
 * @returns {Promise<boolean>}
 */
async function verifyAndConsumeImageCaptcha(sessionId, inputText) {
  if (!sessionId || !inputText) {
    return false;
  }
  const key = `${IMAGE_CAPTCHA_PREFIX}${sessionId}`;
  const stored = await redis.get(key);
  if (!stored) {
    return false;
  }
  const isValid = stored === inputText.toLowerCase();
  if (isValid) {
    await redis.del(key);
  }
  return isValid;
}

module.exports = { generateImageCaptcha, verifyAndConsumeImageCaptcha };
