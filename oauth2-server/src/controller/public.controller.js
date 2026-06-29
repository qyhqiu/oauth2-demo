/**
 * Public Controller — 公开接口（无需认证）
 */
const { logger } = require('../utils/logger');
const { findClientById } = require('../service/client.service');

async function verifyClient(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const { clientId } = req.params;
    const { origin } = req.query;

    if (!origin) {
      return res.json({ code: 0, data: { matched: false, reason: 'missing_origin' }, message: '' });
    }

    const client = await findClientById(clientId);
    if (!client) {
      return res.json({
        code: 0,
        data: { matched: false, reason: 'client_not_found' },
        message: '',
      });
    }

    res.json({
      code: 0,
      data: { matched: client.origin === origin, expectedOrigin: client.origin },
      message: '',
    });
  } catch (error) {
    logger.error('[public] /verify 失败:', error.message);
    res.json({ code: 0, data: { matched: false, reason: 'server_error' }, message: '' });
  }
}

async function getBranding(req, res) {
  try {
    const client = await findClientById(req.params.clientId);
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }

    const branding = client.branding || {};
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      code: 0,
      data: {
        clientId: client.clientId,
        name: client.name,
        description: client.description,
        logoUrl: branding.logoUrl || '',
        primaryColor: branding.primaryColor || '#5b50e8',
        welcomeText: branding.welcomeText || '',
        copyright: branding.copyright || '',
        allowRegister:
          client.loginPolicy?.allowRegister !== undefined
            ? client.loginPolicy.allowRegister
            : false,
      },
      message: '',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

/**
 * GET /clients/:clientId/config
 * 公开接口：根据 clientId 获取应用配置信息（供 SDK 初始化使用）
 * 返回应用的基本配置，不包含敏感信息（clientSecret）
 */
async function getAppConfig(req, res) {
  res.set('Cache-Control', 'public, max-age=60');
  try {
    const { clientId } = req.params;
    const client = await findClientById(clientId);

    if (!client) {
      return res.status(404).json({
        code: 404,
        data: null,
        message: `应用 [${clientId}] 不存在`,
      });
    }

    res.json({
      code: 0,
      data: {
        clientId: client.clientId,
        name: client.name,
        origin: client.origin,
        clientType: client.clientType || 'web',
        redirectUris: client.redirectUris || [],
        postLoginRedirectUri: client.postLoginRedirectUri || '',
        scope: client.scope || ['openid', 'profile'],
        pkce: client.pkce !== false,
        enabled: client.loginPolicy?.enabled !== false,
      },
      message: '',
    });
  } catch (error) {
    logger.error('[public] /config 失败:', error.message);
    res.status(500).json({ code: 500, data: null, message: '服务器内部错误' });
  }
}

module.exports = { verifyClient, getBranding, getAppConfig };
