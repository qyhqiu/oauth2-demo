const express = require('express');
const { verifyClient, getBranding, getAppConfig } = require('../../controller/public.controller');

const router = express.Router();

router.get('/clients/:clientId/verify', verifyClient);
router.get('/clients/:clientId/branding', getBranding);
router.get('/clients/:clientId/config', getAppConfig);

module.exports = { prefix: '/api/public', router };
