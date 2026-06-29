import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Spin, Result, Button, Typography, Alert } from 'antd';
import { CloudOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { oauth2Exchange } from '../../api';
import { saveAuth } from '../../utils/auth';
import './ConsoleLoginPage.scss';

const { Title, Text } = Typography;

/**
 * OAuth2 登录回调页
 *
 * 流程：
 * 1. oauth2-server 完成用户登录后 302 到本页 ?code=xxx&state=xxx
 * 2. 本页拿到 code+state，POST 到 /api/console/admin/oauth2-exchange
 * 3. 后端校验 PKCE + admin 角色，返回 console JWT
 * 4. 写入 localStorage，跳转到 sessionStorage 里保存的目标路径（默认 /home）
 *
 * 失败场景：
 * - URL 中带 error 参数（用户拒绝授权 / 应用禁用 / 角色不匹配等）
 * - 后端兑换失败（state 过期 / PKCE 校验失败 / 非 admin 角色等）
 *
 * 防重复执行：
 * - 用 ref 守卫，避免 React StrictMode 下 useEffect 双触发导致 code 被消费两次
 */
export default function OAuth2CallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [errorInfo, setErrorInfo] = useState(null);
  const [userName, setUserName] = useState('');
  const exchangedRef = useRef(false); // 防 StrictMode 重复执行

  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // oauth2-server 透传过来的错误（如：access_denied / 应用禁用）
    if (error) {
      setStatus('error');
      setErrorInfo({
        title: '授权失败',
        description: errorDescription || error,
      });
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorInfo({
        title: '回调参数缺失',
        description: 'URL 中缺少 code 或 state 参数，请重新发起登录',
      });
      return;
    }

    // 兑换 console JWT
    oauth2Exchange(code, state)
      .then((resp) => {
        const { token, user } = resp.data;
        saveAuth(token, user);
        setUserName(user.name);
        setStatus('success');

        // 取出登录前的目标路径（登录页存的）
        const redirectTo = sessionStorage.getItem('oauth2_redirect_to') || '/home';
        sessionStorage.removeItem('oauth2_redirect_to');

        // 给用户 800ms 看到欢迎信息再跳走
        setTimeout(() => {
          navigate(redirectTo, { replace: true });
        }, 800);
      })
      .catch((err) => {
        setStatus('error');
        setErrorInfo({
          title: 'OAuth2 登录失败',
          description: err?.error_description || err?.message || '后端兑换 Token 失败，请重新登录',
        });
      });
  }, [searchParams, navigate]);

  return (
    <div className="console-login-page">
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
          <Text className="console-login-page__brand-sub">单点登录回调处理中</Text>
        </div>

        <Card className="console-login-page__card" bordered={false}>
          {status === 'loading' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Spin size="large" />
              <Title level={5} style={{ marginTop: 24, marginBottom: 8 }}>
                正在完成 OAuth2 登录...
              </Title>
              <Text type="secondary">正在校验授权码并签发 Token</Text>
            </div>
          )}

          {status === 'success' && (
            <Result
              status="success"
              icon={<CloudOutlined style={{ color: '#52c41a' }} />}
              title={`欢迎回来，${userName}`}
              subTitle="OAuth2 登录成功，即将跳转到控制台首页..."
            />
          )}

          {status === 'error' && (
            <>
              <Alert
                type="error"
                showIcon
                message={errorInfo?.title}
                description={errorInfo?.description}
                style={{ marginBottom: 16 }}
              />
              <Button
                type="primary"
                block
                size="large"
                onClick={() => navigate('/login', { replace: true })}
              >
                返回登录页
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
