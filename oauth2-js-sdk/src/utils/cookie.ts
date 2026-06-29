/**
 * Cookie 工具函数（基于 js-cookie 封装）
 *
 * 安全说明：
 * - 使用 js-cookie 替代手写 document.cookie，避免手动拼接带来的编码错误和注入风险
 * - SameSite=Lax：防止 CSRF 跨站请求伪造攻击
 * - 前端 JS 无法设置 httpOnly（该属性只能由服务端 Set-Cookie 响应头设置）
 * - XSS 防护的根本手段是服务端设置 Content-Security-Policy 响应头，而非前端 Cookie 属性
 */
import Cookies from 'js-cookie';

// js-cookie 全局默认配置：所有 Cookie 均使用 SameSite=Lax，防止 CSRF
const COOKIE_DEFAULTS: Cookies.CookieAttributes = {
  path: '/',
  sameSite: 'Lax',
};

/** 写入 Cookie */
export function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  Cookies.set(name, value, {
    ...COOKIE_DEFAULTS,
    expires: maxAgeSeconds / 86400, // js-cookie 使用天数，转换秒为天
  });
}

/** 读取 Cookie */
export function getCookie(name: string): string | undefined {
  return Cookies.get(name);
}

/** 删除 Cookie */
export function deleteCookie(name: string): void {
  Cookies.remove(name, COOKIE_DEFAULTS);
}
