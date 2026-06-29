import React, { useState, useEffect } from 'react';
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Space,
  Typography,
  Modal,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Button,
} from 'antd';
import {
  AppstoreOutlined,
  UserOutlined,
  HomeOutlined,
  SettingOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyOutlined,
  ApiOutlined,
  BookOutlined,
  CustomerServiceOutlined,
  CompassOutlined,
  SwapOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRequest } from 'ahooks';
import { getCachedUser, clearAuth } from '../../utils/auth';
import {
  oauth2GlobalLogout,
  getOAuth2Apps,
  trackOAuth2Session,
  OAUTH2_LOGOUT_CHANNEL_NAME,
  OAUTH2_LOGOUT_STORAGE_KEY,
} from '../../api';
import './ConsoleLayout.scss';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

// 主菜单（参考 Authing 控制台分组结构）
const menuItems = [
  { key: '/home', icon: <HomeOutlined />, label: '首页' },
  {
    key: 'apps-group',
    icon: <AppstoreOutlined />,
    label: '应用',
    children: [{ key: '/apps', label: '自建应用' }],
  },
  {
    key: 'users-group',
    icon: <UserOutlined />,
    label: '用户管理',
    children: [
      { key: '/users', label: '用户列表' },
      { key: '/users/orgs', label: '组织架构' },
      { key: '/users/groups', label: '分组管理' },
      { key: '/users/whitelist', label: '注册白名单' },
    ],
  },
  {
    key: 'connections-group',
    icon: <ApiOutlined />,
    label: '连接身份源',
    children: [{ key: '/connections/social', label: '社会化身份源' }],
  },
  { key: '/permissions', icon: <SafetyOutlined />, label: '权限管理' },
  {
    key: 'security-group',
    icon: <SettingOutlined />,
    label: '安全设置',
    children: [{ key: '/security/basic', label: '基础设置' }],
  },
];

// 根据 pathname 计算默认展开 / 选中的菜单项
function resolveMenuKeys(pathname) {
  // 创建页 / 详情页都属于"自建应用"
  if (pathname.startsWith('/apps')) {
    return { selected: ['/apps'], openKeys: ['apps-group'] };
  }
  // 用户管理子路由
  if (pathname.startsWith('/users')) {
    if (pathname === '/users/orgs') return { selected: ['/users/orgs'], openKeys: ['users-group'] };
    if (pathname === '/users/groups')
      return { selected: ['/users/groups'], openKeys: ['users-group'] };
    if (pathname === '/users/whitelist')
      return { selected: ['/users/whitelist'], openKeys: ['users-group'] };
    return { selected: ['/users'], openKeys: ['users-group'] };
  }
  // 连接身份源子菜单
  if (pathname.startsWith('/connections')) {
    if (pathname === '/connections/social')
      return { selected: ['/connections/social'], openKeys: ['connections-group'] };
    return { selected: ['/connections/social'], openKeys: ['connections-group'] };
  }
  // K5：安全设置子菜单（基础设置 → 包含基础/登录/注册三 Tab）
  if (pathname.startsWith('/security')) {
    if (pathname.startsWith('/security/basic')) {
      return { selected: ['/security/basic'], openKeys: ['security-group'] };
    }
    return { selected: ['/security/basic'], openKeys: ['security-group'] };
  }
  return { selected: [pathname], openKeys: [] };
}

