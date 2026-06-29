/**
 * Well-Known Controller — OpenID Connect Discovery 端点
 */
const { OAUTH2_SERVER_URL, ID_TOKEN_SIGNING_ALG } = require('../utils/constants');
const { getPublicJwk } = require('../utils/keystore');
const { SUPPORTED_CLAIMS, SUPPORTED_SCOPES } = require('../service/oidcClaims.service');

function getOpenidConfiguration(req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    issuer: OAUTH2_SERVER_URL,
    authorization_endpoint: `${OAUTH2_SERVER_URL}/v1/oauth/authorize`,
    token_endpoint: `${OAUTH2_SERVER_URL}/v1/oauth/token`,
    userinfo_endpoint: `${OAUTH2_SERVER_URL}/v1/oauth/userinfo`,
    revocation_endpoint: `${OAUTH2_SERVER_URL}/v1/oauth/revoke`,
    end_session_endpoint: `${OAUTH2_SERVER_URL}/v1/oauth/logout`,
    jwks_uri: `${OAUTH2_SERVER_URL}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: SUPPORTED_SCOPES,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [ID_TOKEN_SIGNING_ALG],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    userinfo_signing_alg_values_supported: ['none'],
    claims_supported: SUPPORTED_CLAIMS,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
    require_request_uri_registration: false,
    claims_parameter_supported: false,
  });
}

function getJwks(req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ keys: [getPublicJwk()] });
}

module.exports = { getOpenidConfiguration, getJwks };
