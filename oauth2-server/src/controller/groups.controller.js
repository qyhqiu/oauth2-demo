/**
 * Groups Controller — 分组管理
 */
const Group = require('../model/group.model');

async function listGroups(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const filter = {};
    if (req.query.keyword) {
      const regex = { $regex: req.query.keyword, $options: 'i' };
      filter.$or = [{ name: regex }, { code: regex }];
    }
    const total = await Group.countDocuments(filter);
    const groups = await Group.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    const list = groups.map(({ _id, members, authorizedApps, ...rest }) => ({
      id: _id.toString(),
      ...rest,
      memberCount: members ? members.length : 0,
      authorizedApps: authorizedApps || [],
    }));
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getGroup(req, res) {
  try {
    const group = await Group.findById(req.params.groupId).lean();
    if (!group) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = group;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function createGroup(req, res) {
  try {
    const { name, code, description } = req.body || {};
    if (!name) {
      return res.status(400).json({ code: 400, data: null, message: '分组名称不能为空' });
    }
    const group = await Group.create({ name, code: code || '', description: description || '' });
    res.status(201).json({ code: 0, data: group.toJSON(), message: '分组创建成功' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ code: 400, data: null, message: '分组名称已存在' });
    }
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function updateGroup(req, res) {
  try {
    const { name, code, description } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      updates.name = name;
    }
    if (code !== undefined) {
      updates.code = code;
    }
    if (description !== undefined) {
      updates.description = description;
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $set: updates },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '分组更新成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function deleteGroup(req, res) {
  try {
    const result = await Group.findByIdAndDelete(req.params.groupId);
    if (!result) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    res.json({ code: 0, data: null, message: '分组已删除' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function addMembers(req, res) {
  try {
    const { userIds } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供用户 ID 列表' });
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $addToSet: { members: { $each: userIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '成员添加成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function removeMembers(req, res) {
  try {
    const { userIds } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供用户 ID 列表' });
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $pull: { members: { $in: userIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '成员移除成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function getMembers(req, res) {
  try {
    const group = await Group.findById(req.params.groupId).populate('members', '-password').lean();
    if (!group) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const allMembers = (group.members || []).map(({ _id, password: _pw, ...rest }) => ({
      id: _id.toString(),
      ...rest,
    }));
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const keyword = req.query.keyword || '';

    let filtered = allMembers;
    if (keyword) {
      const lowerKw = keyword.toLowerCase();
      filtered = allMembers.filter(
        (m) =>
          (m.username || '').toLowerCase().includes(lowerKw) ||
          (m.name || '').toLowerCase().includes(lowerKw) ||
          (m.email || '').toLowerCase().includes(lowerKw) ||
          (m.phone || '').toLowerCase().includes(lowerKw),
      );
    }
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function authorizeApps(req, res) {
  try {
    const { clientIds } = req.body || {};
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供应用 clientId 列表' });
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $addToSet: { authorizedApps: { $each: clientIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '应用授权成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function revokeApps(req, res) {
  try {
    const { clientIds } = req.body || {};
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供应用 clientId 列表' });
    }
    const updated = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $pull: { authorizedApps: { $in: clientIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '分组不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '已取消应用授权' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMembers,
  getMembers,
  authorizeApps,
  revokeApps,
};
