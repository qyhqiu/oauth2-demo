/**
 * 自助注册 API
 *
 * 调用 oauth2-server 的 POST /oauth/register（registerSource='self-register'）
 * 后端会自动校验：
 *   ① 全局「禁止注册」开关（registrationEnabled）
 *   ② 注册白名单（whitelistEnabled + Whitelist 表 — 支持 username/phone/email + 邮箱域名后缀匹配）
 *   ③ username/phone/email 唯一性
 *   ④ 参数格式（手机号 / 邮箱 / 密码长度 6-64 / 用户名 3-32）
 *   ⑤ IP 限流（5 次/15min/IP）
 *
 * 不依赖 axios（与 branding.js 保持一致），fetch 即可
 */
const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

/**
 * 自助注册
 * @param {object} payload
 * @param {string} [payload.username] 用户名（可选，但 username/phone/email 至少填一项）
 * @param {string} [payload.phone] 手机号
 * @param {string} [payload.email] 邮箱
 * @param {string} payload.password 密码（6-64 位）
 * @param {string} [payload.name] 显示姓名（缺省时按 username/phone/email 自动生成）
 * @returns {Promise<{ok:true, data:{id,username,phone,email,name}} | {ok:false, error:string, error_description:string}>}
 */
export async function selfRegister(payload) {
  try {
    const resp = await fetch(`${OAUTH2_SERVER}/v1/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        ok: false,
        error: json?.error || 'register_failed',
        error_description: json?.error_description || '注册失败',
      };
    }
    return { ok: true, data: json?.data };
  } catch (err) {
    return {
      ok: false,
      error: 'network_error',
      error_description: err?.message || '网络异常，请稍后重试',
    };
  }
}