export default function ConsoleLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { selected, openKeys } = resolveMenuKeys(location.pathname);
  const currentUser = getCachedUser();

  // 用户菜单点击处理：登出 / 账户设置
  const handleUserMenuClick = ({ key }) => {
    if (key === 'logout') {
      Modal.confirm({
        title: '确认退出登录？',
        content: '退出后将同步注销所有已登录的业务应用（单点登出）',
        okText: '退出',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          // 单点登出：先调用 oauth2-server 全局登出端点（撤销该管理员在所有业务应用的 access_token
          // + 清掉 OAuth2 Session Cookie），再清本地登录态。即便后端不可达也继续清本地，避免卡住。
          await oauth2GlobalLogout();
          clearAuth();
          navigate('/login', { replace: true });
        },
      });
    } else if (key === 'settings') {
      navigate(currentUser?.id ? `/users/${currentUser.id}` : '/users');
    }
  };

  // 应用切换器：拉取已注册业务应用清单
  // useRequest 自带缓存（cacheKey），避免每次切页都重新请求
  const { data: oauth2AppsResp, loading: oauth2AppsLoading } = useRequest(getOAuth2Apps, {
    cacheKey: 'console-oauth2-apps',
    staleTime: 5 * 60 * 1000, // 5 分钟内复用缓存
  });
  const oauth2Apps = oauth2AppsResp?.data || [];

  // 跟踪 OAuth2 登录态：用于在应用切换器上显示「跳转免密」badge + 头部 OAuth2 用户卡片
  // 设计：仅在 Dropdown 第一次打开时才发起请求（manual:true + 受 dropdownOpen 触发），避免首屏多余请求
  // 失败兜底为 { session: null }，UI 一律按「未登录」处理（badge 灰色 + tooltip 解释）
  const [appSwitcherOpen, setAppSwitcherOpen] = useState(false);
  const {
    data: oauth2SessionResp,
    loading: oauth2SessionLoading,
    run: refreshOAuth2Session,
    mutate: mutateOAuth2Session,
  } = useRequest(trackOAuth2Session, {
    manual: true,
    cacheKey: 'console-oauth2-session',
    staleTime: 60 * 1000,
  });
  const isOAuth2LoggedIn = !!oauth2SessionResp?.session;
  const oauth2User = oauth2SessionResp?.userInfo || null;

  const handleAppSwitcherOpenChange = (open) => {
    setAppSwitcherOpen(open);
    // 每次打开都刷一下（受 staleTime 限制 1 分钟内复用缓存，不会真正发请求）
    if (open) refreshOAuth2Session();
  };

  // 「切换账号」：从应用切换器或登录页发起，立即清掉 OAuth2 Cookie + 当前控制台登录态，回到登录页
  const handleSwitchAccount = async () => {
    // 立即把本地 oauth2Session 标记为登出，UI 即时反映（即使后续请求慢也不卡顿）
    mutateOAuth2Session({ session: null });
    await oauth2GlobalLogout();
    clearAuth();
    navigate('/login', { replace: true });
  };

  // B+：响应式 badge —— 订阅 oauth2-logout 事件，登出后立即把 badge 变灰
  // 触发场景：① 当前页面调 oauth2GlobalLogout / clearAuth ② 同源其它 Tab 退出登录 ③ SDK 内部心跳检测到 token 过期主动广播
  useEffect(() => {
    const handleLogoutSignal = (reason) => {
      console.log(`[ConsoleLayout] 收到 oauth2-logout 信号 (${reason})，刷新 badge 状态`);
      // 立即把 cache 改为未登录态，badge 同步变灰；不需要再发 trackSession 请求
      mutateOAuth2Session({ session: null });
    };

    // 主通道：BroadcastChannel
    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(OAUTH2_LOGOUT_CHANNEL_NAME);
      channel.onmessage = (event) => handleLogoutSignal(event?.data?.reason || 'broadcast');
    }

    // 兜底通道：localStorage storage 事件（仅其它 Tab 触发，同 Tab 不触发）
    const handleStorage = (event) => {
      if (event.key === OAUTH2_LOGOUT_STORAGE_KEY && event.newValue) {
        handleLogoutSignal('storage');
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      if (channel) channel.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [mutateOAuth2Session]);

  // 一键跳转业务应用：浏览器原生导航到 origin
  // 业务应用首屏 SDK 会触发 OAuth2 授权，oauth2-server 通过浏览器携带的 OAuth2 Cookie 完成免登录授权
  const handleSwitchApp = (origin) => {
    if (!origin) return;
    window.open(origin, '_blank', 'noopener,noreferrer');
  };

  // 应用切换器下拉菜单（用 dropdownRender 自定义内容，比 menu items 表现力更强）
  // 头部显示 OAuth2 登录态摘要：让管理员清楚跳转过去会不会被弹登录页
  const appSwitcherDropdownRender = () => (
    <div className="app-switcher__panel">
      <div className="app-switcher__header">
        <div className="app-switcher__header-row">
          <Text strong>应用切换器</Text>
          {oauth2SessionLoading ? (
            <Tag className="app-switcher__oauth2-tag" icon={<Spin size="small" />}>
              检测中
            </Tag>
          ) : isOAuth2LoggedIn ? (
            <Tooltip
              title={`OAuth2 Session 有效，跳转目标应用无需重新登录（user: ${oauth2User?.username || ''}）`}
            >
              <Tag color="green" className="app-switcher__oauth2-tag">
                OAuth2 已登录
              </Tag>
            </Tooltip>
          ) : (
            <Tooltip title="未检测到 OAuth2 Cookie（可能是首次访问、第三方 Cookie 被拦截或登录已过期）。跳转后需要重新登录。">
              <Tag className="app-switcher__oauth2-tag">OAuth2 未登录</Tag>
            </Tooltip>
          )}
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          从控制台一键进入任意业务应用
        </Text>

        {/* A+：OAuth2 用户卡片 —— 已登录时展示头像 + 用户名 + 「切换账号」 */}
        {isOAuth2LoggedIn && oauth2User && (
          <div className="app-switcher__oauth2-user">
            <Avatar size={36} style={{ backgroundColor: '#5b50e8' }} icon={<UserOutlined />} />
            <div className="app-switcher__oauth2-user-meta">
              <div className="app-switcher__oauth2-user-name">
                <Text strong>{oauth2User.name || oauth2User.username}</Text>
                {oauth2User.role && (
                  <Tag color="purple" style={{ marginLeft: 6, fontSize: 11, lineHeight: '16px' }}>
                    {oauth2User.role}
                  </Tag>
                )}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                @{oauth2User.username}
                {oauth2User.email ? ` · ${oauth2User.email}` : ''}
              </Text>
            </div>
            <Button
              type="link"
              size="small"
              icon={<SwapOutlined />}
              onClick={handleSwitchAccount}
              className="app-switcher__oauth2-switch-btn"
            >
              切换账号
            </Button>
          </div>
        )}
      </div>
      <div className="app-switcher__list">
        {oauth2AppsLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : oauth2Apps.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无可跳转的应用"
            style={{ padding: 16 }}
          />
        ) : (
          oauth2Apps.map((app) => (
            <div
              key={app.clientId}
              className="app-switcher__item"
              onClick={() => handleSwitchApp(app.postLoginRedirectUri || app.origin)}
            >
              <div
                className="app-switcher__icon"
                style={app.themeColor ? { background: app.themeColor } : undefined}
              >
                {app.logo ? <img src={app.logo} alt={app.name} /> : <AppstoreOutlined />}
              </div>
              <div className="app-switcher__meta">
                <div className="app-switcher__name">
                  <Text strong>{app.name}</Text>
                  <ExportOutlined style={{ fontSize: 11, color: '#bfbfbf', marginLeft: 6 }} />
                </div>
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                  {app.description || app.origin}
                </Text>
              </div>
              {/* 登录态 badge：绿点 = OAuth2 已登录跳转免密；灰点 = 跳转后需要登录 */}
              <Tooltip
                title={
                  isOAuth2LoggedIn
                    ? '跳转后无需重新登录（OAuth2 免密）'
                    : '跳转后需要输入用户名密码'
                }
                placement="left"
              >
                <span
                  className={`app-switcher__badge ${isOAuth2LoggedIn ? 'app-switcher__badge--on' : 'app-switcher__badge--off'}`}
                  aria-label={isOAuth2LoggedIn ? 'OAuth2 已登录' : 'OAuth2 未登录'}
                />
              </Tooltip>
            </div>
          ))
        )}
      </div>
      <div className="app-switcher__footer">
        {isOAuth2LoggedIn ? (
          <>
            <Tag color="green" style={{ margin: 0 }}>
              OAuth2 免登录
            </Tag>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              点击应用直接进入，无需重新登录
            </Text>
          </>
        ) : (
          <>
            <Tag style={{ margin: 0 }}>需要登录</Tag>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              首次跳转会要求输入账号密码
            </Text>
          </>
        )}
      </div>
    </div>
  );

  const adminMenuItems = [
    {
      key: 'profile-info',
      label: (
        <div style={{ minWidth: 160 }}>
          <div style={{ fontWeight: 600 }}>{currentUser?.name || '管理员'}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
            @{currentUser?.username || 'admin'} · {currentUser?.role || 'admin'}
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    { key: 'settings', icon: <SettingOutlined />, label: '账户设置' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  return (
    <Layout className="console-layout">
      <Sider className="console-sider" width={220} theme="light">
        <div className="console-brand">
          <div className="console-brand__icon">
            <LockOutlined />
          </div>
          <div className="console-brand__text">
            <div className="console-brand__name">OAuth2 控制台</div>
            <div className="console-brand__sub">示例用户池</div>
          </div>
        </div>

        <Menu
          mode="inline"
          selectedKeys={selected}
          defaultOpenKeys={openKeys}
          items={menuItems}
          className="console-menu"
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
        />
      </Sider>

      <Layout>
        <Header className="console-header">
          <div className="console-header__right">
            <Space size={20}>
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                dropdownRender={appSwitcherDropdownRender}
                open={appSwitcherOpen}
                onOpenChange={handleAppSwitcherOpenChange}
              >
                <Space size={4} className="console-header__link">
                  <SwapOutlined />
                  <Text type="secondary">应用切换</Text>
                  {oauth2Apps.length > 0 && (
                    <Tag
                      color="purple"
                      style={{ marginLeft: 4, marginRight: 0, lineHeight: '18px' }}
                    >
                      {oauth2Apps.length}
                    </Tag>
                  )}
                </Space>
              </Dropdown>
              <Space size={4} className="console-header__link">
                <ApiOutlined /> <Text type="secondary">API</Text>
              </Space>
              <Space size={4} className="console-header__link">
                <BookOutlined /> <Text type="secondary">文档</Text>
              </Space>
              <Space size={4} className="console-header__link">
                <CompassOutlined /> <Text type="secondary">论坛</Text>
              </Space>
              <Space size={4} className="console-header__link">
                <CustomerServiceOutlined /> <Text type="secondary">客服</Text>
              </Space>
              <Dropdown
                menu={{ items: adminMenuItems, onClick: handleUserMenuClick }}
                placement="bottomRight"
              >
                <Space size={8} style={{ cursor: 'pointer' }}>
                  <Avatar
                    size={32}
                    style={{ backgroundColor: '#5b50e8' }}
                    icon={<UserOutlined />}
                  />
                  <Text strong>{currentUser?.name || '管理员'}</Text>
                </Space>
              </Dropdown>
            </Space>
          </div>
        </Header>

        <Content className="console-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
