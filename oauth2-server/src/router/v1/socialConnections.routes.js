const express = require('express');
const { requireConsoleAuth } = require('../../service/consoleAuth.service');
const ctrl = require('../../controller/socialConnections.controller');

// ==================== 控制台管理 API ====================
const consoleRouter = express.Router();
consoleRouter.use(requireConsoleAuth);

consoleRouter.get('/types', ctrl.getTypes);
consoleRouter.get('/', ctrl.listConnections);
consoleRouter.get('/:id/secret', ctrl.getSecret);
consoleRouter.get('/:id', ctrl.getConnection);
consoleRouter.post('/', ctrl.createConnection);
consoleRouter.put('/:id', ctrl.updateConnection);
consoleRouter.get('/:id/linked-apps', ctrl.getLinkedApps);
consoleRouter.put('/:id/linked-apps/:appClientId', ctrl.toggleLinkedApp);
consoleRouter.delete('/:id', ctrl.deleteConnection);

// ==================== Gitee OAuth2 回调 ====================
const oauthSocialRouter = express.Router();

oauthSocialRouter.get('/gitee/authorize', ctrl.giteeAuthorize);
oauthSocialRouter.get('/gitee/callback', ctrl.giteeCallback);

// ==================== 公开接口 ====================
const publicRouter = express.Router();

publicRouter.get('/', ctrl.listPublicConnections);

module.exports = [
  { prefix: '/api/console/social-connections', router: consoleRouter },
  { prefix: '/oauth/social', router: oauthSocialRouter },
  { prefix: '/api/public/social-connections', router: publicRouter },
];
