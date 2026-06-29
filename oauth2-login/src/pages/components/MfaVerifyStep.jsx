import React from 'react';
import { Form, Input, Button, Typography, Tooltip } from 'antd';
import { SafetyOutlined, KeyOutlined } from '@ant-design/icons';
import styles from '../LoginPage.module.scss';

const { Title, Paragraph, Text } = Typography;

export default function MfaVerifyStep({ mfa, dynamicStyles, isRedirecting }) {
  const isTotp = mfa.mfaState.mfa_channel === 'totp';

  return (
    <>
      <Title level={4} className={styles.mfaTitle}>
        <SafetyOutlined style={{ color: dynamicStyles.iconColor, marginRight: 8 }} />
        两步验证
      </Title>
      <Paragraph className={styles.mfaDescription}>
        {isTotp ? (
          <>请打开认证器 App 输入 6 位动态码</>
        ) : (
          <>
            验证码已发送至{mfa.mfaState.mfa_channel === 'phone' ? '手机' : '邮箱'}
            <Text strong style={{ marginLeft: 8 }}>
              {mfa.mfaState.mfa_target_masked}
            </Text>
          </>
        )}
      </Paragraph>

      <Form size="large" autoComplete="off" onFinish={mfa.runVerify}>
        <Form.Item style={{ marginBottom: 16 }}>
          <Input
            prefix={
              isTotp ? (
                <KeyOutlined style={{ color: dynamicStyles.iconColor }} />
              ) : (
                <SafetyOutlined style={{ color: dynamicStyles.iconColor }} />
              )
            }
            placeholder={isTotp ? '请输入认证器 App 显示的 6 位动态码' : '请输入 6 位验证码'}
            value={mfa.mfaCode}
            onChange={(e) => mfa.setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            autoFocus
            disabled={mfa.verifyLoading || isRedirecting}
            onPressEnter={mfa.runVerify}
            className={isTotp ? styles.mfaTotpInput : undefined}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            block
            loading={mfa.verifyLoading || isRedirecting}
            onClick={mfa.runVerify}
            className={styles.loginButton}
            style={{ background: dynamicStyles.buttonBackground }}
          >
            {isRedirecting ? '授权跳转中...' : '验证并登录'}
          </Button>
        </Form.Item>

        <div className={styles.mfaActions}>
          {isTotp ? (
            <Tooltip title="动态码每 30 秒自动刷新，无需重发；若多次失败请检查 App 时间是否同步">
              <Text type="secondary" className={styles.mfaTotpHint}>
                动态码每 30s 自动刷新
              </Text>
            </Tooltip>
          ) : (
            <Button
              type="link"
              size="small"
              disabled={mfa.mfaResendCountdown > 0}
              onClick={mfa.runResend}
              style={{ paddingLeft: 0 }}
            >
              {mfa.mfaResendCountdown > 0
                ? `${mfa.mfaResendCountdown}s 后可重发`
                : '重新发送验证码'}
            </Button>
          )}
          <Button type="link" size="small" onClick={mfa.exitMfa} style={{ paddingRight: 0 }}>
            返回登录
          </Button>
        </div>
      </Form>
    </>
  );
}
