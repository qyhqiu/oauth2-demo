const express = require('express');
const { requireConsoleAuth } = require('../../service/consoleAuth.service');
const ctrl = require('../../controller/console.controller');

const router = express.Router();

// ==================== 公开端点（requireConsoleAuth 之前） ====================
router.post('/admin/login', ctrl.adminLogin);
router.get('/admin/oauth2-config', ctrl.getOAuth2Config);
router.get('/admin/oauth2-login', ctrl.oauth2Login);
router.post('/admin/oauth2-exchange', ctrl.oauth2Exchange);

// ==================== 以下均需管理员鉴权 ====================
router.use(requireConsoleAuth);

router.get('/admin/me', ctrl.getAdminMe);
router.get('/overview', ctrl.getOverview);
router.get('/admin/oauth2-apps', ctrl.getOAuth2Apps);

// 应用管理
router.get('/apps', ctrl.listApps);
router.get('/apps/:clientId', ctrl.getApp);
router.post('/apps/:clientId/refresh-secret', ctrl.refreshSecret);
router.post('/apps', ctrl.createApp);
router.put('/apps/:clientId', ctrl.updateApp);
router.delete('/apps/:clientId', ctrl.deleteApp);

// 应用分析
router.get('/apps/:clientId/summary', ctrl.getAppSummary);
router.get('/apps/:clientId/logged-in-users', ctrl.getAppLoggedInUsers);
router.get('/apps/:clientId/login-trend', ctrl.getLoginTrend);
router.get('/apps/:clientId/login-logs', ctrl.getLoginLogs);
router.get('/apps/:clientId/login-logs/export', ctrl.exportLoginLogs);
router.get('/apps/:clientId/login-geo', ctrl.getLoginGeo);
router.post('/apps/:clientId/unlock-user', ctrl.unlockAppUser);

// 应用访问控制列表
router.get('/apps/:clientId/access-control', ctrl.getAppAccessControlList);
router.post('/apps/:clientId/access-control', ctrl.addAppAccessControlItem);
router.put('/apps/:clientId/access-control/:itemId', ctrl.updateAppAccessControlItem);
router.delete('/apps/:clientId/access-control/:itemId', ctrl.deleteAppAccessControlItem);
router.put('/apps/:clientId/default-permission', ctrl.updateAppDefaultPermission);

// 用户管理 — 注意：批量接口放在 :userId 参数路由之前，避免被误匹配
router.get('/users/sessions/batch', ctrl.batchSessions);
router.get('/users/export', ctrl.exportUsers);
router.post('/users/send-create-code', ctrl.sendCreateCode);
router.get('/users/import-template', ctrl.downloadImportTemplate);
router.post('/users/import', ctrl.importUsers);

router.get('/users', ctrl.listUsers);
router.get('/users/:userId', ctrl.getUser);
router.post('/users', ctrl.createUserHandler);
router.put('/users/:userId', ctrl.updateUserHandler);
router.delete('/users/:userId', ctrl.deleteUserHandler);
router.post('/users/:userId/force-logout', ctrl.forceLogout);
router.get('/users/:userId/sessions', ctrl.getUserSessions);
router.post('/users/:userId/lock', ctrl.lockUser);
router.post('/users/:userId/unlock', ctrl.unlockUserHandler);
router.post('/users/:userId/disable', ctrl.disableUser);
router.post('/users/:userId/enable', ctrl.enableUser);
router.post('/users/:userId/reset-password', ctrl.resetPassword);
router.get('/users/:userId/login-history', ctrl.getLoginHistory);
router.get('/users/:userId/login-apps', ctrl.getLoginApps);

// MFA 管理
router.put('/users/:userId/mfa', ctrl.updateMfa);
router.post('/users/:userId/send-code', ctrl.sendCode);
router.post('/users/:userId/bind-phone', ctrl.bindPhoneHandler);
router.post('/users/:userId/bind-email', ctrl.bindEmailHandler);
router.post('/users/:userId/unbind-phone', ctrl.unbindPhoneHandler);
router.post('/users/:userId/unbind-email', ctrl.unbindEmailHandler);
router.post('/users/:userId/totp/setup', ctrl.totpSetup);
router.post('/users/:userId/totp/confirm', ctrl.totpConfirm);
router.post('/users/:userId/totp/unbind', ctrl.totpUnbind);

// 系统配置
router.get('/system-config', ctrl.getSystemConfigHandler);
router.put('/system-config', ctrl.updateSystemConfigHandler);

module.exports = { prefix: '/api/console', router };
