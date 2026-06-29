const express = require('express');
const { requireConsoleAuth } = require('../../service/consoleAuth.service');
const ctrl = require('../../controller/orgs.controller');

const router = express.Router();
router.use(requireConsoleAuth);

router.get('/tree', ctrl.getTree);
router.get('/', ctrl.listOrgs);
router.post('/', ctrl.createOrg);
router.put('/:orgId', ctrl.updateOrg);
router.delete('/:orgId', ctrl.deleteOrg);
router.post('/:orgId/members', ctrl.addMembers);
router.delete('/:orgId/members', ctrl.removeMembers);
router.get('/:orgId/members', ctrl.getMembers);

module.exports = { prefix: '/api/console/orgs', router };
