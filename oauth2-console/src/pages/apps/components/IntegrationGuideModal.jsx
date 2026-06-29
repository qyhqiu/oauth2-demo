import React, { useState } from 'react';
import { Modal, Tabs, Button, Typography, Space, message, Steps, Alert } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';

const { Text, Paragraph, Link } = Typography;

const OAUTH2_SERVER_URL = 'http://localhost:3000';
const OAUTH2_LOGIN_URL = 'http://localhost:3001';

/**
 * 接入教程 Modal
 *
 * 提供多语言 SDK 接入示例（JavaScript / React / Node.js），
 * 每段代码均可一键复制。
 */
export default function IntegrationGuideModal({ open, onClose, app }) {
  const [activeTab, setActiveTab] = useState('javascript');

  if (!app) return null;

  const snippets = buildSnippets(app);
  const docUrl =
    'https://docs.authing.cn/v2/guides/basics/authenticate-first-user/use-hosted-login-page.html';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`「${app.name}」接入教程`}
      width={780}
      footer={[
        <Button key="doc" type="link" href={docUrl} target="_blank">
          查看完整文档 →
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        message="按以下步骤集成 OAuth2 单点登录"
        description={
          <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
            <Text>1. 安装 SDK 依赖到你的应用</Text>
            <Text>
              2. 用应用的 <code>App ID</code> 和 <code>Origin</code> 初始化 SDK
            </Text>
            <Text>
              3. 在路由守卫中调用 <code>login()</code> 触发登录跳转
            </Text>
            <Text>
              4. 在回调路由调用 <code>handleCallback()</code> 完成登录
            </Text>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        destroyInactiveTabPane
        items={[
          {
            key: 'javascript',
            label: 'JavaScript SDK',
            children: (
              <>
                <CodeBlock title="安装 SDK" code={snippets.install} language="bash" />
                <CodeBlock title="初始化与使用" code={snippets.javascript} language="javascript" />
              </>
            ),
          },
          {
            key: 'react',
            label: 'React',
            children: (
              <CodeBlock title="React Hook 集成示例" code={snippets.react} language="jsx" />
            ),
          },
          {
            key: 'node',
            label: 'Node.js (后端)',
            children: (
              <CodeBlock
                title="服务端验签 Access Token"
                code={snippets.node}
                language="javascript"
              />
            ),
          },
          {
            key: 'curl',
            label: 'cURL',
            children: (
              <>
                <CodeBlock
                  title="OIDC Discovery（获取所有端点）"
                  code={snippets.discoveryCurl}
                  language="bash"
                />
                <CodeBlock
                  title="使用 Access Token 获取用户信息"
                  code={snippets.userinfoCurl}
                  language="bash"
                />
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
}

function CodeBlock({ title, code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      message.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: '#1f1f1f',
          color: '#bbb',
          borderRadius: '6px 6px 0 0',
          fontSize: 12,
        }}
      >
        <Space size={8}>
          <Text style={{ color: '#bbb', fontSize: 12 }}>{title}</Text>
          <Text style={{ color: '#666', fontSize: 11 }}>{language}</Text>
        </Space>
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          style={{ color: copied ? '#52c41a' : '#bbb' }}
          onClick={handleCopy}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre
        style={{
          background: '#282c34',
          color: '#abb2bf',
          padding: 16,
          margin: 0,
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: "'SF Mono', Monaco, Menlo, Consolas, monospace",
          borderRadius: '0 0 6px 6px',
          overflow: 'auto',
          maxHeight: 320,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function buildSnippets(app) {
  const { clientId, origin } = app;

  return {
    install: `npm install @your-org/oauth2-js-sdk
# 或
yarn add @your-org/oauth2-js-sdk`,

    javascript: `import { OAuth2Client } from '@your-org/oauth2-js-sdk';

// 1. 初始化（应用启动时执行一次）
const oauth2 = new OAuth2Client({
  serverUrl: '${OAUTH2_SERVER_URL}',
  clientId: '${clientId}',
  redirectUri: '${origin}/callback', // 该 URI 必须是 ${origin} 的子路径
  scope: 'openid profile',
});

// 2. 路由守卫：判断登录状态
if (!oauth2.isAuthenticated()) {
  oauth2.login(); // 跳转到 OAuth2 登录页
}

// 3. 回调路由：处理 callback?code=xxx
if (window.location.pathname === '/callback') {
  await oauth2.handleCallback();
  window.location.href = '/'; // 登录成功，跳回首页
}

// 4. 拉取用户信息
const user = await oauth2.getUserInfo();
console.log('当前登录用户:', user);

// 5. 退出登录
oauth2.logout();`,

    react: `import { useEffect, useState } from 'react';
import { OAuth2Client } from '@your-org/oauth2-js-sdk';

const oauth2 = new OAuth2Client({
  serverUrl: '${OAUTH2_SERVER_URL}',
  clientId: '${clientId}',
  redirectUri: '${origin}/callback',
  scope: 'openid profile',
});

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // 处理 OAuth 回调
      if (window.location.search.includes('code=')) {
        await oauth2.handleCallback();
        window.history.replaceState({}, '', '/');
      }
      // 检查登录状态
      if (oauth2.isAuthenticated()) {
        const u = await oauth2.getUserInfo();
        setUser(u);
      }
      setLoading(false);
    })();
  }, []);

  return {
    user,
    loading,
    login: () => oauth2.login(),
    logout: () => oauth2.logout(),
  };
}`,

    node: `const jwt = require('jsonwebtoken');
const axios = require('axios');

// 1. 启动时拉取 JWKS（生产环境推荐缓存 1 小时）
async function getJwks() {
  const { data } = await axios.get('${OAUTH2_SERVER_URL}/.well-known/jwks.json');
  return data.keys;
}

// 2. Express 中间件：校验请求头里的 Bearer Token
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'missing_token' });

  try {
    // 调用 OAuth2 的 userinfo 端点验证 token 并拉取用户信息
    const { data } = await axios.get('${OAUTH2_SERVER_URL}/v1/oauth/userinfo', {
      headers: { Authorization: \`Bearer \${token}\` },
    });
    req.user = data;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// 3. 在受保护路由上挂载中间件
app.get('/api/private', authMiddleware, (req, res) => {
  res.json({ message: \`Hello \${req.user.name}\` });
});`,

    discoveryCurl: `# 获取 OAuth2 服务的所有元数据（端点 / scope / 算法等）
curl ${OAUTH2_SERVER_URL}/.well-known/openid-configuration | jq`,

    userinfoCurl: `# 用 Access Token 获取当前登录用户信息
curl -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \\
  ${OAUTH2_SERVER_URL}/v1/oauth/userinfo | jq`,
  };
}
