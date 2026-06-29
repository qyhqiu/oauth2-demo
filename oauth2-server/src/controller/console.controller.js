/**
 * Console Controller — 控制台管理业务逻辑
 */
const crypto = require('crypto');
const XLSX = require('xlsx');
const { logger } = require('../utils/logger');
const {
  redis,
  USER_SESSION_KEY,
  USER_REFRESH_KEY,
  REFRESH_KEY,
  LOGIN_FAIL_KEY,
  LOGIN_LOCK_KEY,
  CONSOLE_OAUTH2_STATE_KEY,
} = require('../db/redis.db');
const {
  getAllClients,
  findClientById,
  findClientByIdWithSecret,
  createClient,
  updateClient,
  deleteClient,
  refreshClientSecret,
} = require('../service/client.service');
const {
  getAllUsers,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  bindPhone,
  bindEmail,
  unbindPhone,
  unbindEmail,
  unlockUser,
} = require('../service/user.service');
const { sendVerifyCode, verifyCode } = require('../service/verifyCode.service');
const {
  generateTotpSecret,
  verifyTotpToken,
  savePendingTotpSecret,
  getPendingTotpSecret,
  clearPendingTotpSecret,
} = require('../service/totp.service');
const User = require('../model/user.model');
const { loginAdmin, issueConsoleTokenForUser } = require('../service/consoleAuth.service');
const { consumeAuthCode, verifyPkceChallenge } = require('../service/token.service');
const { OAUTH2_SERVER_URL, OAUTH2_LOGIN_URL, CONSOLE_URL } = require('../utils/constants');
const LoginLog = require('../model/loginLog.model');
const {
  getSystemConfig,
  updateSystemConfig,
  invalidateRateLimitCache,
} = require('../model/systemConfig.model');

const CONSOLE_CLIENT_ID = 'console-app';
const CONSOLE_FRONTEND_CALLBACK = `${CONSOLE_URL}/oauth2-callback`;
const CONSOLE_OAUTH2_STATE_TTL_SECONDS = 5 * 60;

// ==================== 管理员登录（公开） ====================

async function adminLogin(req, res) {
  try {
    const { username, password } = req.body || {};
    const result = await loginAdmin(username, password);
    res.json({ code: 0, data: result, message: '' });
  } catch (err) {
    // 登录失败统一返回 HTTP 200 + 业务错误码，避免浏览器/axios 拦截器误判为鉴权失效
    const codeMap = {
      invalid_request: 400,
      user_not_found: 1001,
      account_blocked: 1002,
      account_disabled: 1003,
      invalid_password: 1004,
      forbidden: 1005,
    };
    const bizCode = codeMap[err.code] || 500;
    res.json({ code: bizCode, data: null, message: err.message });
  }
}

function getOAuth2Config(req, res) {
  res.json({
    code: 0,
    data: {
      enabled: true,
      clientId: CONSOLE_CLIENT_ID,
      oauth2LoginUrl: OAUTH2_LOGIN_URL,
      redirectUri: CONSOLE_FRONTEND_CALLBACK,
    },
    message: '',
  });
}

