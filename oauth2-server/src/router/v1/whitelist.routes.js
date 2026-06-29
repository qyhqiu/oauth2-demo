const express = require('express');
const { requireConsoleAuth } = require('../../service/consoleAuth.service');
const ctrl = require('../../controller/whitelist.controller');

const router = express.Router();
router.use(requireConsoleAuth);

router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.updateConfig);
router.get('/', ctrl.listWhitelist);
router.post('/', ctrl.createWhitelistItem);
router.post('/batch', ctrl.batchImport);
router.delete('/:itemId', ctrl.deleteWhitelistItem);
router.post('/batch-delete', ctrl.batchDelete);

module.exports = { prefix: '/api/console/whitelist', router };
