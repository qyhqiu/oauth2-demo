/**
 * 请求元数据解析工具
 * - UA 解析：浏览器 / 操作系统 / 设备类型（基于 ua-parser-js）
 * - IP 反查：国家 / 地区 / 城市（基于 geoip-lite 离线库）
 *
 * 用于登录埋点 + 审计日志，让管理员可以看到"谁在哪从什么设备登录了"
 */
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');

/**
 * 从 Express req 提取真实客户端 IP
 * - 优先 req.ip（已开启 trust proxy 时会拿 X-Forwarded-For）
 * - 兼容 IPv6 映射的 IPv4（"::ffff:127.0.0.1" → "127.0.0.1"）
 * - 本机回环（127.0.0.1 / ::1）保留原值，便于本地开发识别
 */
function getRealIp(req) {
  let ip = req.ip || req.connection?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip;
}

/**
 * 解析 User-Agent 字符串
 * @param {string} ua
 * @returns {{browser, os, device}}
 */
function parseUserAgent(ua) {
  if (!ua) {
    return { browser: '', os: '', device: 'desktop' };
  }

  const parser = new UAParser(ua);
  const result = parser.getResult();

  const browserName = result.browser.name || '';
  const browserVersion = result.browser.version ? result.browser.version.split('.')[0] : '';
  const osName = result.os.name || '';
  const osVersion = result.os.version ? result.os.version.split('.').slice(0, 2).join('.') : '';

  // ua-parser 的 device.type 仅在 mobile/tablet 时有值；桌面端一律为 undefined
  const deviceType = result.device.type || 'desktop';

  return {
    browser: browserName ? `${browserName}${browserVersion ? ' ' + browserVersion : ''}` : '',
    os: osName ? `${osName}${osVersion ? ' ' + osVersion : ''}` : '',
    device: deviceType,
  };
}

/**
 * 反查 IP 地理位置
 * - 私有/回环 IP（127.0.0.1 / 192.168.x / 10.x / ::1）返回 "本地" 占位
 * - 公网 IP 走 geoip-lite 离线库（启动时加载到内存，零网络延迟）
 * @param {string} ip
 * @returns {{country, region, city}}
 */
function lookupGeo(ip) {
  if (!ip) {
    return { country: '', region: '', city: '' };
  }

  // 本地/私有 IP 直接返回占位（geoip-lite 对这些 IP 返回 null）
  if (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  ) {
    return { country: 'LOCAL', region: '', city: '本地' };
  }

  const geo = geoip.lookup(ip);
  if (!geo) {
    return { country: '', region: '', city: '' };
  }

  return {
    country: geo.country || '',
    region: geo.region || '',
    city: geo.city || '',
  };
}

/**
 * 一站式：从请求提取 IP/UA + 解析为元数据
 */
function extractRequestMeta(req) {
  const ip = getRealIp(req);
  const userAgent = req.headers['user-agent'] || '';
  return {
    ip,
    userAgent,
    ...parseUserAgent(userAgent),
    ...lookupGeo(ip),
  };
}

module.exports = {
  getRealIp,
  parseUserAgent,
  lookupGeo,
  extractRequestMeta,
};
