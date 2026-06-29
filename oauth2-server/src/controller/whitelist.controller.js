/**
 * Whitelist Controller — 白名单管理 + 注册配置
 */
const Whitelist = require('../model/whitelist.model');
const { getSystemConfig, updateSystemConfig } = require('../model/systemConfig.model');

async function getConfig(req, res) {
  try {
    const config = await getSystemConfig();
    res.json({
      code: 0,
      data: {
        registrationEnabled: config.registrationEnabled,
        whitelistEnabled: config.whitelistEnabled,
      },
      message: '',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function updateConfig(req, res) {
  try {
    const { registrationEnabled, whitelistEnabled } = req.body || {};
    const config = await updateSystemConfig({ registrationEnabled, whitelistEnabled });
    res.json({
      code: 0,
      data: {
        registrationEnabled: config.registrationEnabled,
        whitelistEnabled: config.whitelistEnabled,
      },
      message: '配置更新成功',
    });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function listWhitelist(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const filter = {};
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.keyword) {
      filter.value = { $regex: req.query.keyword, $options: 'i' };
    }
    const total = await Whitelist.countDocuments(filter);
    const items = await Whitelist.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    const list = items.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function createWhitelistItem(req, res) {
  try {
    const { type, value, remark } = req.body || {};
    if (!type || !value) {
      return res.status(400).json({ code: 400, data: null, message: '类型和值不能为空' });
    }
    if (!['phone', 'email', 'username'].includes(type)) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '类型必须为 phone/email/username' });
    }
    const item = await Whitelist.create({ type, value: value.trim(), remark: remark || '' });
    res.status(201).json({ code: 0, data: item.toJSON(), message: '白名单条目添加成功' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ code: 400, data: null, message: '该条目已存在' });
    }
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function batchImport(req, res) {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供白名单条目列表' });
    }
    const results = { success: 0, skipped: 0, errors: [] };
    for (const item of items) {
      try {
        await Whitelist.create({
          type: item.type,
          value: item.value?.trim(),
          remark: item.remark || '',
        });
        results.success++;
      } catch (err) {
        if (err.code === 11000) {
          results.skipped++;
        } else {
          results.errors.push({ value: item.value, error: err.message });
        }
      }
    }
    res.json({
      code: 0,
      data: results,
      message: `导入完成：成功 ${results.success}，跳过 ${results.skipped}`,
    });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function deleteWhitelistItem(req, res) {
  try {
    const result = await Whitelist.findByIdAndDelete(req.params.itemId);
    if (!result) {
      return res.status(404).json({ code: 404, data: null, message: '条目不存在' });
    }
    res.json({ code: 0, message: '白名单条目已删除' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function batchDelete(req, res) {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供要删除的 ID 列表' });
    }
    const result = await Whitelist.deleteMany({ _id: { $in: ids } });
    res.json({ code: 0, data: { deletedCount: result.deletedCount }, message: '批量删除完成' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  listWhitelist,
  createWhitelistItem,
  batchImport,
  deleteWhitelistItem,
  batchDelete,
};
