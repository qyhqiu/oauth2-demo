const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { redis } = require('../db/redis.db');

/**
 * TOTP（Time-based One-Time Password, RFC 6238）服务
 *
 * 用于 MFA 通道 = totp 时，与 Google Authenticator / 1Password / Authy 等
 * 任何支持 TOTP 的认证器 App 配合使用。
 *
 * 与短信 / 邮箱 OTP 的差异：
 *   - 不需要服务端发送验证码（认证器 App 本地生成，离线也能用）
 *   - 共享密钥（totpSecret）一次性生成 + 永久存储，无需每次刷新
 *   - 验证码每 30s 刷新一次；服务端校验时允许 ±1 个 step 的时钟偏移
 */

// 30s 一个 step；校验时允许 ±1 step（前后 30s）的偏移，容忍设备时钟轻微不同步
const TOTP_STEP_SECONDS = 30;
const TOTP_VERIFY_WINDOW = 1;

// Issuer 在认证器 App 上的展示名（推荐显示为 "OAuth2 Demo (admin)"）
const TOTP_ISSUER = 'OAuth2 Demo';

// 临时密钥 Redis Key：用户点击「绑定 TOTP」生成密钥后，先存 Redis 5 分钟，
// 用户用 App 扫码 + 输入一次正确动态码后，才正式写入 User.totpSecret。
// 避免直接写库导致一旦关闭弹窗，密钥不一致就再也登录不上。
const TOTP_PENDING_KEY = (userId) => `mfa:totp_pending:${userId}`;
const TOTP_PENDING_TTL_SECONDS = 5 * 60;

/**
 * 生成新的 TOTP 共享密钥 + otpauth URL + 二维码 data URL
 *
 * @param {string} accountLabel 在认证器 App 上展示的账号名（推荐用 username / phone / email）
 * @returns {Promise<{secret: string, otpauthUrl: string, qrCodeDataUrl: string}>}
 */
async function generateTotpSecret(accountLabel) {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${TOTP_ISSUER}:${accountLabel}`,
    issuer: TOTP_ISSUER,
  });

  // speakeasy 生成的 otpauth_url 默认带了 issuer，但有些 App 解析不严格，
  // 显式拼接确保 issuer + accountName 都正确
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.ascii,
    label: encodeURIComponent(`${TOTP_ISSUER}:${accountLabel}`),
    issuer: TOTP_ISSUER,
    algorithm: 'sha1',
    digits: 6,
    period: TOTP_STEP_SECONDS,
  });

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    margin: 1,
    width: 240,
  });

  return {
    secret: secret.base32, // 用 base32 给 speakeasy.totp.verify 用
    otpauthUrl,
    qrCodeDataUrl,
  };
}

/**
 * 校验 TOTP 动态码
 *
 * @param {string} secret base32 共享密钥（从 user.totpSecret 取）
 * @param {string} token  用户输入的 6 位动态码
 * @returns {boolean}
 */
function verifyTotpToken(secret, token) {
  if (!secret || !token) {
    return false;
  }
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token).trim(),
    step: TOTP_STEP_SECONDS,
    window: TOTP_VERIFY_WINDOW,
  });
}

/**
 * 暂存待绑定的 TOTP 密钥（控制台「绑定 TOTP」第 1 步：扫码前）
 */
async function savePendingTotpSecret(userId, secret) {
  await redis.set(TOTP_PENDING_KEY(userId), secret, 'EX', TOTP_PENDING_TTL_SECONDS);
}

/**
 * 取出待绑定的 TOTP 密钥（控制台「绑定 TOTP」第 2 步：用户输入动态码后校验）
 */
async function getPendingTotpSecret(userId) {
  return redis.get(TOTP_PENDING_KEY(userId));
}

/**
 * 清除待绑定的 TOTP 密钥（绑定成功 / 取消时调用）
 */
async function clearPendingTotpSecret(userId) {
  await redis.del(TOTP_PENDING_KEY(userId));
}

module.exports = {
  generateTotpSecret,
  verifyTotpToken,
  savePendingTotpSecret,
  getPendingTotpSecret,
  clearPendingTotpSecret,
  TOTP_ISSUER,
};
