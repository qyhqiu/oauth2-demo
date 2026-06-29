import React from 'react';
import { Form, Input, Button, Space, Divider, Typography, Tooltip } from 'antd';
import { UserOutlined, LockOutlined, GithubOutlined } from '@ant-design/icons';
import styles from '../LoginPage.module.scss';

const { Text } = Typography;

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

const PROVIDER_ICON_MAP = {
  gitee: 'https://gitee.com/favicon.ico',
};

const PROVIDER_COLOR_MAP = {
  gitee: '#C71D23',
  github: '#24292e',
};

function SocialLoginButtons({ socialConnections, oauthParams }) {
  if (!socialConnections || socialConnections.length === 0) return null;

  const handleSocialLogin = (connection) => {
    const params = new URLSearchParams();
    // 把当前 OAuth 参数透传，回调后能继续完成业务应用的授权流程
    if (oauthParams) {
      Object.entries(oauthParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
    }
    const queryString = params.toString();
    const authorizeUrl = `${OAUTH2_SERVER}/v1/oauth/social/${connection.provider}/authorize?connection_id=${connection._id}${queryString ? `&${queryString}` : ''}`;
    window.location.href = authorizeUrl;
  };

  return (
    <>
      <Divider plain>
        <Text type="secondary" style={{ fontSize: 12 }}>
          第三方账号登录
        </Text>
      </Divider>
      <Space style={{ width: '100%', justifyContent: 'center' }} size="middle">
        {socialConnections.map((connection) => (
          <Tooltip
            key={connection._id}
            title={`使用 ${connection.displayName || connection.provider} 登录`}
          >
            <Button
              shape="circle"
              size="large"
              onClick={() => handleSocialLogin(connection)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderColor: PROVIDER_COLOR_MAP[connection.provider] || '#d9d9d9',
              }}
              icon={
                PROVIDER_ICON_MAP[connection.provider] ? (
                  <img
                    src={PROVIDER_ICON_MAP[connection.provider]}
                    alt={connection.provider}
                    style={{ width: 20, height: 20 }}
                  />
                ) : connection.provider === 'github' ? (
                  <GithubOutlined style={{ fontSize: 20, color: PROVIDER_COLOR_MAP.github }} />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 'bold' }}>
                    {connection.provider[0].toUpperCase()}
                  </span>
                )
              }
            />
          </Tooltip>
        ))}
      </Space>
    </>
  );
}

export default function LoginForm({
  form,
  handleLogin,
  loginLoading,
  isRedirecting,
  dynamicStyles,
  fillTestAccount,
  socialConnections,
  oauthParams,
}) {
  return (
    <Form form={form} name="oauth2-login" onFinish={handleLogin} size="large" autoComplete="off">
      <Form.Item
        name="username"
        rules={[{ required: true, message: '请输入用户名 / 手机号 / 邮箱' }]}
      >
        <Input
          prefix={<UserOutlined style={{ color: dynamicStyles.iconColor }} />}
          placeholder="用户名 / 手机号 / 邮箱"
          disabled={isRedirecting}
          autoComplete="username"
        />
      </Form.Item>

      <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password
          prefix={<LockOutlined style={{ color: dynamicStyles.iconColor }} />}
          placeholder="请输入密码"
          disabled={isRedirecting}
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loginLoading || isRedirecting}
          className={styles.loginButton}
          style={{ background: dynamicStyles.buttonBackground }}
        >
          {isRedirecting ? '授权跳转中...' : '登录并授权'}
        </Button>
      </Form.Item>

      <SocialLoginButtons socialConnections={socialConnections} oauthParams={oauthParams} />

      <Divider plain>
        <Text type="secondary" style={{ fontSize: 12 }}>
          测试账号（密码均为 123456）
        </Text>
      </Divider>

      <Space style={{ width: '100%', justifyContent: 'center' }} size="middle">
        <Button size="small" onClick={() => fillTestAccount('admin')}>
          👑 admin
        </Button>
        <Button size="small" onClick={() => fillTestAccount('user1')}>
          👤 user1
        </Button>
        <Button size="small" onClick={() => fillTestAccount('user2')}>
          👤 user2
        </Button>
      </Space>
    </Form>
  );
}
