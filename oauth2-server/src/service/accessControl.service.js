/**
 * 访问控制 Service — 公共的访问控制判断逻辑
 *
 * 校验优先级（从高到低）：分组(group) > 角色(role) > 用户(user) > defaultPermission
 * 同一优先级内，只要有一条 enabled 规则命中且 effect=allow 即放行；
 * 高优先级的 allow 可覆盖低优先级的 deny / disabled。
 *
 * 返回结果只告知调用方"当前用户能否登录"，统一拒绝提示。
 */
const Group = require('../model/group.model');

const ACCESS_DENIED_REASON = '您的账号无权访问该应用，请联系管理员授权';

/**
 * @param {Object} accessPolicy - client.accessPolicy
 * @param {Object} user - 当前用户对象
 * @returns {Promise<{ allowed: boolean, reason: string }>}
 */
async function checkAccessControl(accessPolicy, user) {
  const defaultPermission = accessPolicy.defaultPermission || 'allow';
  const allRules = accessPolicy.accessControlList || [];
  const userId = user.id || user._id?.toString();

  const groupRules = allRules.filter((r) => r.targetType === 'group');
  const roleRules = allRules.filter((r) => r.targetType === 'role');
  const userRules = allRules.filter((r) => r.targetType === 'user');

  // ---------- 1. 分组规则（最高优先级） ----------
  if (groupRules.length > 0) {
    const memberGroups = await Group.find({ members: userId }).select('_id').lean();
    const memberGroupIds = memberGroups.map((g) => g._id.toString());

    for (const rule of groupRules) {
      if (!memberGroupIds.includes(rule.targetId)) {
        continue;
      }
      if (!rule.enabled) {
        continue;
      }
      if (rule.effect === 'deny') {
        return { allowed: false, reason: ACCESS_DENIED_REASON };
      }
      return { allowed: true, reason: '' };
    }
  }

  // ---------- 2. 角色规则 ----------
  for (const rule of roleRules) {
    if (rule.targetId !== user.role) {
      continue;
    }
    if (!rule.enabled) {
      continue;
    }
    if (rule.effect === 'deny') {
      return { allowed: false, reason: ACCESS_DENIED_REASON };
    }
    return { allowed: true, reason: '' };
  }

  // ---------- 3. 用户规则（最低优先级） ----------
  for (const rule of userRules) {
    if (rule.targetId !== userId) {
      continue;
    }
    if (!rule.enabled) {
      continue;
    }
    if (rule.effect === 'deny') {
      return { allowed: false, reason: ACCESS_DENIED_REASON };
    }
    return { allowed: true, reason: '' };
  }

  // ---------- 4. 兜底 defaultPermission ----------
  // 规则停用视为不生效，直接走 defaultPermission
  if (defaultPermission === 'deny') {
    return { allowed: false, reason: ACCESS_DENIED_REASON };
  }
  return { allowed: true, reason: '' };
}

module.exports = { checkAccessControl };
