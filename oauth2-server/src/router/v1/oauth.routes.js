const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAccessToken } = require('../../middleware/verifyAccessToken.middleware');
const ctrl = require('../../controller/oauth.controller');

const router = express.Router();

// 自助注册限流
const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: '注册请求过于频繁，请 15 分钟后再试' },
});

router.get('/authorize', ctrl.authorize);
router.post('/login-and-authorize', ctrl.loginAndAuthorize);
router.post('/mfa-verify', ctrl.mfaVerify);
router.post('/mfa-resend', ctrl.mfaResend);
router.get('/set-cookie-and-redirect', ctrl.setCookieAndRedirect);
router.get('/logout', ctrl.logoutGet);
router.post('/logout', ctrl.logoutPost);
router.post('/token', ctrl.token);
router.get('/userinfo', verifyAccessToken, ctrl.getUserInfo);
router.post('/register', registerRateLimiter, ctrl.register);
router.post('/userinfo', verifyAccessToken, ctrl.getUserInfo);
router.post('/revoke', ctrl.revokeToken);

module.exports = { prefix: '/oauth', router };
