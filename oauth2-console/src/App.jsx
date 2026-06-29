import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import ConsoleLayout from './components/layout/ConsoleLayout';
import RequireAuth from './components/auth/RequireAuth';

// 路由级懒加载：每个页面拆成独立 chunk，按需加载
// 首页/列表是首屏高频页，详情/创建/教程类是次级页面
const ConsoleLoginPage = lazy(() => import('./pages/login/ConsoleLoginPage'));
const OAuth2CallbackPage = lazy(() => import('./pages/login/OAuth2CallbackPage'));
const HomePage = lazy(() => import('./pages/home/HomePage'));
const AppsPage = lazy(() => import('./pages/apps/AppsPage'));
const AppDetailPage = lazy(() => import('./pages/apps/AppDetailPage'));
const UsersPage = lazy(() => import('./pages/users/UsersPage'));
const UserDetailPage = lazy(() => import('./pages/users/UserDetailPage'));
const OrgsPage = lazy(() => import('./pages/users/OrgsPage'));
const GroupsPage = lazy(() => import('./pages/users/GroupsPage'));
const GroupDetailPage = lazy(() => import('./pages/users/GroupDetailPage'));
const WhitelistPage = lazy(() => import('./pages/users/WhitelistPage'));
const PlaceholderPage = lazy(() => import('./pages/placeholder/PlaceholderPage'));
// K5：安全设置 - 基础设置（含基础/登录/注册 3 Tab）
const BasicSettingsPage = lazy(() => import('./pages/security/BasicSettingsPage'));
// 连接身份源
const SocialConnectionsPage = lazy(() => import('./pages/connections/SocialConnectionsPage'));
const SelectConnectionTypePage = lazy(() => import('./pages/connections/SelectConnectionTypePage'));
const SocialConnectionEditPage = lazy(() => import('./pages/connections/SocialConnectionEditPage'));

function PageLoading() {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}
    >
      <Spin size="large" />
    </div>
  );
}

/**
 * 业务路由（带 ConsoleLayout + 鉴权守卫）
 */
function ProtectedRoutes() {
  return (
    <RequireAuth>
      <ConsoleLayout>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/overview" element={<Navigate to="/home" replace />} />

            <Route path="/home" element={<HomePage />} />

            {/* 应用相关：列表 → 详情（创建已改为 Drawer 抽屉，不再走独立页面） */}
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/apps/oauth2" element={<AppsPage />} />
            <Route path="/apps/:clientId" element={<AppDetailPage />} />

            {/* 用户管理：列表 → 详情 + 子菜单占位 */}
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/orgs" element={<OrgsPage />} />
            <Route path="/users/groups" element={<GroupsPage />} />
            <Route path="/users/groups/:groupId" element={<GroupDetailPage />} />
            <Route path="/users/whitelist" element={<WhitelistPage />} />
            <Route path="/users/:userId" element={<UserDetailPage />} />

            <Route
              path="/permissions"
              element={
                <PlaceholderPage
                  title="权限管理"
                  description="基于角色（RBAC）的权限控制功能正在建设中，敬请期待。"
                />
              }
            />
            {/* 连接身份源 */}
            <Route path="/connections/social" element={<SocialConnectionsPage />} />
            <Route path="/connections/social/select" element={<SelectConnectionTypePage />} />
            <Route path="/connections/social/create" element={<SocialConnectionEditPage />} />
            <Route
              path="/connections/social/:connectionId/edit"
              element={<SocialConnectionEditPage />}
            />

            {/* K5：安全设置 → 默认重定向到「基础设置」（含基础 / 登录 / 注册 3 Tab） */}
            <Route path="/security" element={<Navigate to="/security/basic" replace />} />
            <Route path="/security/basic" element={<BasicSettingsPage />} />
          </Routes>
        </Suspense>
      </ConsoleLayout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* 登录相关页面：不走 ConsoleLayout，不走守卫 */}
        <Route path="/login" element={<ConsoleLoginPage />} />
        <Route path="/oauth2-callback" element={<OAuth2CallbackPage />} />
        {/* 其余路由都进入受保护的业务区 */}
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
}