async function oauth2Login(req, res) {
  try {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    await redis.set(
      CONSOLE_OAUTH2_STATE_KEY(state),
      JSON.stringify({ codeVerifier, createdAt: Date.now() }),
      'EX',
      CONSOLE_OAUTH2_STATE_TTL_SECONDS,
    );

    const authorizeUrl = new URL(`${OAUTH2_SERVER_URL}/v1/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', CONSOLE_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', CONSOLE_FRONTEND_CALLBACK);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    logger.info(
      `🔐 [OAuth2] 控制台发起 OAuth2 登录，state=${state.slice(0, 8)}... → /oauth/authorize`,
    );
    res.redirect(authorizeUrl.toString());
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function oauth2Exchange(req, res) {
  try {
    const { code, state } = req.body || {};
    if (!code || !state) {
      return res.status(400).json({ code: 400, data: null, message: '缺少 code 或 state 参数' });
    }

    const stateRaw = await redis.get(CONSOLE_OAUTH2_STATE_KEY(state));
    if (!stateRaw) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'state 无效或已过期，请重新发起 OAuth2 登录' });
    }
    await redis.del(CONSOLE_OAUTH2_STATE_KEY(state));
    const { codeVerifier } = JSON.parse(stateRaw);

    const codeData = await consumeAuthCode(code);
    if (!codeData) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'Authorization Code 无效或已过期' });
    }
    if (codeData.clientId !== CONSOLE_CLIENT_ID) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'Authorization Code 不属于控制台 client' });
    }
    if (codeData.redirectUri !== CONSOLE_FRONTEND_CALLBACK) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'redirect_uri 与授权请求不一致' });
    }

    if (!codeData.codeChallenge || !codeData.codeChallengeMethod) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '授权码未关联 PKCE challenge' });
    }
    if (!verifyPkceChallenge(codeVerifier, codeData.codeChallenge, codeData.codeChallengeMethod)) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'PKCE code_verifier 校验失败' });
    }

    const user = await findUserById(codeData.userId);
    if (!user) {
      return res.status(400).json({ code: 400, data: null, message: '授权码关联的用户不存在' });
    }

    const result = issueConsoleTokenForUser(user);
    logger.info(`✅ [OAuth2] 用户 [${user.username}] 通过 OAuth2 登录控制台成功`);
    res.json({ code: 0, data: result, message: '' });
  } catch (err) {
    const status =
      { invalid_request: 400, invalid_credentials: 401, forbidden: 403 }[err.code] || 500;
    res.status(status).json({ code: status, data: null, message: err.message });
  }
}

function getAdminMe(req, res) {
  res.json({ code: 0, data: req.consoleUser, message: '' });
}

// ==================== 概览 ====================

async function getOverview(req, res) {
  const [clients, users] = await Promise.all([getAllClients(), getAllUsers()]);
  res.json({
    code: 0,
    data: {
      totalApps: clients.length,
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
    },
    message: '',
  });
}

async function getOAuth2Apps(req, res) {
  try {
    const all = await getAllClients();
    // 应用切换器仅展示前端可跳转的应用（web / spa），排除 native、service、miniapp
    const FRONTEND_CLIENT_TYPES = new Set(['web', 'spa']);
    const apps = all
      .filter((c) => c.clientId !== CONSOLE_CLIENT_ID)
      .filter((c) => FRONTEND_CLIENT_TYPES.has(c.clientType || 'web'));
    res.json({ code: 0, data: apps, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

// ==================== 应用管理 ====================

async function listApps(req, res) {
  const { keyword } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);

  const Client = require('../model/client.model');
  const filter = {};
  if (keyword) {
    const regex = { $regex: keyword, $options: 'i' };
    filter.$or = [{ name: regex }, { clientId: regex }, { origin: regex }];
  }

  const total = await Client.countDocuments(filter);
  const clients = await Client.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const clientIds = clients.map((c) => c.clientId);
  const stats = await LoginLog.aggregate([
    { $match: { status: 'success', clientId: { $in: clientIds } } },
    {
      $group: {
        _id: '$clientId',
        totalLogins: { $sum: 1 },
        recentLogins: { $sum: { $cond: [{ $gte: ['$loggedInAt', sevenDaysAgo] }, 1, 0] } },
      },
    },
  ]);
  const statsMap = new Map(
    stats.map((s) => [s._id, { totalLogins: s.totalLogins, recentLogins: s.recentLogins }]),
  );
  const list = clients.map((client) => {
    const clientObj = client.toObject ? client.toObject() : { ...client };
    return {
      ...clientObj,
      ...(statsMap.get(clientObj.clientId) || { totalLogins: 0, recentLogins: 0 }),
    };
  });
  res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
}

async function getApp(req, res) {
  const client = await findClientByIdWithSecret(req.params.clientId);
  if (!client) {
    return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
  }
  res.json({ code: 0, data: client, message: '' });
}

async function refreshSecret(req, res) {
  try {
    const result = await refreshClientSecret(req.params.clientId);
    logger.info(`🔑 控制台刷新 App Secret: [${result.clientId}]`);
    res.json({ code: 0, data: result, message: 'App Secret 已重置' });
  } catch (err) {
    res.status(400).json({ code: 400, data: null, message: err.message });
  }
}

async function createApp(req, res) {
  try {
    const newClient = await createClient(req.body);
    logger.info(`🆕 控制台创建应用: [${newClient.name}] origin: ${newClient.origin}`);
    res.status(201).json({ code: 0, data: newClient, message: '应用创建成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function updateApp(req, res) {
  try {
    const updated = await updateClient(req.params.clientId, req.body);
    logger.info(`✏️ 控制台更新应用: [${updated.name}]`);
    res.json({ code: 0, data: updated, message: '应用更新成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function deleteApp(req, res) {
  try {
    await deleteClient(req.params.clientId);
    logger.info(`🗑️ 控制台删除应用: [${req.params.clientId}]`);
    res.json({ code: 0, message: '应用删除成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

// ==================== 应用分析 ====================

async function getAppSummary(req, res) {
  try {
    const { clientId } = req.params;
    const client = await findClientById(clientId);
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalLogins, todayAgg, totalUsersAgg, todayNewUsers] = await Promise.all([
      LoginLog.countDocuments({ clientId, status: 'success' }),
      LoginLog.aggregate([
        { $match: { clientId, status: 'success', loggedInAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, count: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      ]),
      LoginLog.aggregate([
        { $match: { clientId, status: 'success', userId: { $ne: null } } },
        { $group: { _id: '$userId' } },
        { $count: 'total' },
      ]),
      LoginLog.aggregate([
        {
          $match: {
            clientId,
            status: 'success',
            userId: { $ne: null },
            loggedInAt: { $gte: today, $lt: tomorrow },
          },
        },
        { $group: { _id: '$userId' } },
        {
          $lookup: {
            from: 'loginlogs',
            let: { uid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$clientId', clientId] },
                      { $eq: ['$userId', '$$uid'] },
                      { $eq: ['$status', 'success'] },
                      { $lt: ['$loggedInAt', today] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'prev',
          },
        },
        { $match: { prev: { $size: 0 } } },
        { $count: 'total' },
      ]),
    ]);

    const todayData = todayAgg[0] || { count: 0, users: [] };

    res.json({
      code: 0,
      data: {
        totalLogins,
        totalUsers: totalUsersAgg[0]?.total || 0,
        todayLogins: todayData.count,
        todayUsers: todayData.users.length,
        todayNewUsers: todayNewUsers[0]?.total || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getLoginTrend(req, res) {
  try {
    const { clientId } = req.params;
    const days = Math.min(parseInt(req.query.days, 10) || 7, 30);
    const client = await findClientById(clientId);
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (days - 1));
    const tz = process.env.TZ || 'Asia/Shanghai';

    const aggregated = await LoginLog.aggregate([
      { $match: { clientId, status: 'success', loggedInAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$loggedInAt', timezone: tz } },
          loginCount: { $sum: 1 },
          uniqueUserIds: { $addToSet: '$userId' },
        },
      },
      {
        $project: { _id: 0, date: '$_id', loginCount: 1, uniqueUsers: { $size: '$uniqueUserIds' } },
      },
    ]);
    const dateMap = new Map(aggregated.map((item) => [item.date, item]));
    const formatLocalDate = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const trend = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = formatLocalDate(d);
      const item = dateMap.get(dateStr);
      trend.push({
        date: dateStr,
        loginCount: item?.loginCount || 0,
        uniqueUsers: item?.uniqueUsers || 0,
      });
    }
    res.json({ code: 0, data: { clientId, days, trend }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getLoginLogs(req, res) {
  try {
    const { clientId } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const filter = { clientId };
    if (req.query.status && ['success', 'failure'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.keyword) {
      const regex = { $regex: req.query.keyword, $options: 'i' };
      filter.$or = [{ username: regex }, { ip: regex }];
    }
    const total = await LoginLog.countDocuments(filter);
    const list = await LoginLog.find(filter)
      .sort({ loggedInAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function exportLoginLogs(req, res) {
  try {
    const { clientId } = req.params;
    const { status, startDate, endDate } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 10000);
    const filter = { clientId };
    if (status && ['success', 'failure'].includes(status)) {
      filter.status = status;
    }
    const dateRange = {};
    if (startDate) {
      dateRange.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateRange.$lte = end;
    }
    if (!startDate && !endDate) {
      dateRange.$gte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    if (Object.keys(dateRange).length > 0) {
      filter.loggedInAt = dateRange;
    }

    const logs = await LoginLog.find(filter).sort({ loggedInAt: -1 }).limit(limit).lean();
    const headers = [
      '时间',
      '账号',
      '用户ID',
      '状态',
      '失败原因',
      'IP',
      '浏览器',
      '操作系统',
      '设备',
      '国家',
      '地区',
      '城市',
      'User-Agent',
    ];
    const formatDateTime = (d) => {
      if (!d) {
        return '';
      }
      const dt = new Date(d);
      const pad = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    };

    const dataRows = logs.map((l) => [
      formatDateTime(l.loggedInAt),
      l.username || '',
      l.userId || '',
      l.status === 'success' ? '成功' : '失败',
      l.failureReason || '',
      l.ip || '',
      l.browser || '',
      l.os || '',
      l.device || '',
      l.country || '',
      l.region || '',
      l.city || '',
      l.userAgent || '',
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    worksheet['!cols'] = [
      { wch: 22 },
      { wch: 16 },
      { wch: 26 },
      { wch: 8 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 40 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '审计日志');
    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `audit-logs-${clientId}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuffer);
    logger.info(`📤 [${clientId}] 导出审计日志 ${logs.length} 条 → ${filename}`);
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getLoginGeo(req, res) {
  try {
    const { clientId } = req.params;
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
    const level = req.query.level === 'region' ? 'region' : 'country';
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const baseMatch = {
      clientId,
      status: 'success',
      loggedInAt: { $gte: startDate },
      country: { $nin: ['', null, 'LOCAL'] },
    };

    if (level === 'region') {
      const country = req.query.country;
      if (!country) {
        return res
          .status(400)
          .json({ code: 400, data: null, message: 'level=region 时必须指定 country 参数' });
      }
      const aggregated = await LoginLog.aggregate([
        { $match: { ...baseMatch, country, region: { $nin: ['', null] } } },
        {
          $group: {
            _id: '$region',
            count: { $sum: 1 },
            uniqueUserIds: { $addToSet: '$userId' },
            cities: { $addToSet: '$city' },
          },
        },
        {
          $project: {
            _id: 0,
            region: '$_id',
            count: 1,
            uniqueUsers: { $size: '$uniqueUserIds' },
            cities: 1,
          },
        },
        { $sort: { count: -1 } },
      ]);
      return res.json({ code: 0, data: aggregated, message: '' });
    }

    const aggregated = await LoginLog.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 },
          uniqueUserIds: { $addToSet: '$userId' },
          cities: { $addToSet: '$city' },
        },
      },
      {
        $project: {
          _id: 0,
          country: '$_id',
          count: 1,
          uniqueUsers: { $size: '$uniqueUserIds' },
          cities: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);
    res.json({ code: 0, data: aggregated, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function unlockAppUser(req, res) {
  try {
    const { clientId } = req.params;
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ code: 400, data: null, message: '缺少 userId 参数' });
    }
    await Promise.all([
      redis.del(LOGIN_LOCK_KEY(clientId, userId)),
      redis.del(LOGIN_FAIL_KEY(clientId, userId)),
    ]);
    logger.info(`🔓 控制台解锁账号: clientId=${clientId} userId=${userId}`);
    res.json({ code: 0, message: '账号已解锁' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

// ==================== 用户管理 ====================

async function listUsers(req, res) {
  try {
    const { lockStatus, keyword } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const safeLockStatus = ['all', 'locked', 'normal'].includes(lockStatus) ? lockStatus : 'all';

    let filter = {};
    if (safeLockStatus === 'locked') {
      filter = { $or: [{ blocked: true }, { lockedUntil: { $gt: new Date() } }] };
    } else if (safeLockStatus === 'normal') {
      filter = {
        blocked: { $ne: true },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }],
      };
    }
    if (keyword) {
      const regex = { $regex: keyword, $options: 'i' };
      const keywordFilter = {
        $or: [
          { username: regex },
          { phone: regex },
          { email: regex },
          { name: regex },
          { nickname: regex },
        ],
      };
      filter = Object.keys(filter).length > 0 ? { $and: [filter, keywordFilter] } : keywordFilter;
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('+totpSecret')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    const list = users.map(({ _id, password: _pw, totpSecret, ...rest }) => ({
      id: _id.toString(),
      ...rest,
      totpBound: !!totpSecret,
    }));
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getUser(req, res) {
  try {
    const user = await findUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    res.json({ code: 0, data: user, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function createUserHandler(req, res) {
  try {
    const newUser = await createUser(req.body);
    logger.info(`🆕 控制台创建用户: [${newUser.username}]`);
    res.status(201).json({ code: 0, data: newUser, message: '用户创建成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function updateUserHandler(req, res) {
  try {
    const updated = await updateUser(req.params.userId, req.body);
    logger.info(`✏️ 控制台更新用户: [${updated.username}]`);
    res.json({ code: 0, data: updated, message: '用户更新成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function deleteUserHandler(req, res) {
  try {
    if (req.consoleUser && req.params.userId === req.consoleUser.sub) {
      return res.json({ code: 403, data: null, message: '不能删除当前登录的管理员账号' });
    }
    await deleteUser(req.params.userId);
    logger.info(`🗑️ 控制台删除用户: [${req.params.userId}]`);
    res.json({ code: 0, message: '用户删除成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

/**
 * 核心逻辑：撤销指定用户的所有 session（AccessToken + RefreshToken + OAuth2 Session）
 * 供 forceLogout / lockUser / disableUser 共用
 */
async function revokeAllUserSessions(userId) {
  const pipeline = redis.pipeline();
  const allAccessTokens = await redis.smembers(USER_SESSION_KEY(userId));
  allAccessTokens.forEach((token) => pipeline.del(`oauth:session:${token}`));
  pipeline.del(USER_SESSION_KEY(userId));
  const allRefreshTokens = await redis.smembers(USER_REFRESH_KEY(userId));
  allRefreshTokens.forEach((token) => pipeline.del(REFRESH_KEY(token)));
  pipeline.del(USER_REFRESH_KEY(userId));

  const oauth2Keys = await redis.keys(`oauth:oauth2_session:*`);
  for (const key of oauth2Keys) {
    const sessionData = await redis.get(key);
    if (sessionData) {
      try {
        const parsed = JSON.parse(sessionData);
        if (parsed.userId === userId) {
          pipeline.del(key);
        }
      } catch {
        /* skip */
      }
    }
  }
  await pipeline.exec();

  return {
    revokedAccessTokens: allAccessTokens.length,
    revokedRefreshTokens: allRefreshTokens.length,
  };
}

async function forceLogout(req, res) {
  try {
    const { userId } = req.params;
    if (req.consoleUser && userId === req.consoleUser.sub) {
      return res.json({ code: 403, data: null, message: '不能强制下线当前登录的管理员账号' });
    }
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }

    const { revokedAccessTokens, revokedRefreshTokens } = await revokeAllUserSessions(userId);

    logger.info(
      `⚠️ 强制用户 [${user.username}] 下线，撤销 ${revokedAccessTokens} 个 AccessToken + ${revokedRefreshTokens} 个 RefreshToken`,
    );
    res.json({
      code: 0,
      message: `已强制用户 [${user.username}] 下线`,
      revokedAccessTokens,
      revokedRefreshTokens,
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getUserSessions(req, res) {
  try {
    const { userId } = req.params;
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    const allTokens = await redis.smembers(USER_SESSION_KEY(userId));
    res.json({
      code: 0,
      data: { userId, activeSessions: allTokens.length, isOnline: allTokens.length > 0 },
      message: '',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getAppLoggedInUsers(req, res) {
  try {
    const { clientId } = req.params;
    const client = await findClientById(clientId);
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }

    // 从 LoginLog 中找到该应用所有成功登录过的独立 userId
    const loggedUserIds = await LoginLog.distinct('userId', {
      clientId,
      status: 'success',
      userId: { $ne: null },
    });

    if (loggedUserIds.length === 0) {
      return res.json({ code: 0, data: [], message: '' });
    }

    // 批量检查 Redis 中哪些用户有活跃 session
    const pipeline = redis.pipeline();
    loggedUserIds.forEach((uid) => pipeline.scard(USER_SESSION_KEY(uid)));
    const results = await pipeline.exec();

    const onlineUserIds = loggedUserIds.filter((_, i) => (results[i]?.[1] || 0) > 0);

    if (onlineUserIds.length === 0) {
      return res.json({ code: 0, data: [], message: '' });
    }

    // 查询在线用户的详细信息
    const User = require('../model/user.model');
    const users = await User.find({ _id: { $in: onlineUserIds } }).lean();

    // 查询每个用户在该应用的登录次数和最后登录时间
    const loginStats = await LoginLog.aggregate([
      { $match: { clientId, status: 'success', userId: { $in: onlineUserIds } } },
      {
        $group: {
          _id: '$userId',
          loginCount: { $sum: 1 },
          lastLoginAt: { $max: '$loggedInAt' },
        },
      },
    ]);
    const statsMap = new Map(loginStats.map((s) => [s._id, s]));

    const data = users.map((user) => {
      const stats = statsMap.get(user._id.toString()) || {};
      const sessionCount = results[loggedUserIds.indexOf(user._id.toString())]?.[1] || 0;
      return {
        userId: user._id.toString(),
        username: user.username || '',
        name: user.name || '',
        phone: user.phone || '',
        email: user.email || '',
        picture: user.picture || '',
        role: user.role || 'user',
        loginCount: stats.loginCount || 0,
        lastLoginAt: stats.lastLoginAt || null,
        activeSessions: sessionCount,
      };
    });

    res.json({ code: 0, data, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function batchSessions(req, res) {
  try {
    const users = await getAllUsers();
    const pipeline = redis.pipeline();
    users.forEach((u) => pipeline.scard(USER_SESSION_KEY(u.id)));
    const results = await pipeline.exec();
    const sessionMap = {};
    users.forEach((u, i) => {
      const count = results[i]?.[1] || 0;
      sessionMap[u.id] = { activeSessions: count, isOnline: count > 0 };
    });
    res.json({ code: 0, data: sessionMap, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function lockUser(req, res) {
  try {
    if (req.consoleUser && req.params.userId === req.consoleUser.sub) {
      return res.json({ code: 403, data: null, message: '不能锁定当前登录的管理员账号' });
    }
    const updated = await updateUser(req.params.userId, { blocked: true });
    // 锁定账号同时强制下线，避免已登录用户继续操作
    const { revokedAccessTokens, revokedRefreshTokens } = await revokeAllUserSessions(
      req.params.userId,
    );
    logger.info(
      `🔒 锁定用户 [${updated.username || updated.email || updated.phone}]，同步下线（撤销 ${revokedAccessTokens} AccessToken + ${revokedRefreshTokens} RefreshToken）`,
    );
    res.json({ code: 0, data: updated, message: '账号已锁定，已强制下线该用户所有会话' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function unlockUserHandler(req, res) {
  try {
    const { user: updated, clearedRedisKeys } = await unlockUser(req.params.userId);
    logger.info(
      `🔓 一键解锁用户 [${updated.username || updated.email || updated.phone}]，同时清理 ${clearedRedisKeys} 个 redis 锁`,
    );
    res.json({
      code: 0,
      data: updated,
      message:
        clearedRedisKeys > 0 ? `账号已解锁（同步清理 ${clearedRedisKeys} 个临时锁）` : '账号已解锁',
    });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function disableUser(req, res) {
  try {
    if (req.consoleUser && req.params.userId === req.consoleUser.sub) {
      return res.json({ code: 403, data: null, message: '不能停用当前登录的管理员账号' });
    }
    const updated = await updateUser(req.params.userId, { status: 'disabled' });
    // 停用账号同时强制下线，避免已登录用户继续操作
    const { revokedAccessTokens, revokedRefreshTokens } = await revokeAllUserSessions(
      req.params.userId,
    );
    logger.info(
      `⛔ 停用用户 [${updated.username || updated.email || updated.phone}]，同步下线（撤销 ${revokedAccessTokens} AccessToken + ${revokedRefreshTokens} RefreshToken）`,
    );
    res.json({ code: 0, data: updated, message: '账号已停用，已强制下线该用户所有会话' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function enableUser(req, res) {
  try {
    const updated = await updateUser(req.params.userId, { status: 'active' });
    logger.info(`✅ 启用用户 [${updated.username || updated.email || updated.phone}]`);
    res.json({ code: 0, data: updated, message: '账号已启用' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function resetPassword(req, res) {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ code: 400, data: null, message: '密码至少 6 位' });
    }
    const updated = await updateUser(req.params.userId, { password });
    logger.info(`🔑 重置用户密码 [${updated.username || updated.email || updated.phone}]`);
    res.json({ code: 0, message: '密码重置成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function getLoginHistory(req, res) {
  try {
    const { userId } = req.params;
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const filter = { userId };
    if (req.query.keyword) {
      const regex = { $regex: req.query.keyword, $options: 'i' };
      filter.$or = [{ clientId: regex }, { ip: regex }];
    }
    const total = await LoginLog.countDocuments(filter);
    const list = await LoginLog.find(filter)
      .sort({ loggedInAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    res.json({ code: 0, data: { list, total, page, pageSize }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function getLoginApps(req, res) {
  try {
    const { userId } = req.params;
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    const clientIds = await LoginLog.distinct('clientId', { userId, status: 'success' });
    const allClients = await getAllClients();
    const clientMap = new Map(allClients.map((c) => [c.clientId, c]));
    const apps = clientIds.map((cid) => clientMap.get(cid) || null).filter(Boolean);
    res.json({ code: 0, data: apps, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

// ==================== MFA 管理 ====================

async function updateMfa(req, res) {
  try {
    const { mfaEnabled, mfaChannel } = req.body || {};
    const user = await findUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }

    if (mfaEnabled) {
      const preferChannel = mfaChannel || user.mfaChannel || 'phone';
      if (preferChannel === 'phone' && !user.phone) {
        return res.status(400).json({ code: 400, data: null, message: '请先绑定手机号再开启 MFA' });
      }
      if (preferChannel === 'email' && !user.email) {
        return res.status(400).json({ code: 400, data: null, message: '请先绑定邮箱再开启 MFA' });
      }
      if (preferChannel === 'totp') {
        const fullUser = await User.findById(req.params.userId).select('+totpSecret').lean();
        if (!fullUser?.totpSecret) {
          return res
            .status(400)
            .json({ code: 400, data: null, message: '请先绑定认证器 App（TOTP）再开启 MFA' });
        }
      }
    }

    const updates = { mfaEnabled: !!mfaEnabled };
    if (mfaChannel) {
      updates.mfaChannel = mfaChannel;
    }
    const updated = await updateUser(req.params.userId, updates);
    logger.info(
      `🔐 用户 [${user.username || user.phone}] MFA ${mfaEnabled ? '已开启' : '已关闭'}（通道: ${updated.mfaChannel}）`,
    );
    res.json({ code: 0, data: updated, message: mfaEnabled ? 'MFA 已开启' : 'MFA 已关闭' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

// ==================== 绑定/换绑手机号、邮箱 ====================

async function sendCode(req, res) {
  try {
    const { channel, target, purpose = 'bind' } = req.body || {};
    if (!channel || !target) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '缺少 channel 或 target 参数' });
    }
    const result = await sendVerifyCode(channel, target, `console-${purpose}`);
    res.json({
      code: 0,
      data: result,
      message: '验证码已发送（Demo 模式可在响应或服务端日志查看）',
    });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function bindPhoneHandler(req, res) {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) {
      return res.status(400).json({ code: 400, data: null, message: '请提供手机号和验证码' });
    }
    const ok = await verifyCode('phone', phone, code);
    if (!ok) {
      return res.status(400).json({ code: 400, data: null, message: '验证码错误或已过期' });
    }
    const updated = await bindPhone(req.params.userId, phone);
    logger.info(`📱 用户 [${updated.username || updated.email || phone}] 绑定手机号 [${phone}]`);
    res.json({ code: 0, data: updated, message: '手机号绑定成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function bindEmailHandler(req, res) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ code: 400, data: null, message: '请提供邮箱和验证码' });
    }
    const ok = await verifyCode('email', email, code);
    if (!ok) {
      return res.status(400).json({ code: 400, data: null, message: '验证码错误或已过期' });
    }
    const updated = await bindEmail(req.params.userId, email);
    logger.info(`📧 用户 [${updated.username || updated.phone || email}] 绑定邮箱 [${email}]`);
    res.json({ code: 0, data: updated, message: '邮箱绑定成功' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function unbindPhoneHandler(req, res) {
  try {
    const updated = await unbindPhone(req.params.userId);
    logger.info(`📱 用户 [${updated.username || updated.email}] 解绑手机号`);
    res.json({ code: 0, data: updated, message: '手机号已解绑' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function unbindEmailHandler(req, res) {
  try {
    const updated = await unbindEmail(req.params.userId);
    logger.info(`📧 用户 [${updated.username || updated.phone}] 解绑邮箱`);
    res.json({ code: 0, data: updated, message: '邮箱已解绑' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

// ==================== TOTP ====================

async function totpSetup(req, res) {
  try {
    const user = await findUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    const accountLabel = user.username || user.phone || user.email || `user-${user.id}`;
    const { secret, otpauthUrl, qrCodeDataUrl } = await generateTotpSecret(accountLabel);
    await savePendingTotpSecret(req.params.userId, secret);
    logger.info(`🔑 用户 [${accountLabel}] 申请绑定 TOTP，密钥已生成（5 分钟内未确认将失效）`);
    res.json({
      code: 0,
      data: { secret, otpauthUrl, qrCodeDataUrl, accountLabel },
      message: '请使用认证器 App 扫码后输入动态码确认绑定',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function totpConfirm(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '请输入认证器 App 显示的 6 位动态码' });
    }
    const pendingSecret = await getPendingTotpSecret(req.params.userId);
    if (!pendingSecret) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '绑定流程已超时，请重新生成二维码' });
    }
    if (!verifyTotpToken(pendingSecret, token)) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '动态码错误，请确认认证器 App 时间是否准确' });
    }
    await User.findByIdAndUpdate(req.params.userId, { totpSecret: pendingSecret });
    await clearPendingTotpSecret(req.params.userId);
    const updated = await findUserById(req.params.userId);
    logger.info(`✅ 用户 [${updated.username || updated.phone}] TOTP 绑定成功`);
    res.json({
      code: 0,
      data: updated,
      message: 'TOTP 已绑定，可以在 MFA 通道中选择「认证器 App」',
    });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

async function totpUnbind(req, res) {
  try {
    const fullUser = await User.findById(req.params.userId).select('+totpSecret').lean();
    if (!fullUser) {
      return res.status(404).json({ code: 404, data: null, message: '用户不存在' });
    }
    if (!fullUser.totpSecret) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: '当前用户未绑定 TOTP，无需解绑' });
    }

    const updates = { totpSecret: '' };
    if (fullUser.mfaChannel === 'totp') {
      if (fullUser.phone) {
        updates.mfaChannel = 'phone';
      } else if (fullUser.email) {
        updates.mfaChannel = 'email';
      } else {
        updates.mfaEnabled = false;
      }
    }
    await User.findByIdAndUpdate(req.params.userId, updates);
    await clearPendingTotpSecret(req.params.userId);
    const updated = await findUserById(req.params.userId);
    logger.info(
      `🗑️ 用户 [${updated.username || updated.phone}] 解绑 TOTP（回退通道: ${updated.mfaChannel}, MFA: ${updated.mfaEnabled ? '保持' : '已关闭'}）`,
    );
    res.json({ code: 0, data: updated, message: 'TOTP 已解绑' });
  } catch (error) {
    res.status(400).json({ code: 400, data: null, message: error.message });
  }
}

// ==================== 系统配置 ====================

async function getSystemConfigHandler(req, res) {
  try {
    const config = await getSystemConfig();
    res.json({ code: 0, data: config, message: '' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
}

async function updateSystemConfigHandler(req, res) {
  try {
    const updated = await updateSystemConfig(req.body || {});
    const rateLimitChanged =
      req.body?.rateLimitEnabled !== undefined ||
      req.body?.loginRateLimit !== undefined ||
      req.body?.generalRateLimit !== undefined;
    if (rateLimitChanged) {
      invalidateRateLimitCache();
      logger.info(
        `🚦 [SystemConfig] 限流配置已更新：enabled=${updated.rateLimitEnabled}, login=${updated.loginRateLimit?.max}/${updated.loginRateLimit?.windowMs}ms, general=${updated.generalRateLimit?.max}/${updated.generalRateLimit?.windowMs}ms`,
      );
    }
    res.json({ code: 0, data: updated, message: '' });
  } catch (err) {
    res.status(400).json({ code: 400, data: null, message: err.message });
  }
}

// ==================== 批量导入导出 ====================

async function sendCreateCode(req, res) {
  try {
    const { channel, target } = req.body;
    if (!channel || !target) {
      return res.status(400).json({ code: 400, data: null, message: '缺少 channel 或 target' });
    }
    const result = await sendVerifyCode(channel, target, 'create-user');
    res.json({ code: 0, data: result, message: '' });
  } catch (err) {
    res.status(429).json({ code: 429, data: null, message: err.message });
  }
}

/**
 * 下载用户导入模板（XLSX 格式）
 * 字段：手机号、邮箱、姓名
 */
function downloadImportTemplate(req, res) {
  const headers = ['用户名（必填）', '手机号', '邮箱', '姓名'];
  const exampleRow = ['zhangsan', '13800138000', 'zhangsan@company.com', '张三'];
  const worksheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  worksheet['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '用户导入模板');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="user-import-template.xlsx"');
  res.send(buffer);
}

async function importUsers(req, res) {
  try {
    const { users } = req.body;
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请提供用户列表' });
    }
    if (users.length > 500) {
      return res.status(400).json({ code: 400, data: null, message: '单次导入上限 500 条' });
    }

    const PHONE_REGEX = /^1[3-9]\d{9}$/;
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // 生成默认密码
    const generateDefaultPassword = (phone, email) => {
      if (phone) {
        return `${phone.slice(-4)}abc`;
      }
      if (email) {
        return `${email.split('@')[0].slice(-4)}abc`;
      }
      return '123456abc';
    };

    const results = { success: 0, failed: 0, errors: [] };
    for (const userData of users) {
      try {
        if (!userData.username) {
          results.failed += 1;
          results.errors.push({ row: userData, reason: '用户名为必填项' });
          continue;
        }
        if (!userData.phone && !userData.email) {
          results.failed += 1;
          results.errors.push({ row: userData, reason: '手机号和邮箱至少填一项' });
          continue;
        }
        if (userData.phone && !PHONE_REGEX.test(userData.phone)) {
          results.failed += 1;
          results.errors.push({ row: userData, reason: `手机号格式不合法: ${userData.phone}` });
          continue;
        }
        if (userData.email && !EMAIL_REGEX.test(userData.email)) {
          results.failed += 1;
          results.errors.push({ row: userData, reason: `邮箱格式不合法: ${userData.email}` });
          continue;
        }

        const finalData = {
          ...userData,
          password: generateDefaultPassword(userData.phone, userData.email),
          registerSource: 'import',
        };
        await createUser(finalData);
        results.success += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ row: userData, reason: err.message });
      }
    }
    logger.info(`📥 批量导入完成：成功 ${results.success}，失败 ${results.failed}`);
    res.json({ code: 0, data: results, message: `成功导入 ${results.success} 个用户` });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
}

async function exportUsers(req, res) {
  try {
    const users = await getAllUsers();
    const headers = [
      'ID',
      '用户名',
      '姓名',
      '邮箱',
      '手机号',
      '角色',
      '状态',
      '注册来源',
      '登录次数',
      '创建时间',
      '最后登录时间',
    ];
    const formatDateTime = (d) => {
      if (!d) {
        return '';
      }
      const dt = new Date(d);
      const pad = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    };
    const dataRows = users.map((user) => [
      user.id,
      user.username || '',
      user.name || '',
      user.email || '',
      user.phone || '',
      user.role || 'user',
      user.status || 'active',
      user.registerSource || '',
      user.loginsCount || 0,
      formatDateTime(user.createdAt),
      formatDateTime(user.lastLogin),
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    worksheet['!cols'] = [
      { wch: 26 },
      { wch: 14 },
      { wch: 14 },
      { wch: 24 },
      { wch: 14 },
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 8 },
      { wch: 22 },
      { wch: 22 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '用户列表');
    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=users_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    res.send(xlsxBuffer);
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
}

// ==================== 应用访问控制列表 ====================

async function getAppAccessControlList(req, res) {
  try {
    const client = await findClientById(req.params.clientId);
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }
    const { targetType } = req.query;
    let list = client.accessPolicy?.accessControlList || [];
    if (targetType && targetType !== 'all') {
      list = list.filter((item) => item.targetType === targetType);
    }
    const defaultPermission = client.accessPolicy?.defaultPermission || 'allow';
    res.json({ code: 0, data: { defaultPermission, list }, message: '' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function addAppAccessControlItem(req, res) {
  try {
    const { targetType, targetId, targetName, effect = 'allow' } = req.body;
    if (!targetType || !targetId) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'targetType 和 targetId 为必填项' });
    }
    const Client = require('../model/client.model');
    const client = await Client.findOne({ clientId: req.params.clientId });
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }
    if (!client.accessPolicy) {
      client.accessPolicy = {};
    }
    if (!client.accessPolicy.accessControlList) {
      client.accessPolicy.accessControlList = [];
    }
    // 去重检查
    const exists = client.accessPolicy.accessControlList.find(
      (item) => item.targetType === targetType && item.targetId === targetId,
    );
    if (exists) {
      return res.status(400).json({ code: 400, data: null, message: '该授权对象已存在' });
    }
    client.accessPolicy.accessControlList.push({
      targetType,
      targetId,
      targetName: targetName || '',
      effect,
      enabled: true,
      createdAt: new Date(),
    });
    await client.save();
    logger.info(`✅ 应用 [${client.name}] 添加访问授权: ${targetType}/${targetId}`);
    res.json({ code: 0, data: client.accessPolicy.accessControlList, message: '添加成功' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function updateAppAccessControlItem(req, res) {
  try {
    const { itemId } = req.params;
    const { effect, enabled } = req.body;
    const Client = require('../model/client.model');
    const client = await Client.findOne({ clientId: req.params.clientId });
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }
    const item = (client.accessPolicy?.accessControlList || []).find(
      (entry) => entry._id.toString() === itemId,
    );
    if (!item) {
      return res.status(404).json({ code: 404, data: null, message: '授权项不存在' });
    }
    if (effect !== undefined) {
      item.effect = effect;
    }
    if (enabled !== undefined) {
      item.enabled = enabled;
    }
    await client.save();
    res.json({ code: 0, data: item, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function deleteAppAccessControlItem(req, res) {
  try {
    const { itemId } = req.params;
    const Client = require('../model/client.model');
    const client = await Client.findOne({ clientId: req.params.clientId });
    if (!client) {
      return res.status(404).json({ code: 404, data: null, message: '应用不存在' });
    }
    const list = client.accessPolicy?.accessControlList || [];
    const index = list.findIndex((entry) => entry._id.toString() === itemId);
    if (index === -1) {
      return res.status(404).json({ code: 404, data: null, message: '授权项不存在' });
    }
    list.splice(index, 1);
    await client.save();
    logger.info(`🗑️ 应用 [${client.name}] 删除访问授权项 [${itemId}]`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

async function updateAppDefaultPermission(req, res) {
  try {
    const { defaultPermission } = req.body;
    if (!['allow', 'deny'].includes(defaultPermission)) {
      return res
        .status(400)
        .json({ code: 400, data: null, message: 'defaultPermission 必须为 allow 或 deny' });
    }
    const updated = await updateClient(req.params.clientId, {
      accessPolicy: {
        ...((await findClientById(req.params.clientId))?.accessPolicy || {}),
        defaultPermission,
      },
    });
    res.json({
      code: 0,
      data: { defaultPermission: updated.accessPolicy?.defaultPermission },
      message: '默认权限已更新',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: error.message });
  }
}

module.exports = {
  adminLogin,
  getOAuth2Config,
  oauth2Login,
  oauth2Exchange,
  getAdminMe,
  getOverview,
  getOAuth2Apps,
  listApps,
  getApp,
  refreshSecret,
  createApp,
  updateApp,
  deleteApp,
  getAppSummary,
  getAppLoggedInUsers,
  getLoginTrend,
  getLoginLogs,
  exportLoginLogs,
  getLoginGeo,
  unlockAppUser,
  listUsers,
  getUser,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
  forceLogout,
  getUserSessions,
  batchSessions,
  lockUser,
  unlockUserHandler,
  disableUser,
  enableUser,
  resetPassword,
  getLoginHistory,
  getLoginApps,
  updateMfa,
  sendCode,
  bindPhoneHandler,
  bindEmailHandler,
  unbindPhoneHandler,
  unbindEmailHandler,
  totpSetup,
  totpConfirm,
  totpUnbind,
  getSystemConfigHandler,
  updateSystemConfigHandler,
  sendCreateCode,
  downloadImportTemplate,
  importUsers,
  exportUsers,
  getAppAccessControlList,
  addAppAccessControlItem,
  updateAppAccessControlItem,
  deleteAppAccessControlItem,
  updateAppDefaultPermission,
};
