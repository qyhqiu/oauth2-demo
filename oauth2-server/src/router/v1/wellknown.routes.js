const express = require('express');
const { getOpenidConfiguration, getJwks } = require('../../controller/wellknown.controller');

const router = express.Router();

router.get('/openid-configuration', getOpenidConfiguration);
router.get('/jwks.json', getJwks);

module.exports = { prefix: '/.well-known', router };
