/**
 * 密钥仓库（KeyStore）
 *
 * 职责：
 * - 启动时加载或生成密钥对（PKCS#8 PEM 格式）
 * - 持久化到 ./keys 目录，避免服务重启后 kid 变更导致历史 token 全部失效
 * - 把公钥转换为 JWK 格式供 /.well-known/jwks.json 端点发布
 *
 * 安全性与性能优化：
 * - 默认算法：ES256（ECDSA P-256）— 安全性等同 RSA 3072，签名/验签性能提升 ~10 倍
 * - 备选算法：RS256（RSA 3072 位）— 通过环境变量 KEY_ALGORITHM=rsa 切换
 * - 缓存 KeyObject 而非 PEM 字符串，避免每次签名时重复解析
 * - 自动检测已有密钥类型，向后兼容旧 RSA 密钥
 *
 * 环境变量：
 *   KEY_ALGORITHM - 'ec'（默认）或 'rsa'
 *
 * 对比：
 *   | 算法   | 密钥大小   | 安全强度 | 签名速度 | Token 大小 |
 *   |--------|-----------|---------|---------|-----------|
 *   | ES256  | 256 bit   | 128 bit | ~10x    | ~60% 更短  |
 *   | RS256  | 3072 bit  | 128 bit | 基准    | 基准       |
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('./logger');

const KEYS_DIR = path.resolve(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const KID_PATH = path.join(KEYS_DIR, 'kid.txt');
const ALG_PATH = path.join(KEYS_DIR, 'alg.txt');

// 旧版 RSA 密钥路径（向后兼容）
const LEGACY_RSA_PRIVATE_PATH = path.join(KEYS_DIR, 'rsa-private.pem');
const LEGACY_RSA_PUBLIC_PATH = path.join(KEYS_DIR, 'rsa-public.pem');

// 环境变量选择算法：ec（默认）或 rsa
const PREFERRED_ALGORITHM = (process.env.KEY_ALGORITHM || 'ec').toLowerCase();

// 模块级缓存 — 使用 KeyObject 避免每次签名时重复解析 PEM
let cachedPrivateKeyObject = null;
let cachedPublicKeyObject = null;
let cachedPrivateKeyPem = null;
let cachedPublicKeyPem = null;
let cachedKid = null;
let cachedAlg = null; // 'ES256' 或 'RS256'

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
}

/**
 * 根据 PEM 内容检测密钥类型
 */
function detectKeyType(publicKeyPem) {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  return keyObject.asymmetricKeyType; // 'rsa' | 'ec'
}

/**
 * 生成 EC P-256 密钥对
 */
