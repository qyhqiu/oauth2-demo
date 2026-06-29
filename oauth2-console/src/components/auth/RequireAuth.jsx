import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { isLoggedIn, clearAuth, saveAuth, getCachedUser } from '../../utils/auth';
import { getCurrentAdmin } from '../../api';

/**
 * 路由守卫：未登录跳转到登录页，并把当前路径透传到 ?from=
 *
 * 流程：
 * 1. 本地无 token → 直接跳 /login
 * 2. 本地有 token → 尝试 /admin/me 验证（防止 token 过期/被禁用）
 *    - 通过：渲染子路由，并刷新 user 缓存
 *    - 失败：axios 拦截器已自动跳转 /login，这里只显示 loading
 */
export default function RequireAuth({ children }) {
  const location = useLocation();
  const [verifying, setVerifying] = useState(() => isLoggedIn() && !getCachedUser());

  useEffect(() => {
    if (!isLoggedIn()) return;
    // 已有缓存 user → 直接渲染（异步在后台验证 token 是否还有效）
    const hasCache = Boolean(getCachedUser());
    if (!hasCache) setVerifying(true);

    getCurrentAdmin()
      .then((resp) => {
        // 刷新 user 缓存
        const token = localStorage.getItem('oauth2_console_token');
        if (token) saveAuth(token, resp.data);
      })
      .catch(() => {
        // axios 拦截器已处理 401/403 跳转，这里清理本地缓存即可
        clearAuth();
      })
      .finally(() => setVerifying(false));
  }, []);

  if (!isLoggedIn()) {
    // 把目标路径透传给登录页，登录成功后回跳
    const from = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?from=${from}`} replace />;
  }

  if (verifying) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <Spin size="large" tip="正在验证登录态..." />
      </div>
    );
  }

  return children;
}
