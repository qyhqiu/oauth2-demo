import { useState, useEffect } from 'react';

const ERROR_FRIENDLY_MAP = {
  too_many_requests: '请求过于频繁，请稍后再试',
  invalid_client: '应用未注册或回调地址非法',
  unauthorized_client: '客户端身份校验失败',
  access_denied: '应用已被禁用或当前账号无权访问',
};

const ERROR_TITLE_MAP = {
  too_many_requests: '请求过于频繁',
  invalid_client: '应用未注册',
  unauthorized_client: '客户端身份校验失败',
  access_denied: '访问被拒绝',
};

/**
 * 解析 URL 中服务端 302 回来携带的 error 参数，
 * 转为持久化 state（Alert 横幅），mount 后立即清掉 URL 中的 error 参数。
 *
 * @param {import('antd/es/message').MessageInstance} messageApi
 * @returns {[object|null, function]}
 */
export default function useErrorBanner(messageApi) {
  const [errorBanner, setErrorBanner] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('error') || '';
    if (!code) return null;
    const description =
      urlParams.get('error_description') || ERROR_FRIENDLY_MAP[code] || '登录授权失败，请重试';
    const title = ERROR_TITLE_MAP[code] || '登录授权失败';
    return { code, title, description };
  });

  useEffect(() => {
    if (!errorBanner) return;
    messageApi.error({ content: errorBanner.description, duration: 4 });

    // 清掉 error 相关参数，避免分享 / 刷新重弹
    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete('error');
    cleanParams.delete('error_description');
    const cleanQuery = cleanParams.toString();
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (cleanQuery ? `?${cleanQuery}` : ''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [errorBanner, setErrorBanner];
}
