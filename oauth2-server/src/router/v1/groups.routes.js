const express = require('express');
const { requireConsoleAuth } = require('../../service/consoleAuth.service');
const ctrl = require('../../controller/groups.controller');

const router = express.Router();
router.use(requireConsoleAuth);

router.get('/', ctrl.listGroups);
router.get('/:groupId', ctrl.getGroup);
router.post('/', ctrl.createGroup);
router.put('/:groupId', ctrl.updateGroup);
router.delete('/:groupId', ctrl.deleteGroup);
router.post('/:groupId/members', ctrl.addMembers);
router.delete('/:groupId/members', ctrl.removeMembers);
router.get('/:groupId/members', ctrl.getMembers);
router.post('/:groupId/authorize', ctrl.authorizeApps);
router.delete('/:groupId/authorize', ctrl.revokeApps);

module.exports = { prefix: '/api/console/groups', router };
