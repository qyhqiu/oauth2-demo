/**
 * Branding API
 * 拉取应用的品牌化配置（Logo、主题色、欢迎语等）
 * 由 oauth2-server 的 GET /api/public/clients/:clientId/branding 提供，无需登录态
 */
const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

/**
 * 获取应用品牌化配置
 * @param {string} clientId
 * @returns {Promise<{clientId,name,description,logoUrl,primaryColor,welcomeText,copyright,allowRegister} | null>}
 */
export async function fetchBranding(clientId) {
  if (!clientId) return null;
  try {
    const resp = await fetch(
      `${OAUTH2_SERVER}/v1/api/public/clients/${encodeURIComponent(clientId)}/branding`,
      {
        method: 'GET',
        credentials: 'omit',
      },
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.data || null;
  } catch (err) {
    console.warn('[branding] fetch failed:', err);
    return null;
  }
}
