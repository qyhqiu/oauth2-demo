/**
 * Orgs Controller — 组织架构管理
 */
const Org = require('../model/org.model');

function buildTree(flatList, parentId = null) {
  return flatList
    .filter((node) => String(node.parentId || '') === String(parentId || ''))
    .sort((a, b) => a.order - b.order)
    .map((node) => ({ ...node, children: buildTree(flatList, node.id) }));
}

function formatOrg(doc) {
  const { _id, members, ...rest } = doc;
  return {
    id: _id.toString(),
    parentId: rest.parentId ? rest.parentId.toString() : null,
    ...rest,
    memberCount: members ? members.length : 0,
  };
}

async function getTree(req, res) {
  try {
    const allOrgs = await Org.find().sort({ order: 1, createdAt: 1 }).lean();
    res.json({ code: 0, data: buildTree(allOrgs.map(formatOrg)), message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function listOrgs(req, res) {
  try {
    const allOrgs = await Org.find().sort({ order: 1 }).lean();
    res.json({ code: 0, data: allOrgs.map(formatOrg), message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function createOrg(req, res) {
  try {
    const { name, code, description, parentId, order } = req.body || {};
    if (!name) {
      return res.status(400).json({ code: 400, data: null, message: '组织名称不能为空' });
    }
    if (parentId) {
      const parent = await Org.findById(parentId);
      if (!parent) {
        return res.status(400).json({ code: 400, data: null, message: '父节点不存在' });
      }
    }
    const org = await Org.create({
      name,
      code: code || '',
      description: description || '',
      parentId: parentId || null,
      order: order || 0,
    });
    res.status(201).json({ code: 0, data: org.toJSON(), message: '组织创建成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function updateOrg(req, res) {
  try {
    const { name, code, description, parentId, order } = req.body || {};
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
    if (parentId !== undefined) {
      updates.parentId = parentId || null;
    }
    if (order !== undefined) {
      updates.order = order;
    }
    if (parentId && parentId === req.params.orgId) {
      return res.status(400).json({ code: 400, data: null, message: '不能将节点移动到自身下方' });
    }
    const updated = await Org.findByIdAndUpdate(
      req.params.orgId,
      { $set: updates },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '组织不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '组织更新成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function deleteOrg(req, res) {
  try {
    const org = await Org.findById(req.params.orgId);
    if (!org) {
      return res.status(404).json({ code: 404, data: null, message: '组织不存在' });
    }
    async function deleteDescendants(parentId) {
      const children = await Org.find({ parentId });
      for (const child of children) {
        await deleteDescendants(child._id);
        await Org.findByIdAndDelete(child._id);
      }
    }
    await deleteDescendants(req.params.orgId);
    await Org.findByIdAndDelete(req.params.orgId);
    res.json({ code: 0, data: null, message: '组织及其子节点已删除' });
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
    const updated = await Org.findByIdAndUpdate(
      req.params.orgId,
      { $addToSet: { members: { $each: userIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '组织不存在' });
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
    const updated = await Org.findByIdAndUpdate(
      req.params.orgId,
      { $pull: { members: { $in: userIds } } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ code: 404, data: null, message: '组织不存在' });
    }
    const { _id, ...rest } = updated;
    res.json({ code: 0, data: { id: _id.toString(), ...rest }, message: '成员移除成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function getMembers(req, res) {
  try {
    const org = await Org.findById(req.params.orgId).populate('members', '-password').lean();
    if (!org) {
      return res.status(404).json({ code: 404, data: null, message: '组织不存在' });
    }
    const allMembers = (org.members || []).map(({ _id, password: _pw, ...rest }) => ({
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

module.exports = {
  getTree,
  listOrgs,
  createOrg,
  updateOrg,
  deleteOrg,
  addMembers,
  removeMembers,
  getMembers,
};
