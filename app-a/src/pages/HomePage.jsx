import React from 'react';
import {
  Layout, Card, Button, Typography, Space, Tag, Table, Avatar,
  Descriptions, Badge, Divider, message, Spin, Result, Alert,
} from 'antd';
import {
  UserOutlined, LogoutOutlined, SafetyCertificateOutlined,
  AppstoreOutlined, ReloadOutlined, LinkOutlined, CheckCircleOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import axios from 'axios';

const { Header, Content, Footer } = Layout;
const { Title, Text, Paragraph } = Typography;

const OAUTH2_SERVER = 'http://localhost:3000';

/**
 * 获取受保护数据
 */
async function fetchProtectedData(accessToken) {
  const response = await axios.get(`${OAUTH2_SERVER}/v1/api/protected/data`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

export default function HomePage({ appName, appPort, themeColor }) {
  // OAuth2 已在 index.html 的 initOAuth2() 中完成，index.jsx 等待 window.__OAUTH2_PROMISE__ 后才渲染
  // 所以此处 window.__GLOBAL_USER_INFO__ 和 window.__OAuth2ClientSDK__ 一定已有值，直接读取即可
  const userInfo = window.__GLOBAL_USER_INFO__;
  const accessToken = window.__OAuth2ClientSDK__?.getAccessToken();

  const [logoutLoading, setLogoutLoading] = React.useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // 获取受保护数据
  const {
    data: protectedData,
    loading: dataLoading,
    run: loadProtectedData,
    error: dataError,
  } = useRequest(() => fetchProtectedData(window.__OAuth2ClientSDK__?.getAccessToken()), {
    manual: true,
    onError: (error) => {
      if (error.response?.status === 401) {
        messageApi.error('登录已过期，请重新授权');
        window.__OAuth2ClientSDK__?.logout();
      }
    },
  });

  // 单点登出：调用 SDK 的 logout()，SDK 内部会清除 Cookie、跳转登录页
  function handleLogout() {
    setLogoutLoading(true);
    window.__OAuth2ClientSDK__?.logout();
  }

  // 未登录保护（正常情况不会触发，OAuth2 未完成时 React 不会渲染）
  if (!userInfo) {
    return (
      <div style={styles.loadingContainer}>
        <Spin size="large" tip="正在 OAuth2 授权中..." />
        <Text type="secondary" style={{ marginTop: 16, display: 'block' }}>
          正在跳转到 OAuth2 授权服务器...
        </Text>
      </div>
    );
  }

  const tableColumns = [
    { title: '订单', dataIndex: 'title', key: 'title' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (status) => {
        const colorMap = { '已完成': 'success', '处理中': 'processing', '待支付': 'warning' };
        return <Badge status={colorMap[status] || 'default'} text={status} />;
      },
    },
    { title: '金额', dataIndex: 'amount', key: 'amount' },
  ];

  return (
    <Layout style={styles.layout}>
      {contextHolder}

      <Header style={{ ...styles.header, background: themeColor }}>
        <div style={styles.headerLeft}>
          <AppstoreOutlined style={styles.headerIcon} />
          <Title level={4} style={styles.headerTitle}>{appName}</Title>
          <Tag color="blue" style={{ marginLeft: 8 }}>OAuth2</Tag>
        </div>
        <div style={styles.headerRight}>
          <Space>
            <Avatar style={{ backgroundColor: 'rgba(255,255,255,0.3)', color: '#fff' }} icon={<UserOutlined />} />
            <Text style={{ color: '#fff', fontWeight: 500 }}>{userInfo.name}</Text>
            <Tag color={userInfo.role === 'admin' ? 'gold' : 'cyan'}>
              {userInfo.role === 'admin' ? '管理员' : '普通用户'}
            </Tag>
            <Button
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              loading={logoutLoading}
              style={styles.logoutButton}
              size="small"
            >
              登出
            </Button>
          </Space>
        </div>
      </Header>

      <Content style={styles.content}>
        <Alert
          message="🎉 OAuth2 授权码流程登录成功"
          description={`已通过 OAuth2 授权服务器完成授权，scope: ${window.__OAuth2ClientSDK__?.scope}`}
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 24 }}
          closable
        />

        <div style={styles.grid}>
          {/* OAuth2 认证信息卡片 */}
          <Card
            title={<Space><KeyOutlined style={{ color: themeColor }} /><span>OAuth2 认证信息</span></Space>}
            style={styles.card}
          >
            <Descriptions column={1} size="small">
              <Descriptions.Item label="用户 ID">{userInfo.sub}</Descriptions.Item>
              <Descriptions.Item label="用户名">{userInfo.username}</Descriptions.Item>
              <Descriptions.Item label="姓名">{userInfo.name}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{userInfo.email}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={userInfo.role === 'admin' ? 'gold' : 'cyan'}>
                  {userInfo.role === 'admin' ? '管理员' : '普通用户'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="授权范围"><Text code>{window.__OAuth2ClientSDK__?.scope}</Text></Descriptions.Item>
              <Descriptions.Item label="Token 状态"><Badge status="success" text="有效" /></Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '12px 0' }} />

            <div style={styles.tokenBox}>
              <Text type="secondary" style={{ fontSize: 11 }}>Access Token（JWT）</Text>
              <Paragraph
                copyable={{ text: accessToken }}
                style={styles.tokenText}
                ellipsis={{ rows: 2 }}
              >
                {accessToken}
              </Paragraph>
            </div>
          </Card>

          {/* 单点登录演示卡片 */}
          <Card
            title={<Space><LinkOutlined style={{ color: themeColor }} /><span>OAuth2 演示</span></Space>}
            style={styles.card}
          >
            <Paragraph type="secondary">
              跳转到应用 B，无需重新授权，体验 OAuth2 单点登录效果。
            </Paragraph>

            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                type="primary"
                block
                icon={<LinkOutlined />}
                href="http://localhost:3003"
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
              >
                跳转到应用 B（localhost:3003）
              </Button>
              <Button block icon={<LogoutOutlined />} onClick={handleLogout} loading={logoutLoading} danger>
                单点登出（撤销所有 Session）
              </Button>
            </Space>

            <Divider />

            <div style={styles.flowBox}>
              <Text strong style={{ fontSize: 12 }}>OAuth2 授权码流程：</Text>
              <div style={{ marginTop: 8 }}>
                {[
                  '① 应用重定向到 /oauth/authorize',
                  '② 授权服务器验证身份（oauth2-login）',
                  '③ 用户登录，生成 Authorization Code',
                  '④ 携带 Code 重定向回',
                  '⑤ 应用用 Code + Secret 换取 Access Token',
                  '⑥ 用 Access Token 请求 /oauth/userinfo',
                  '⑦ 获取用户信息，登录完成',
                  '⑧ Refresh Token 自动续期（7天有效）',
                ].map((step, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6, fontSize: 11 }} />
                    <Text style={{ fontSize: 11 }}>{step}</Text>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* 受保护数据 */}
        <Card
          title={
            <Space>
              <SafetyCertificateOutlined style={{ color: themeColor }} />
              <span>受保护的业务数据</span>
              <Tag color="orange">需要 OAuth2 Access Token</Tag>
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadProtectedData} loading={dataLoading} type="primary" ghost>
              加载数据
            </Button>
          }
          style={{ marginTop: 24 }}
        >
          {!protectedData && !dataLoading && !dataError && (
            <Result
              icon={<SafetyCertificateOutlined style={{ color: themeColor }} />}
              title="点击「加载数据」获取受 OAuth2 保护的业务数据"
              subTitle="请求将携带 Access Token，由授权服务器验证权限"
            />
          )}
          {dataLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="请求受保护数据中..." /></div>}
          {protectedData?.data && (
            <>
              <Alert message={protectedData.data.message} type="success" showIcon style={{ marginBottom: 16 }} />
              <Table dataSource={protectedData.data.items} columns={tableColumns} rowKey="id" pagination={false} size="small" />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                访问时间：{protectedData.data.accessTime}
              </Text>
            </>
          )}
        </Card>
      </Content>

      <Footer style={styles.footer}>
        <Text type="secondary">
          OAuth2 Demo · {appName} · 端口 {appPort} · Auth Server: localhost:3000
        </Text>
      </Footer>
    </Layout>
  );
}

const styles = {
  layout: { minHeight: '100vh', background: '#f5f7fa' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 22, color: '#fff' },
  headerTitle: { color: '#fff', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center' },
  logoutButton: {
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
  },
  content: { padding: '24px', maxWidth: 1100, margin: '0 auto', width: '100%' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  card: { borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  tokenBox: { background: '#f6f8fa', borderRadius: 8, padding: '10px 12px' },
  tokenText: { fontSize: 11, fontFamily: 'monospace', color: '#666', margin: '4px 0 0', wordBreak: 'break-all' },
  flowBox: { background: '#f6f8fa', borderRadius: 8, padding: '12px 14px' },
  loadingContainer: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#f5f7fa',
  },
  footer: { textAlign: 'center', background: 'transparent' },
};
