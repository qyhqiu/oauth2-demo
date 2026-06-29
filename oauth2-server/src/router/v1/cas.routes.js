const express = require('express');
const { getSession, silentAuthorize } = require('../../controller/cas.controller');

const router = express.Router();

router.get('/session', getSession);
router.get('/silent-authorize', silentAuthorize);

module.exports = { prefix: '/cas', router };
