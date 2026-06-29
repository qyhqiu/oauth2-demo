import React, { useState } from 'react';
import { Form, Card, Typography, Space, Divider, message, Alert, ConfigProvider, Tabs } from 'antd';
import { SafetyCertificateOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useBoolean, useRequest } from 'ahooks';
import axios from 'axios';
import { selfRegister } from '../api/auth';

import useOAuthParams from './hooks/useOAuthParams';
import useErrorBanner from './hooks/useErrorBanner';
import useOAuth2AutoLogin from './hooks/useOAuth2AutoLogin';
import useBranding from './hooks/useBranding';
import useMfa from './hooks/useMfa';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import MfaVerifyStep from './components/MfaVerifyStep';
import styles from './LoginPage.module.scss';

const { Title, Text, Paragraph } = Typography;
const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

export default function LoginPage() {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  // ===== 自定义 hooks =====
  const oauthParams = useOAuthParams();
  const [errorBanner, setErrorBanner] = useErrorBanner(messageApi);
  const oauth2Checking = useOAuth2AutoLogin(oauthParams);
  const { branding, dynamicStyles, DEFAULT_BRANDING } = useBranding(oauthParams.client_id);

  const [isRedirecting, { setTrue: startRedirecting }] = useBoolean(false);
  const fromApp = !!oauthParams.client_name;
  const isMissingOAuthParams = !oauthParams.redirect_uri;

  // ===== 社会化身份源（按 client_id 过滤，仅返回该应用关联且已启用的身份源） =====
  const { data: socialConnections = [] } = useRequest(
    async () => {
      const params = oauthParams.client_id ? { client_id: oauthParams.client_id } : {};
      const resp = await axios.get(`${OAUTH2_SERVER}/v1/api/public/social-connections`, { params });
      return resp.data?.data || [];
    },
    { refreshDeps: [oauthParams.client_id] },
  );

  // ===== MFA =====
  const mfa = useMfa(messageApi, (redirectUrl) => {
    startRedirecting();
    window.location.href = redirectUrl;
  });

  // ===== 注册 =====
  const [authMode, setAuthMode] = useState('login');
  const [registerForm] = Form.useForm();

  // ===== 登录预检（dry_run） =====
  const { loading: loginLoading, run: runDryRun } = useRequest(
    async (fields) => {
      const formData = new URLSearchParams();
      Object.entries(fields).forEach(([key, value]) => formData.append(key, value || ''));
      const resp = await axios.post(
        `${OAUTH2_SERVER}/v1/oauth/login-and-authorize?dry_run=1`,
        formData,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: (status) => status >= 200 && status < 300,
        },
      );
      return { dryRunResult: resp.data, fields };
    },
    {
      manual: true,
      onSuccess: async ({ dryRunResult, fields }) => {
        // 阶段 1.5：MFA 拦截
        if (dryRunResult?.mfa_required) {
          try {
            const formData = new URLSearchParams();
            Object.entries(fields).forEach(([key, value]) => formData.append(key, value || ''));
            const mfaResp = await axios.post(
              `${OAUTH2_SERVER}/v1/oauth/login-and-authorize`,
              formData,
              {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                validateStatus: (status) => status >= 200 && status < 300,
                maxRedirects: 0,
              },
            );
            const mfaData = mfaResp.data;
            if (mfaData?.mfa_required && mfaData?.mfa_token) {
              mfa.enterMfa(mfaData);
            }
          } catch (mfaErr) {
            messageApi.error(mfaErr.response?.data?.error_description || 'MFA 初始化失败');
          }
          return;
        }

        // 阶段 2：预检通过（无 MFA）→ form 提交
        startRedirecting();
        const formEl = document.createElement('form');
        formEl.method = 'POST';
        formEl.action = `${OAUTH2_SERVER}/v1/oauth/login-and-authorize`;
        Object.entries(fields).forEach(([name, value]) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value || '';
          formEl.appendChild(input);
        });
        document.body.appendChild(formEl);
        formEl.submit();
      },
      onError: (err) => {
        const description =
          err.response?.data?.error_description ||
          err.response?.data?.error ||
          err.message ||
          '登录失败，请稍后重试';
        const title = err.response?.status === 429 ? '请求过于频繁' : '登录失败';
        messageApi.error({ content: description, duration: 4 });
        setErrorBanner({ code: 'login_failed', title, description });
      },
    },
  );

  // ===== 注册 =====
  const { loading: registering, run: runRegister } = useRequest(
    async (values) => {
      const result = await selfRegister({
        username: values.username || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        password: values.password,
        verifyToken: values.verifyToken || undefined,
      });
      return { result, values };
    },
    {
      manual: true,
      onSuccess: async ({ result, values }) => {
        if (!result.ok) {
          const desc = result.error_description || '注册失败';
          messageApi.error({ content: desc, duration: 4 });
          setErrorBanner({
            code: result.error || 'register_failed',
            title: '注册失败',
            description: desc,
          });
          return;
        }
        messageApi.success('注册成功，正在自动登录...');
        const loginIdentifier = values.username || values.phone || values.email;
        form.setFieldsValue({ username: loginIdentifier, password: values.password });
        handleLogin({ username: loginIdentifier, password: values.password });
      },
    },
  );

  function handleLogin(values) {
    if (isMissingOAuthParams) {
      messageApi.error('缺少授权参数，请通过应用正常入口访问');
      return;
    }
    setErrorBanner(null);
    const fields = {
      username: values.username,
      password: values.password,
      redirect_uri: oauthParams.redirect_uri,
      state: oauthParams.state,
      scope: oauthParams.scope,
      code_challenge: oauthParams.code_challenge,
      code_challenge_method: oauthParams.code_challenge_method,
      post_login_redirect_uri: oauthParams.post_login_redirect_uri,
    };
    runDryRun(fields);
  }

  function handleRegister(values) {
    if (isMissingOAuthParams) {
      messageApi.error('缺少授权参数，请通过应用正常入口访问');
      return;
    }
    setErrorBanner(null);
    runRegister(values);
  }

  const fillTestAccount = (username) => {
    form.setFieldsValue({ username, password: '123456' });
  };

  if (oauth2Checking) return null;

  return (
    <ConfigProvider
      theme={{ token: { colorPrimary: branding.primaryColor || DEFAULT_BRANDING.primaryColor } }}
    >
      <div className={styles.container} style={{ background: dynamicStyles.background }}>
        {contextHolder}

        {/* 背景装饰 */}
        <div className={styles.background}>
          <div className={styles.circle1} />
          <div className={styles.circle2} />
          <div className={styles.circle3} />
        </div>

        <div className={styles.content}>
          {/* Logo 区域 */}
          <div className={styles.logoArea}>
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name || 'logo'}
                className={styles.brandLogo}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <SafetyCertificateOutlined className={styles.logoIcon} />
            )}
            <Title level={2} className={styles.logoTitle}>
              {branding.welcomeText ||
                (branding.name ? `欢迎登录 ${branding.name}` : 'OAuth2 统一认证中心')}
            </Title>
            <Text className={styles.logoSubtitle}>Authorization Server · OpenID Connect</Text>
          </div>

          {/* 登录卡片 */}
          <Card className={styles.card} bordered={false}>
            {/* OAuth2 授权信息提示 */}
            {fromApp && (
              <Alert
                message={
                  <Space>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <span>
                      <strong>{oauthParams.client_name}</strong> 请求授权访问您的账号
                    </span>
                  </Space>
                }
                description={
                  <div>
                    <div>
                      授权范围：<Text code>{oauthParams.scope}</Text>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        回调地址: {oauthParams.redirect_uri}
                      </Text>
                    </div>
                  </div>
                }
                type="info"
                showIcon={false}
                className={styles.authAlert}
              />
            )}

            {isMissingOAuthParams && (
              <Alert
                message="缺少授权参数"
                description="请通过应用正常入口访问，不要直接打开登录页。"
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {errorBanner && (
              <Alert
                message={errorBanner.title}
                description={errorBanner.description}
                type="error"
                showIcon
                closable
                onClose={() => setErrorBanner(null)}
                className={styles.errorAlert}
              />
            )}

            {mfa.mfaState ? (
              <MfaVerifyStep
                mfa={mfa}
                dynamicStyles={dynamicStyles}
                isRedirecting={isRedirecting}
              />
            ) : (
              <Tabs
                activeKey={authMode}
                onChange={setAuthMode}
                centered
                style={{ marginBottom: 16 }}
                items={[
                  {
                    key: 'login',
                    label: '登录',
                    children: (
                      <LoginForm
                        form={form}
                        handleLogin={handleLogin}
                        loginLoading={loginLoading}
                        isRedirecting={isRedirecting}
                        dynamicStyles={dynamicStyles}
                        fillTestAccount={fillTestAccount}
                        socialConnections={socialConnections}
                        oauthParams={oauthParams}
                      />
                    ),
                  },
                  branding.allowRegister !== false && {
                    key: 'register',
                    label: '立即注册',
                    children: (
                      <RegisterForm
                        registerForm={registerForm}
                        handleRegister={handleRegister}
                        registering={registering}
                        isRedirecting={isRedirecting}
                        dynamicStyles={dynamicStyles}
                      />
                    ),
                  },
                ].filter(Boolean)}
              />
            )}
          </Card>

          {/* 底部说明 */}
          <div className={styles.footer}>
            {branding.copyright ? (
              <Paragraph className={styles.footerText}>{branding.copyright}</Paragraph>
            ) : (
              <>
                <Paragraph className={styles.footerText}>
                  🔐 基于 OAuth2 授权码流程 + JWT + OpenID Connect
                </Paragraph>
                <Space split={<Divider type="vertical" className={styles.footerDivider} />}>
                  <Text className={styles.footerLink}>应用 A: localhost:3002</Text>
                  <Text className={styles.footerLink}>应用 B: localhost:3003</Text>
                  <Text className={styles.footerLink}>Auth Server: localhost:3000</Text>
                </Space>
              </>
            )}
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
