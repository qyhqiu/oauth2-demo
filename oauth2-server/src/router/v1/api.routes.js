const express = require('express');
const { verifyAccessToken } = require('../../middleware/verifyAccessToken.middleware');
const { healthCheck, getProtectedData } = require('../../controller/api.controller');

const router = express.Router();

router.get('/health', healthCheck);
router.get('/protected/data', verifyAccessToken, getProtectedData);

module.exports = { prefix: '/api', router };
