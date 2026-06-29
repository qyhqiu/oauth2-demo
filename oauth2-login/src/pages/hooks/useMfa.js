import { useState, useRef, useCallback } from 'react';
import { useRequest } from 'ahooks';
import axios from 'axios';

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

/**
 * MFA 两步验证状态管理
 *
 * @param {import('antd/es/message').MessageInstance} messageApi
 * @param {function} onVerifySuccess - 验证成功回调，接收 redirect_url
 * @returns MFA 相关状态和操作方法
 */
export default function useMfa(messageApi, onVerifySuccess) {
  // mfaState: null | { mfa_token, mfa_channel, mfa_target_masked }
  const [mfaState, setMfaState] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaResendCountdown, setMfaResendCountdown] = useState(0);
  const countdownTimer = useRef(null);

  const startResendCountdown = useCallback(() => {
    setMfaResendCountdown(60);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = setInterval(() => {
      setMfaResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  /** 进入 MFA 步骤 */
  const enterMfa = useCallback(
    (mfaData) => {
      setMfaState(mfaData);
      setMfaCode('');
      startResendCountdown();
      const channelLabel = mfaData.mfa_channel === 'phone' ? '手机' : '邮箱';
      messageApi.info(`验证码已发送到${channelLabel} ${mfaData.mfa_target_masked}`);
    },
    [messageApi, startResendCountdown],
  );

  /** 退出 MFA 步骤 */
  const exitMfa = useCallback(() => {
    setMfaState(null);
    setMfaCode('');
  }, []);

  /** 验证码提交 */
  const { loading: verifyLoading, run: runVerify } = useRequest(
    async () => {
      if (!mfaCode || mfaCode.length < 4) {
        messageApi.warning('请输入验证码');
        return Promise.reject(new Error('code too short'));
      }
      const resp = await axios.post(`${OAUTH2_SERVER}/v1/oauth/mfa-verify`, {
        mfa_token: mfaState.mfa_token,
        code: mfaCode,
      });
      return resp.data;
    },
    {
      manual: true,
      onSuccess: (data) => {
        if (data?.mfa_verified && data?.redirect_url) {
          onVerifySuccess(data.redirect_url);
        }
      },
      onError: (err) => {
        const errorMessage = err.response?.data?.error_description || '验证码错误';
        messageApi.error(errorMessage);
        if (err.response?.data?.error === 'mfa_token_expired') {
          exitMfa();
          messageApi.warning('MFA 令牌已过期，请重新登录');
        }
      },
    },
  );

  /** 验证码重发 */
  const { run: runResend } = useRequest(
    async () => {
      const resp = await axios.post(`${OAUTH2_SERVER}/v1/oauth/mfa-resend`, {
        mfa_token: mfaState.mfa_token,
      });
      return resp.data;
    },
    {
      manual: true,
      onSuccess: (data) => {
        const devCode = data?.devCode;
        messageApi.success(devCode ? `验证码已重新发送（Demo: ${devCode}）` : '验证码已重新发送');
        startResendCountdown();
      },
      onError: (err) => {
        messageApi.error(err.response?.data?.error_description || '重发失败');
        if (err.response?.data?.error === 'mfa_token_expired') {
          exitMfa();
          messageApi.warning('MFA 令牌已过期，请重新登录');
        }
      },
    },
  );

  return {
    mfaState,
    mfaCode,
    setMfaCode,
    mfaResendCountdown,
    verifyLoading,
    enterMfa,
    exitMfa,
    runVerify,
    runResend,
  };
}
