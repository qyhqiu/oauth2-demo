import { useState, useEffect } from 'react';

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

/**
 * OAuth2 免登录自动检测：
 * mount 时用 fetch /cas/session（credentials: include）检测 oauth2-server 域下的 OAuth2 Cookie。
 * 如果检测到已登录（session 有效），自动跳 /oauth/authorize 完成授权。
 *
 * @param {object} oauthParams - OAuth2 授权参数
 * @returns {boolean} oauth2Checking - 是否正在检测中
 */
export default function useOAuth2AutoLogin(oauthParams) {
  const [oauth2Checking, setOAuth2Checking] = useState(false);

  useEffect(() => {
    const hasRedirectUri = !!oauthParams.redirect_uri;
    const urlParams = new URLSearchParams(window.location.search);
    const hasError = urlParams.get('error');
    if (!hasRedirectUri || hasError) return;

    setOAuth2Checking(true);
    fetch(`${OAUTH2_SERVER}/v1/cas/session`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (data?.session) {
          const authorizeUrl = new URL(`${OAUTH2_SERVER}/v1/oauth/authorize`);
          authorizeUrl.searchParams.set('client_id', oauthParams.client_id);
          authorizeUrl.searchParams.set('redirect_uri', oauthParams.redirect_uri);
          authorizeUrl.searchParams.set('response_type', oauthParams.response_type);
          authorizeUrl.searchParams.set('scope', oauthParams.scope);
          if (oauthParams.state) authorizeUrl.searchParams.set('state', oauthParams.state);
          if (oauthParams.code_challenge)
            authorizeUrl.searchParams.set('code_challenge', oauthParams.code_challenge);
          if (oauthParams.code_challenge_method)
            authorizeUrl.searchParams.set(
              'code_challenge_method',
              oauthParams.code_challenge_method,
            );
          if (oauthParams.post_login_redirect_uri)
            authorizeUrl.searchParams.set(
              'post_login_redirect_uri',
              oauthParams.post_login_redirect_uri,
            );
          window.location.replace(authorizeUrl.toString());
        } else {
          setOAuth2Checking(false);
        }
      })
      .catch(() => {
        setOAuth2Checking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return oauth2Checking;
}