function generateEcKeys() {
  logger.info('🔑 正在生成新的 EC P-256 密钥对（ES256）...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, alg: 'ES256' };
}

/**
 * 生成 RSA 3072 密钥对（安全性等同 EC P-256）
 */
function generateRsaKeys() {
  logger.info('🔑 正在生成新的 RSA 3072 位密钥对（RS256）...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, alg: 'RS256' };
}

function generateAndPersistKeys() {
  const { privateKey, publicKey, alg } =
    PREFERRED_ALGORITHM === 'rsa' ? generateRsaKeys() : generateEcKeys();

  const kid = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

  ensureKeysDir();
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  fs.writeFileSync(KID_PATH, kid, { mode: 0o644 });
  fs.writeFileSync(ALG_PATH, alg, { mode: 0o644 });
  logger.info(`✅ 新密钥对已生成（alg=${alg}, kid=${kid}）保存到 ${KEYS_DIR}`);

  return { privateKey, publicKey, kid, alg };
}

/**
 * 启动时初始化：有则加载（自动检测类型），无则生成
 */
function initKeys() {
  if (cachedPrivateKeyObject && cachedPublicKeyObject && cachedKid) {
    return;
  }

  ensureKeysDir();

  let privateKeyPem = null;
  let publicKeyPem = null;
  let kid = null;
  let alg = null;

  // 优先加载新路径
  if (
    fs.existsSync(PRIVATE_KEY_PATH) &&
    fs.existsSync(PUBLIC_KEY_PATH) &&
    fs.existsSync(KID_PATH)
  ) {
    privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
    publicKeyPem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
    kid = fs.readFileSync(KID_PATH, 'utf-8').trim();
    alg = fs.existsSync(ALG_PATH) ? fs.readFileSync(ALG_PATH, 'utf-8').trim() : null;
  }
  // 向后兼容：加载旧版 RSA 密钥
  else if (fs.existsSync(LEGACY_RSA_PRIVATE_PATH) && fs.existsSync(LEGACY_RSA_PUBLIC_PATH)) {
    privateKeyPem = fs.readFileSync(LEGACY_RSA_PRIVATE_PATH, 'utf-8');
    publicKeyPem = fs.readFileSync(LEGACY_RSA_PUBLIC_PATH, 'utf-8');
    kid = fs.existsSync(KID_PATH) ? fs.readFileSync(KID_PATH, 'utf-8').trim() : null;
    if (!kid) {
      kid = crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
    }
    alg = 'RS256';
    logger.info('🔑 检测到旧版 RSA 密钥文件，已加载并兼容');
  }

  // 无任何密钥 → 生成新的
  if (!privateKeyPem || !publicKeyPem) {
    const generated = generateAndPersistKeys();
    privateKeyPem = generated.privateKey;
    publicKeyPem = generated.publicKey;
    kid = generated.kid;
    alg = generated.alg;
  }

  // 自动检测密钥类型确定算法
  if (!alg) {
    const keyType = detectKeyType(publicKeyPem);
    alg = keyType === 'ec' ? 'ES256' : 'RS256';
  }

  // 缓存 KeyObject（避免每次签名时重复解析 PEM）
  cachedPrivateKeyObject = crypto.createPrivateKey(privateKeyPem);
  cachedPublicKeyObject = crypto.createPublicKey(publicKeyPem);
  cachedPrivateKeyPem = privateKeyPem;
  cachedPublicKeyPem = publicKeyPem;
  cachedKid = kid;
  cachedAlg = alg;

  logger.info(`🔑 密钥已加载（alg=${alg}, kid=${kid}）`);
}

/**
 * 获取私钥（PEM 字符串，兼容 jsonwebtoken 库）
 */
function getPrivateKey() {
  if (!cachedPrivateKeyPem) {
    initKeys();
  }
  return cachedPrivateKeyPem;
}

/**
 * 获取公钥（PEM 字符串，兼容 jsonwebtoken 库）
 */
function getPublicKey() {
  if (!cachedPublicKeyPem) {
    initKeys();
  }
  return cachedPublicKeyPem;
}

/**
 * 获取私钥 KeyObject（性能更优，直接用于 crypto.sign）
 */
function getPrivateKeyObject() {
  if (!cachedPrivateKeyObject) {
    initKeys();
  }
  return cachedPrivateKeyObject;
}

/**
 * 获取公钥 KeyObject（性能更优，直接用于 crypto.verify）
 */
function getPublicKeyObject() {
  if (!cachedPublicKeyObject) {
    initKeys();
  }
  return cachedPublicKeyObject;
}

function getKid() {
  if (!cachedKid) {
    initKeys();
  }
  return cachedKid;
}

/**
 * 获取当前使用的签名算法（'ES256' 或 'RS256'）
 */
function getSigningAlgorithm() {
  if (!cachedAlg) {
    initKeys();
  }
  return cachedAlg;
}

/**
 * 把公钥转换为 JWK（RFC 7517）
 */
function getPublicJwk() {
  if (!cachedPublicKeyObject) {
    initKeys();
  }
  const jwk = cachedPublicKeyObject.export({ format: 'jwk' });

  return {
    ...jwk,
    kid: cachedKid,
    use: 'sig',
    alg: cachedAlg,
  };
}

module.exports = {
  initKeys,
  getPrivateKey,
  getPublicKey,
  getPrivateKeyObject,
  getPublicKeyObject,
  getKid,
  getSigningAlgorithm,
  getPublicJwk,
};
