import React from 'react';
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  message,
  Alert,
  Space,
  Divider,
  Avatar,
  Tag,
  Spin,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  CloudOutlined,
  CheckCircleFilled,
  SwapOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRequest } from 'ahooks';
import {
  adminLogin,
  getOAuth2Config,
  oauth2GlobalLogout,
  trackOAuth2Session,
  OAUTH2_LOGIN_ENTRY_URL,
} from '../../api';
import { saveAuth } from '../../utils/auth';
import './ConsoleLoginPage.scss';

const { Title, Text } = Typography;

/**
 * 控制台登录页
 * - 仅 role=admin 用户可登录
 * - 登录成功后写入 localStorage（token + user）并重定向到原始访问地址
 * - 通过 URL search 中的 ?from=/path 携带"未登录被拦截前的目标路径"
 */
export default function ConsoleLoginPage() {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const location = useLocation();

  // 解析守卫透传的目标路径，登录成功后回跳
  const params = new URLSearchParams(location.search);
  const redirectTo = params.get('from') || '/home';

  const { loading, runAsync, error } = useRequest(adminLogin, {
    manual: true,
    onSuccess: (resp) => {
      // 后端统一返回 HTTP 200，通过 code 字段区分成功/失败
      if (resp.code !== 0) {
        messageApi.error(resp.message || '登录失败');
        return;
      }
      const { token, user } = resp.data;
      saveAuth(token, user);
      messageApi.success(`欢迎回来，${user.name}`);
      setTimeout(() => navigate(redirectTo, { replace: true }), 200);
    },
  });

  // 拉 OAuth2 配置（决定是否展示"使用 OAuth2 登录"按钮）
  // 后端不可用时静默降级（仅展示账号密码登录）
  const { data: oauth2ConfigResp } = useRequest(getOAuth2Config, {
    onError: () => {
      /* 无 OAuth2 配置时按钮自动隐藏 */
    },
  });
  const oauth2Enabled = oauth2ConfigResp?.data?.enabled === true;

  // A+：检测 OAuth2 Session —— 已登录用户进入登录页时直接给「以此身份继续」快捷入口
  // 设计要点：
  // - mount 时自动触发（与 SDK 配置加载并行，不阻塞表单渲染）
  // - 失败兜底为 { session: null }，UI 自动隐藏 OAuth2 卡片
  // - mutate 在切换账号时立即把 cache 改空，UI 即时反映，不等 oauth2GlobalLogout 网络往返
  const {
    data: oauth2SessionResp,
    loading: oauth2SessionLoading,
    mutate: mutateOAuth2Session,
  } = useRequest(trackOAuth2Session, {
    cacheKey: 'console-login-oauth2-session',
    staleTime: 30 * 1000,
  });
  const oauth2SessionUser = oauth2SessionResp?.session ? oauth2SessionResp.userInfo : null;

  const handleContinueAsSsoUser = () => {
    // 走完整 OAuth2 登录链路：浏览器跳转到 OAuth2 入口，oauth2-server 凭已存在的 OAuth2 Cookie
    // 直接 302 回控制台 callback 完成换 token，全程无需重新输入密码
    if (redirectTo && redirectTo !== '/home') {
      sessionStorage.setItem('oauth2_redirect_to', redirectTo);
    }
    window.location.href = OAUTH2_LOGIN_ENTRY_URL;
  };

  const handleSwitchSsoAccount = async () => {
    // 立即把本地 OAuth2 Session 视为已登出，UI 即时切回密码登录表单
    mutateOAuth2Session({ session: null });
    // 异步清除 oauth2-server 端的 OAuth2 Cookie（失败也不阻塞用户输密码）
    await oauth2GlobalLogout();
    messageApi.info('已退出当前 OAuth2 身份，请使用账号密码登录');
  };

  const handleSubmit = async (values) => {
    try {
      await runAsync(values.username, values.password);
    } catch {
      // 错误信息由下方 Alert 展示，无需弹 message
    }
  };

  const handleSsoLogin = () => {
    // 把守卫拦截前的目标路径塞进 sessionStorage，回调页登录成功后取出回跳
    if (redirectTo && redirectTo !== '/home') {
      sessionStorage.setItem('oauth2_redirect_to', redirectTo);
    }
    // 走浏览器原生导航触发后端 302 链路（不能用 axios）
    window.location.href = OAUTH2_LOGIN_ENTRY_URL;
  };

  const fillTestAccount = () => {
    form.setFieldsValue({ username: 'admin', password: '123456' });
  };

  return (
    <div className="console-login-page">
      {contextHolder}

      <div className="console-login-page__bg">
        <div className="console-login-page__circle console-login-page__circle--1" />
        <div className="console-login-page__circle console-login-page__circle--2" />
      </div>

      <div className="console-login-page__content">
        <div className="console-login-page__brand">
          <SafetyCertificateOutlined className="console-login-page__brand-icon" />
          <Title level={2} className="console-login-page__brand-title">
            OAuth2 控制台
          </Title>
          <Text className="console-login-page__brand-sub">
            管理员登录 · Authorization Server Console
          </Text>
        </div>

        <Card className="console-login-page__card" bordered={false}>
          <Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>
            登录到控制台
          </Title>

          {error && (
            <Alert
              message="登录失败"
              description={error.error_description || '请检查用户名密码或访问权限'}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {/* A+：检测到 OAuth2 已登录 → 顶部展示快捷入口卡片，让用户「秒进」控制台 */}
          {oauth2SessionLoading ? (
            <div className="console-login-page__oauth2-card console-login-page__oauth2-card--loading">
              <Spin size="small" />
              <Text type="secondary" style={{ marginLeft: 10, fontSize: 13 }}>
                正在检测 OAuth2 登录态…
              </Text>
            </div>
          ) : oauth2SessionUser ? (
            <div className="console-login-page__oauth2-card">
              <CheckCircleFilled className="console-login-page__oauth2-card-icon" />
              <div className="console-login-page__oauth2-card-meta">
                <div className="console-login-page__oauth2-card-title">
                  <Text strong>检测到 OAuth2 已登录</Text>
                  {oauth2SessionUser.role && (
                    <Tag color="purple" style={{ marginLeft: 8, fontSize: 11, lineHeight: '16px' }}>
                      {oauth2SessionUser.role}
                    </Tag>
                  )}
                </div>
                <div className="console-login-page__oauth2-card-user">
                  <Avatar
                    size={20}
                    style={{ backgroundColor: '#5b50e8' }}
                    icon={<UserOutlined />}
                  />
                  <Text strong style={{ marginLeft: 6 }}>
                    {oauth2SessionUser.name || oauth2SessionUser.username}
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                    @{oauth2SessionUser.username}
                  </Text>
                </div>
              </div>
              <div className="console-login-page__oauth2-card-actions">
                <Button
                  type="primary"
                  size="middle"
                  onClick={handleContinueAsSsoUser}
                  className="console-login-page__oauth2-card-continue"
                >
                  以此身份继续
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={handleSwitchSsoAccount}
                >
                  切换账号
                </Button>
              </div>
            </div>
          ) : null}

          <Form
            form={form}
            name="console-login"
            onFinish={handleSubmit}
            size="large"
            autoComplete="off"
          >
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="管理员账号" disabled={loading} />
            </Form.Item>

            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" disabled={loading} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 12 }}>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                className="console-login-page__submit"
              >
                登录
              </Button>
            </Form.Item>
          </Form>

          {oauth2Enabled && (
            <>
              <Divider plain>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  或
                </Text>
              </Divider>
              <Button
                block
                size="large"
                icon={<CloudOutlined />}
                onClick={handleSsoLogin}
                disabled={loading}
                className="console-login-page__oauth2-btn"
              >
                使用 OAuth2 单点登录
              </Button>
            </>
          )}

          <Divider plain>
            <Text type="secondary" style={{ fontSize: 12 }}>
              测试账号
            </Text>
          </Divider>

          <Space style={{ width: '100%', justifyContent: 'center' }}>
            <Button size="small" onClick={fillTestAccount}>
              👑 admin / 123456
            </Button>
          </Space>

          <Divider />
          <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center' }}>
            🔒 仅 admin 角色用户可登录控制台，普通用户请前往业务应用
          </Text>
        </Card>
      </div>
    </div>
  );
}
