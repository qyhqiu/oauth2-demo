import { useMemo } from 'react';

/**
 * 从 URL 中解析 OAuth2 授权参数（含 PKCE 参数，RFC 7636）
 * 返回稳定引用（仅在 mount 时解析一次）
 */
export default function useOAuthParams() {
  return useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      client_id: urlParams.get('client_id') || '',
      client_name: urlParams.get('client_name') || '',
      redirect_uri: urlParams.get('redirect_uri') || '',
      state: urlParams.get('state') || '',
      scope: urlParams.get('scope') || 'openid profile',
      response_type: urlParams.get('response_type') || 'code',
      code_challenge: urlParams.get('code_challenge') || '',
      code_challenge_method: urlParams.get('code_challenge_method') || '',
      post_login_redirect_uri: urlParams.get('post_login_redirect_uri') || '',
    };
  }, []);
}
