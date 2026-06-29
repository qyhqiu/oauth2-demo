import React, { useState, useRef, useCallback } from 'react';
import { Form, Input, Button, Alert, Typography, Radio, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MobileOutlined,
  MailOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useCountDown } from 'ahooks';
import ImageCaptcha from './ImageCaptcha';
import styles from '../LoginPage.module.scss';

const { Text } = Typography;

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';
const COUNTDOWN_SECONDS = 60;

export default function RegisterForm({
  registerForm,
  handleRegister,
  registering,
  isRedirecting,
  dynamicStyles,
}) {
  const [contactType, setContactType] = useState('phone');
  const imageCaptchaSessionIdRef = useRef('');

  // 短信验证码倒计时
  const [smsCountdownTarget, setSmsCountdownTarget] = useState(undefined);
  const [smsCountdown] = useCountDown({
    targetDate: smsCountdownTarget,
    onEnd: () => setSmsCountdownTarget(undefined),
  });
  const smsRemaining = Math.ceil(smsCountdown / 1000);

  // 邮箱验证码倒计时
  const [emailCountdownTarget, setEmailCountdownTarget] = useState(undefined);
  const [emailCountdown] = useCountDown({
    targetDate: emailCountdownTarget,
    onEnd: () => setEmailCountdownTarget(undefined),
  });
  const emailRemaining = Math.ceil(emailCountdown / 1000);

  const [sendingSms, setSendingSms] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // 验证码校验后获得的一次性 token（绑定了具体手机号/邮箱，后端注册时校验）
  const [verifyToken, setVerifyToken] = useState('');

  // 开发模式验证码展示
  const [devCode, setDevCode] = useState('');

  const disabled = registering || isRedirecting;

  // 重置验证状态（注册报错/切换联系方式时调用）
  const resetVerifyState = useCallback(() => {
    setVerifyToken('');
    setDevCode('');
    registerForm.setFieldsValue({
      imageCaptchaText: undefined,
      smsCode: undefined,
      emailCode: undefined,
    });
  }, [registerForm]);

  // 切换联系方式时重置相关状态
  const handleContactTypeChange = (event) => {
    setContactType(event.target.value);
    resetVerifyState();
    registerForm.setFieldsValue({ phone: undefined, email: undefined });
  };

  // 发送短信验证码
  const handleSendSmsCode = useCallback(async () => {
    try {
      await registerForm.validateFields(['phone', 'imageCaptchaText']);
    } catch {
      return;
    }
    const phone = registerForm.getFieldValue('phone');
    const imageCaptchaText = registerForm.getFieldValue('imageCaptchaText');

    setSendingSms(true);
    try {
      const response = await fetch(
        `${OAUTH2_SERVER}/v1/api/public/register-captcha/send-sms-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            imageCaptchaSessionId: imageCaptchaSessionIdRef.current,
            imageCaptchaText,
          }),
        },
      );
      const json = await response.json();
      if (json.code === 0) {
        message.success(json.message || '验证码已发送');
        setSmsCountdownTarget(Date.now() + COUNTDOWN_SECONDS * 1000);
        if (json.data?.devCode) setDevCode(json.data.devCode);
      } else {
        message.error(json.message || '发送失败');
        if (json.message?.includes('图形验证码')) {
          registerForm.setFieldValue('imageCaptchaText', '');
        }
      }
    } catch (error) {
      message.error('网络异常，请稍后重试');
    } finally {
      setSendingSms(false);
    }
  }, [registerForm]);

  // 发送邮箱验证码
  const handleSendEmailCode = useCallback(async () => {
    try {
      await registerForm.validateFields(['email']);
    } catch {
      return;
    }
    const email = registerForm.getFieldValue('email');

    setSendingEmail(true);
    try {
      const response = await fetch(
        `${OAUTH2_SERVER}/v1/api/public/register-captcha/send-email-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      const json = await response.json();
      if (json.code === 0) {
        message.success(json.message || '验证码已发送');
        setEmailCountdownTarget(Date.now() + COUNTDOWN_SECONDS * 1000);
        if (json.data?.devCode) setDevCode(json.data.devCode);
      } else {
        message.error(json.message || '发送失败');
      }
    } catch (error) {
      message.error('网络异常，请稍后重试');
    } finally {
      setSendingEmail(false);
    }
  }, [registerForm]);

  // 提交注册（先校验验证码获取 verifyToken，再调用原有 handleRegister）
  const handleSubmit = async (values) => {
    const { imageCaptchaText, smsCode, emailCode, ...registerPayload } = values;

    let currentVerifyToken = verifyToken;

    // 每次提交都必须校验验证码，获取新的 verifyToken（一次性 token，绑定了具体手机号/邮箱）
    if (contactType === 'phone' && values.phone) {
      try {
        const response = await fetch(
          `${OAUTH2_SERVER}/v1/api/public/register-captcha/verify-sms-code`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: values.phone, code: smsCode }),
          },
        );
        const json = await response.json();
        if (json.code !== 0) {
          message.error(json.message || '短信验证码错误');
          resetVerifyState();
          return;
        }
        currentVerifyToken = json.data?.verifyToken || '';
        setVerifyToken(currentVerifyToken);
      } catch {
        message.error('网络异常，请稍后重试');
        return;
      }
    }

    if (contactType === 'email' && values.email) {
      try {
        const response = await fetch(
          `${OAUTH2_SERVER}/v1/api/public/register-captcha/verify-email-code`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: values.email, code: emailCode }),
          },
        );
        const json = await response.json();
        if (json.code !== 0) {
          message.error(json.message || '邮箱验证码错误');
          resetVerifyState();
          return;
        }
        currentVerifyToken = json.data?.verifyToken || '';
        setVerifyToken(currentVerifyToken);
      } catch {
        message.error('网络异常，请稍后重试');
        return;
      }
    }

    // 将 verifyToken 传给 handleRegister，后端会校验 token 与手机号/邮箱的绑定关系
    handleRegister({ ...registerPayload, verifyToken: currentVerifyToken });
  };

  return (
    <Form
      form={registerForm}
      name="oauth2-register"
      onFinish={handleSubmit}
      size="large"
      autoComplete="off"
    >
      <Alert
        type="info"
        showIcon
        className={styles.registerInfoAlert}
        message="注册信息"
        description="用户名为必填项；手机号或邮箱选填一项，需通过验证码校验后方可注册。"
      />

      {/* 用户名 - 必填 */}
      <Form.Item
        name="username"
        rules={[
          { required: true, message: '请输入用户名' },
          {
            pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/,
            message: '用户名需以字母开头，3-32 位字母 / 数字 / 下划线',
          },
        ]}
      >
        <Input
          prefix={<UserOutlined style={{ color: dynamicStyles.iconColor }} />}
          placeholder="用户名（必填）"
          disabled={disabled}
        />
      </Form.Item>

      {/* 联系方式切换 */}
      <Form.Item style={{ marginBottom: 12 }}>
        <Radio.Group value={contactType} onChange={handleContactTypeChange} disabled={disabled}>
          <Radio.Button value="phone">手机号注册</Radio.Button>
          <Radio.Button value="email">邮箱注册</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {/* ── 手机号验证流程 ── */}
      {contactType === 'phone' && (
        <>
          <Form.Item
            name="phone"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确（11 位 1 开头）' },
            ]}
          >
            <Input
              prefix={<MobileOutlined style={{ color: dynamicStyles.iconColor }} />}
              placeholder="手机号"
              maxLength={11}
              disabled={disabled}
            />
          </Form.Item>

          <Form.Item
            name="imageCaptchaText"
            rules={[
              { required: true, message: '请输入图形验证码' },
              { len: 4, message: '请输入 4 位验证码' },
            ]}
          >
            <ImageCaptcha
              onSessionIdChange={(sessionId) => {
                imageCaptchaSessionIdRef.current = sessionId;
              }}
              disabled={disabled}
            />
          </Form.Item>

          <Form.Item
            name="smsCode"
            rules={[
              { required: true, message: '请输入短信验证码' },
              { len: 6, message: '请输入 6 位验证码' },
            ]}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                prefix={<SafetyOutlined style={{ color: dynamicStyles.iconColor }} />}
                placeholder="6 位短信验证码"
                maxLength={6}
                style={{ flex: 1 }}
                disabled={disabled}
                value={registerForm.getFieldValue('smsCode')}
                onChange={(e) => registerForm.setFieldValue('smsCode', e.target.value)}
              />
              <Button
                onClick={handleSendSmsCode}
                loading={sendingSms}
                disabled={smsRemaining > 0 || disabled}
                style={{ minWidth: 120 }}
              >
                {smsRemaining > 0 ? `${smsRemaining}s 后重试` : '获取验证码'}
              </Button>
            </div>
          </Form.Item>
        </>
      )}

      {/* ── 邮箱验证流程 ── */}
      {contactType === 'email' && (
        <>
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: dynamicStyles.iconColor }} />}
              placeholder="邮箱地址"
              disabled={disabled}
            />
          </Form.Item>

          <Form.Item
            name="emailCode"
            rules={[
              { required: true, message: '请输入邮箱验证码' },
              { len: 6, message: '请输入 6 位验证码' },
            ]}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                prefix={<SafetyOutlined style={{ color: dynamicStyles.iconColor }} />}
                placeholder="6 位邮箱验证码"
                maxLength={6}
                style={{ flex: 1 }}
                disabled={disabled}
                value={registerForm.getFieldValue('emailCode')}
                onChange={(e) => registerForm.setFieldValue('emailCode', e.target.value)}
              />
              <Button
                onClick={handleSendEmailCode}
                loading={sendingEmail}
                disabled={emailRemaining > 0 || disabled}
                style={{ minWidth: 120 }}
              >
                {emailRemaining > 0 ? `${emailRemaining}s 后重试` : '获取验证码'}
              </Button>
            </div>
          </Form.Item>
        </>
      )}

      {/* 开发模式验证码展示 */}
      {devCode && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              <Text strong>【开发模式】</Text> 验证码：<Text code>{devCode}</Text>
            </span>
          }
        />
      )}

      {/* 密码 */}
      <Form.Item
        name="password"
        rules={[
          { required: true, message: '请设置密码' },
          { min: 6, max: 64, message: '密码长度需在 6-64 位之间' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: dynamicStyles.iconColor }} />}
          placeholder="设置登录密码（6-64 位）"
          disabled={disabled}
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        dependencies={['password']}
        rules={[
          { required: true, message: '请确认密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve();
              return Promise.reject(new Error('两次密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: dynamicStyles.iconColor }} />}
          placeholder="再次输入密码"
          disabled={disabled}
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={disabled}
          className={styles.loginButton}
          style={{ background: dynamicStyles.buttonBackground }}
        >
          {isRedirecting ? '注册成功，正在自动登录...' : '注册并登录'}
        </Button>
      </Form.Item>
      <Text type="secondary" className={styles.registerHint}>
        注册成功后将自动用同一组凭证登录并完成应用授权，无需再次输入。
      </Text>
    </Form>
  );
}
