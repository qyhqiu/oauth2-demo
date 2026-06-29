import { useState, useEffect, lazy, Suspense } from 'react';
import { BackButton } from '../../components/common';
import {
  Card,
  Typography,
  Tabs,
  Button,
  Form,
  Input,
  Space,
  Tag,
  Tooltip,
  message,
  Popconfirm,
  Spin,
  Descriptions,
  Row,
  Col,
  Switch,
  InputNumber,
  Select,
  Divider,
  Alert,
  Table,
  Avatar,
} from 'antd';
// 注意：ColorPicker 已抽到 BrandingForm 中懒加载，本文件不再直接 import
import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  BarChartOutlined,
  SaveOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ReloadOutlined,
  KeyOutlined,
  LockOutlined,
  MessageOutlined,
  QrcodeOutlined,
  ShareAltOutlined,
  BankOutlined,
  LoginOutlined,
  TeamOutlined,
  CalendarOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getApp,
  updateApp,
  deleteApp,
  refreshAppSecret,
  getSocialConnections,
  getAppSummary,
  getAppLoggedInUsers,
} from '../../api/index';
import './AppDetailPage.scss';

// 重组件懒加载（图表 + 教程 Modal + 审计日志表 + 品牌化表单 体积较大，且非首屏必需）
// BrandingForm 内部依赖 antd ColorPicker（重型组件），独立 chunk 后只有点开「品牌化」Tab 才会下载
// GeoDistributionMap 依赖 echarts + world.json（约 1MB），独立 chunk 仅在"数据概览"Tab 加载
const LoginTrendChart = lazy(() => import('./components/LoginTrendChart'));
const IntegrationGuideModal = lazy(() => import('./components/IntegrationGuideModal'));
const AuditLogTable = lazy(() => import('./components/AuditLogTable'));
const BrandingForm = lazy(() => import('./components/BrandingForm'));
const GeoDistributionMap = lazy(() => import('./components/GeoDistributionMap'));
const AccessControlPanel = lazy(() => import('./components/AccessControlPanel'));

const { Title, Text, Paragraph } = Typography;

// OAuth2 Server 地址（本地开发）
const OAUTH2_SERVER_URL = 'http://localhost:3000';

const SCOPE_OPTIONS = [
  { label: 'openid', value: 'openid' },
  { label: 'profile', value: 'profile' },
  { label: 'email', value: 'email' },
  { label: 'phone', value: 'phone' },
];

const ROLE_OPTIONS = [
  { label: '管理员（admin）', value: 'admin' },
  { label: '普通用户（user）', value: 'user' },
];

// 默认策略，避免老数据缺失字段时表单显示异常
const DEFAULT_ENABLED_LOGIN_METHODS = {
  password: true,
  verifyCode: true,
  qrcode: false,
  social: false,
  enterprise: false,
};
const DEFAULT_LOGIN_POLICY = {
  allowRegister: false,
  maxLoginFailures: 5,
  lockoutDurationMinutes: 30,
  ssoEnabled: true,
  enabledLoginMethods: DEFAULT_ENABLED_LOGIN_METHODS,
};

// K3：应用类型 → 是否 Confidential（强制 secret 校验）
// 与后端 services/clientService.js#CONFIDENTIAL_CLIENT_TYPES 保持一致
const CONFIDENTIAL_CLIENT_TYPES = new Set(['native', 'service', 'miniapp']);
const CLIENT_TYPE_LABEL = {
  web: '标准 Web 应用',
  spa: '单页 Web 应用',
  native: '客户端应用',
  service: '后端应用',
  miniapp: '小程序应用',
};

// K4：5 种登录方式定义（仅持久化字段，Demo 演示用）
// 文档：https://docs.authing.cn/v2/guides/app-new/create-app/login-control.html
const LOGIN_METHODS = [
  {
    key: 'password',
    label: '账号密码登录',
    icon: <LockOutlined />,
    desc: '用户名 / 手机号 / 邮箱 + 密码登录',
  },
  {
    key: 'verifyCode',
    label: '短信 / 邮箱 + 验证码',
    icon: <MessageOutlined />,
    desc: '手机号 / 邮箱 + 一次性验证码登录（无密码）',
  },
  {
    key: 'qrcode',
    label: '移动端 APP 扫码登录',
    icon: <QrcodeOutlined />,
    desc: '移动端 APP 扫描二维码授权登录（Demo 仅作字段标识）',
  },
  {
    key: 'social',
    label: '社会化身份源登录',
    icon: <ShareAltOutlined />,
    desc: '微信 / GitHub / Google 等第三方账号登录（Demo 仅作字段标识）',
  },
  {
    key: 'enterprise',
    label: '企业身份源登录',
    icon: <BankOutlined />,
    desc: '钉钉 / 飞书 / Active Directory 等企业 IdP（Demo 仅作字段标识）',
  },
];
const DEFAULT_ACCESS_POLICY = {
  requirePkce: true,
  tokenExpiresInSeconds: 7200,
};
const DEFAULT_BRANDING = {
  logoUrl: '',
  primaryColor: '#5b50e8',
  welcomeText: '',
  copyright: '',
};

export default function AppDetailPage() {
  const navigate = useNavigate();
  const { clientId } = useParams();
  const [form] = Form.useForm();
  const [loginForm] = Form.useForm();
  const [accessForm] = Form.useForm();
  const [securityForm] = Form.useForm();
  // brandForm 已下放到 BrandingForm 组件内部（懒加载场景下不能在父组件持有 form 实例）
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState('config');
  const [guideOpen, setGuideOpen] = useState(false);
  const [linkedSocialIds, setLinkedSocialIds] = useState([]);
  const socialEnabled = Form.useWatch(['enabledLoginMethods', 'social'], loginForm);
  const redirectUris = Form.useWatch('redirectUris', form);

  // K3：详情页用单查询接口（GET /apps/:id），它会返回 clientSecret；列表接口不返回
  // useRequest defaultParams 把 clientId 传给 getApp
  const {
    data: detailResp,
    loading,
    refresh,
  } = useRequest(() => getApp(clientId), {
    refreshDeps: [clientId],
  });
  const app = detailResp?.data;

  // 应用统计数据（数据概览 Tab 用）
  const { data: summaryResp } = useRequest(() => getAppSummary(clientId), {
    refreshDeps: [clientId],
  });
  const summary = summaryResp?.data || {};

  // 已登录用户列表（登录控制 Tab 用）
  const { data: loggedInUsersResp, loading: loggedInUsersLoading } = useRequest(
    () => getAppLoggedInUsers(clientId),
    { refreshDeps: [clientId] },
  );
  const loggedInUsers = loggedInUsersResp?.data || [];

  // K3：App Secret 显示/隐藏控制
  const [secretVisible, setSecretVisible] = useState(false);

  // 获取所有社会化身份源（登录控制 Tab 用）
  const { data: allSocialConnections = [] } = useRequest(async () => {
    const res = await getSocialConnections();
    return res?.data || [];
  });

  useEffect(() => {
    if (app) {
      form.setFieldsValue({
        name: app.name,
        origin: app.origin,
        redirectUris: app.redirectUris || [],
        postLoginRedirectUri: app.postLoginRedirectUri || '',
        description: app.description || '',
        scope: app.scope || ['openid', 'profile'],
      });
      // K4：登录方式开关合入 loginPolicy 同表单（同一个 Save 按钮一起提交）
      loginForm.setFieldsValue({
        ...DEFAULT_LOGIN_POLICY,
        ...(app.loginPolicy || {}),
        enabledLoginMethods: {
          ...DEFAULT_ENABLED_LOGIN_METHODS,
          ...(app.loginPolicy?.enabledLoginMethods || {}),
        },
      });
      accessForm.setFieldsValue({ ...DEFAULT_ACCESS_POLICY, ...(app.accessPolicy || {}) });
      // 安全管理表单：从 loginPolicy 和 accessPolicy 中提取字段
      const lp = { ...DEFAULT_LOGIN_POLICY, ...(app.loginPolicy || {}) };
      const ap = { ...DEFAULT_ACCESS_POLICY, ...(app.accessPolicy || {}) };
      securityForm.setFieldsValue({
        allowRegister: lp.allowRegister,
        maxLoginFailures: lp.maxLoginFailures,
        lockoutDurationMinutes: lp.lockoutDurationMinutes,
        requirePkce: ap.requirePkce,
        tokenExpiresInSeconds: ap.tokenExpiresInSeconds,
      });
      // 初始化社会化身份源关联
      setLinkedSocialIds(app.socialConnectionIds || []);
      // branding 表单由 BrandingForm 子组件自己用 initialValue 初始化
    }
  }, [app, form, loginForm, accessForm, securityForm]);

  // K3：刷新 Secret
  const { loading: refreshingSecret, runAsync: runRefreshSecret } = useRequest(refreshAppSecret, {
    manual: true,
    onSuccess: (res) => {
      messageApi.success('App Secret 已重置，请妥善保存');
      // 重置后立即显示，方便用户复制
      setSecretVisible(true);
      refresh();
      // 把新 secret 复制到剪贴板，避免用户手动选中
      const newSecret = res?.data?.clientSecret;
      if (newSecret) {
        navigator.clipboard.writeText(newSecret).catch(() => {});
      }
    },
    onError: (err) => messageApi.error(err?.error_description || '刷新失败'),
  });

  const { loading: saving, runAsync: runSave } = useRequest(
    (values) => updateApp(clientId, values),
    {
      manual: true,
      onSuccess: () => {
        messageApi.success('保存成功');
        refresh();
      },
      onError: (err) => messageApi.error(err?.error_description || '保存失败'),
    },
  );

  const { runAsync: runDelete } = useRequest(deleteApp, {
    manual: true,
    onSuccess: () => {
      messageApi.success('应用已删除');
      navigate('/apps', { replace: true });
    },
    onError: (err) => messageApi.error(err?.error_description || '删除失败'),
  });

  const handleSave = async () => {
    const values = await form.validateFields();
    await runSave(values);
  };

  // 安全管理 Tab 保存：同时写入 loginPolicy 和 accessPolicy
  const handleSaveSecurity = async () => {
    const values = await securityForm.validateFields();
    const currentLogin = loginForm.getFieldsValue();
    const currentAccess = accessForm.getFieldsValue();
    // 将安全字段回写到对应的 policy 中
    const updatedLoginPolicy = {
      ...currentLogin,
      allowRegister: values.allowRegister,
      maxLoginFailures: values.maxLoginFailures,
      lockoutDurationMinutes: values.lockoutDurationMinutes,
    };
    const updatedAccessPolicy = {
      ...currentAccess,
      requirePkce: values.requirePkce,
      tokenExpiresInSeconds: values.tokenExpiresInSeconds,
    };
    // 同步更新关联表单（保持一致性）
    loginForm.setFieldsValue(updatedLoginPolicy);
    accessForm.setFieldsValue(updatedAccessPolicy);
    await runSave({
      loginPolicy: updatedLoginPolicy,
      accessPolicy: updatedAccessPolicy,
      socialConnectionIds: linkedSocialIds,
    });
    messageApi.success('安全管理 已保存');
  };

  // handleSaveBranding 已迁移到 BrandingForm 组件内部（懒加载组件自治）

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    messageApi.success(`${label || '内容'}已复制`);
  };

  // 体验登录：直接跳转到该应用的首页（应用 SDK 会自动触发 OAuth2 登录）
  const handleExperienceLogin = () => {
    if (!app?.origin) return;
    window.open(app.origin, '_blank');
  };

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="page-container">
        <BackButton />
        <Card bordered={false} style={{ marginTop: 16, textAlign: 'center', padding: 40 }}>
          <Text type="secondary">应用不存在或已被删除</Text>
        </Card>
      </div>
    );
  }

  // OAuth2 / OIDC 端点信息（参考 Authing 详情页）
  // App Secret 单独渲染（带显示/隐藏/刷新逻辑），不放在 endpoints 数组里
  const endpoints = [
    { label: 'App ID', value: app.clientId },
    { label: 'Issuer', value: OAUTH2_SERVER_URL },
    { label: '服务发现地址', value: `${OAUTH2_SERVER_URL}/.well-known/openid-configuration` },
    { label: 'JWKS 公钥端点', value: `${OAUTH2_SERVER_URL}/.well-known/jwks.json` },
    { label: 'Token 端点', value: `${OAUTH2_SERVER_URL}/v1/oauth/token` },
    { label: '用户信息端点', value: `${OAUTH2_SERVER_URL}/v1/oauth/userinfo` },
    { label: '授权端点', value: `${OAUTH2_SERVER_URL}/v1/oauth/authorize` },
    { label: '登出端点', value: `${OAUTH2_SERVER_URL}/v1/oauth/logout` },
  ];

  // K3：当前应用类型 + 是否需要强制 secret 校验
  const clientTypeLabel = CLIENT_TYPE_LABEL[app.clientType] || '标准 Web 应用';
  const isConfidential = CONFIDENTIAL_CLIENT_TYPES.has(app.clientType);
  const appSecret = app.clientSecret || '';
  const maskedSecret = appSecret
    ? `${appSecret.slice(0, 6)}${'•'.repeat(20)}${appSecret.slice(-4)}`
    : '—';

  return (
    <div className="app-detail-page page-container">
      {contextHolder}

      <div className="app-detail-page__back">
        <BackButton />
      </div>

      {/* 顶部信息栏 */}
      <div className="app-detail-page__header">
        <Space size={16} align="center">
          <div className="app-detail-page__icon">
            <ApiOutlined />
          </div>
          <div>
            <Title level={4} className="page-title">
              {app.name}
            </Title>
            <Tag color="purple">{clientTypeLabel}</Tag>
            {isConfidential && (
              <Tag color="gold" style={{ marginLeft: 6 }}>
                Confidential（需 Secret）
              </Tag>
            )}
          </div>
        </Space>

        <Space size={8}>
          <Button icon={<BarChartOutlined />} onClick={() => setActiveTab('overview')}>
            数据概览
          </Button>
          <Button icon={<ReadOutlined />} onClick={() => setGuideOpen(true)}>
            接入教程
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleExperienceLogin}
            className="app-detail-page__experience-btn"
          >
            体验登录
          </Button>
        </Space>
      </div>

      {/* Tab 切换 */}
      <Card bordered={false} className="app-detail-page__tabs">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          destroyInactiveTabPane
          items={[
            {
              key: 'overview',
              label: '数据概览',
              children: (
                <div className="app-detail-page__overview">
                  <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                    {[
                      {
                        title: '总登录次数',
                        value: summary.totalLogins,
                        suffix: '次',
                        icon: <LoginOutlined />,
                        color: '#5b50e8',
                        bg: '#eeedfc',
                      },
                      {
                        title: '总用户数',
                        value: summary.totalUsers,
                        suffix: '人',
                        icon: <TeamOutlined />,
                        color: '#52c41a',
                        bg: '#e8f7e2',
                      },
                      {
                        title: '今日登录次数',
                        value: summary.todayLogins,
                        suffix: '次',
                        icon: <CalendarOutlined />,
                        color: '#1677ff',
                        bg: '#e6f4ff',
                      },
                      {
                        title: '今日登录用户',
                        value: summary.todayUsers,
                        suffix: '人',
                        icon: <CheckCircleOutlined />,
                        color: '#13c2c2',
                        bg: '#e6fffb',
                      },
                      {
                        title: '今日新增用户',
                        value: summary.todayNewUsers,
                        suffix: '人',
                        icon: <UserAddOutlined />,
                        color: '#fa8c16',
                        bg: '#fff7e6',
                      },
                    ].map((item) => (
                      <Col key={item.title} xs={12} sm={8} md={6} lg={4}>
                        <Card
                          bordered={false}
                          style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                          bodyStyle={{
                            padding: '20px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                          }}
                        >
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 10,
                              background: item.bg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 20,
                              color: item.color,
                              flexShrink: 0,
                            }}
                          >
                            {item.icon}
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 22,
                                fontWeight: 600,
                                color: item.color,
                                lineHeight: 1.2,
                              }}
                            >
                              {item.value ?? '-'}
                            </div>
                            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
                              {item.title}
                            </div>
                          </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  <Section title="登录趋势（最近 7 天）">
                    <Suspense
                      fallback={
                        <div style={{ padding: 40, textAlign: 'center' }}>
                          <Spin />
                        </div>
                      }
                    >
                      <LoginTrendChart clientId={clientId} days={7} />
                    </Suspense>
                  </Section>

                  <Section title="登录地理分布">
                    <Suspense
                      fallback={
                        <div style={{ padding: 40, textAlign: 'center' }}>
                          <Spin />
                        </div>
                      }
                    >
                      <GeoDistributionMap clientId={clientId} days={30} />
                    </Suspense>
                  </Section>

                  <Section title="基础信息">
                    <Descriptions
                      column={2}
                      size="small"
                      colon
                      labelStyle={{ width: 120, color: '#8c8c8c' }}
                    >
                      <Descriptions.Item label="App ID">
                        <code className="mono-code">{app.clientId}</code>
                      </Descriptions.Item>
                      <Descriptions.Item label="Origin">
                        <a href={app.origin} target="_blank" rel="noreferrer">
                          {app.origin}
                        </a>
                      </Descriptions.Item>
                      <Descriptions.Item label="授权 Scope">
                        {(app.scope || []).map((s) => (
                          <Tag key={s} color="blue">
                            {s}
                          </Tag>
                        ))}
                      </Descriptions.Item>
                      <Descriptions.Item label="创建时间">
                        {app.createdAt ? new Date(app.createdAt).toLocaleString('zh-CN') : '-'}
                      </Descriptions.Item>
                    </Descriptions>
                  </Section>
                </div>
              ),
            },
            {
              key: 'config',
              label: '应用配置',
              children: (
                <div className="app-detail-page__config">
                  {/* 基本信息 */}
                  <Section title="基本信息">
                    <Row gutter={32}>
                      <Col span={16}>
                        <Form form={form} layout="vertical" requiredMark="optional">
                          <Form.Item
                            label="应用名称"
                            name="name"
                            rules={[{ required: true, message: '请输入应用名称' }]}
                          >
                            <Input maxLength={32} />
                          </Form.Item>
                          <Form.Item
                            label="认证地址（必填）"
                            name="origin"
                            tooltip="应用的 Origin 地址，用于 OAuth2 授权码流程中 redirect_uri 的 origin 匹配校验"
                            rules={[
                              { required: true, message: '请输入认证地址' },
                              {
                                pattern: /^https?:\/\/[^\s]+$/,
                                message: '认证地址必须以 http:// 或 https:// 开头',
                              },
                            ]}
                          >
                            <Input placeholder="如：http://localhost:3002 或 https://app.example.com" />
                          </Form.Item>
                          <Form.Item
                            label="认证回调地址"
                            tooltip="OAuth2 授权码流程回调地址，可注册多个。回调地址必须与认证地址同源。"
                            name="redirectUris"
                            rules={[
                              { type: 'array', required: true, message: '请至少添加一个回调地址' },
                              {
                                validator: async (_, value) => {
                                  const invalid = value.find(
                                    (uri) => !/^https?:\/\/[^\s]+$/.test(uri),
                                  );
                                  if (invalid) {
                                    return Promise.reject(
                                      new Error('回调地址必须以 http:// 或 https:// 开头'),
                                    );
                                  }
                                  return Promise.resolve();
                                },
                              },
                            ]}
                          >
                            <Select
                              mode="tags"
                              allowClear
                              showSearch
                              placeholder="请输入或选择认证回调地址，输入后按回车确认"
                              tokenSeparators={[',']}
                              options={(redirectUris || []).map((uri) => ({
                                label: uri,
                                value: uri,
                              }))}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                          <Form.Item
                            label="登录回调URL（选填）"
                            name="postLoginRedirectUri"
                            tooltip="用户登录成功后浏览器跳转的目标地址。如果不填，浏览器端 SDK 默认使用 window.location.href"
                            rules={[
                              {
                                pattern: /^https?:\/\/[^\s]*$/,
                                message: '回调URL必须以 http:// 或 https:// 开头',
                              },
                            ]}
                          >
                            <Input placeholder="如：https://app.example.com/dashboard（不填则使用当前页面地址）" />
                          </Form.Item>
                          <Form.Item label="应用描述" name="description">
                            <Input.TextArea rows={3} placeholder="请输入应用描述" />
                          </Form.Item>
                          <Form.Item label="授权 Scope" name="scope">
                            <Select
                              mode="multiple"
                              options={SCOPE_OPTIONS}
                              placeholder="选择授权范围"
                            />
                          </Form.Item>

                          <Space>
                            <Button
                              type="primary"
                              icon={<SaveOutlined />}
                              loading={saving}
                              onClick={handleSave}
                            >
                              保存修改
                            </Button>
                            <Popconfirm
                              title={`确定删除应用「${app.name}」吗？`}
                              description="该操作不可恢复，删除后所有用户将无法登录该应用"
                              onConfirm={() => runDelete(app.clientId)}
                              okText="删除"
                              okButtonProps={{ danger: true }}
                              cancelText="取消"
                            >
                              <Button danger icon={<DeleteOutlined />}>
                                删除应用
                              </Button>
                            </Popconfirm>
                          </Space>
                        </Form>
                      </Col>

                      <Col span={8}>
                        <div className="app-detail-page__logo-block">
                          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                            应用 Logo
                          </Text>
                          <div className="app-detail-page__logo">
                            <ApiOutlined />
                          </div>
                        </div>
                      </Col>
                    </Row>
                  </Section>

                  {/* 端点信息 */}
                  <Section title="端点信息">
                    <Descriptions
                      column={2}
                      size="small"
                      colon={false}
                      labelStyle={{ width: 140, color: '#8c8c8c' }}
                    >
                      {endpoints.map((ep) => (
                        <Descriptions.Item key={ep.label} label={ep.label}>
                          <Space size={4} className="endpoint-value">
                            <code className="mono-code">{ep.value}</code>
                            <Tooltip title="复制">
                              <CopyOutlined
                                className="copy-icon"
                                onClick={() => copy(ep.value, ep.label)}
                              />
                            </Tooltip>
                          </Space>
                        </Descriptions.Item>
                      ))}

                      {/* K3：App Secret —— 默认掩码显示，支持「显示/隐藏/复制/刷新」 */}
                      <Descriptions.Item
                        label={
                          <Space size={4}>
                            <KeyOutlined />
                            <span>App Secret</span>
                          </Space>
                        }
                        span={2}
                      >
                        <Space size={8} className="endpoint-value app-secret-row">
                          <code className="mono-code app-secret-code">
                            {appSecret ? (secretVisible ? appSecret : maskedSecret) : '—'}
                          </code>
                          {appSecret && (
                            <Tooltip title={secretVisible ? '隐藏' : '显示'}>
                              <Button
                                type="text"
                                size="small"
                                icon={secretVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                onClick={() => setSecretVisible(!secretVisible)}
                              />
                            </Tooltip>
                          )}
                          {appSecret && (
                            <Tooltip title="复制">
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => copy(appSecret, 'App Secret')}
                              />
                            </Tooltip>
                          )}
                          <Popconfirm
                            title="重置 App Secret？"
                            description="旧 Secret 立即失效，所有使用旧 Secret 的服务端调用将失败，请提前同步给业务方。已颁发的 access_token / refresh_token 不受影响。"
                            onConfirm={() => runRefreshSecret(app.clientId)}
                            okText="确认重置"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                          >
                            <Tooltip title="重新生成 App Secret">
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<ReloadOutlined spin={refreshingSecret} />}
                                loading={refreshingSecret}
                              >
                                刷新
                              </Button>
                            </Tooltip>
                          </Popconfirm>
                        </Space>
                      </Descriptions.Item>
                    </Descriptions>

                    {isConfidential ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 12 }}
                        message={`当前应用类型为「${clientTypeLabel}」（Confidential Client）`}
                        description={
                          <span>
                            调用 <code>POST /oauth/token</code> 时必须携带{' '}
                            <code>client_secret</code>（body 或 HTTP Basic Auth），否则服务端返回{' '}
                            <code>401 invalid_client</code>。 请妥善保管 Secret，切勿在前端代码 /
                            客户端 APP 中硬编码。
                          </span>
                        }
                      />
                    ) : (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginTop: 12 }}
                        message={`当前应用类型为「${clientTypeLabel}」（Public Client）`}
                        description="按 OAuth2.1 规范走 PKCE 流程，无需 client_secret 即可换取 Token；Secret 仅作为字段保留。"
                      />
                    )}
                  </Section>
                </div>
              ),
            },
            {
              key: 'login',
              label: '登录控制',
              children: (
                <div className="app-detail-page__login-policy">
                  <Section title="登录控制">
                    <Form
                      form={loginForm}
                      layout="horizontal"
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 14 }}
                      style={{ maxWidth: 720 }}
                    >
                      <Form.Item
                        label="启用 OAuth2 单点登录"
                        name="ssoEnabled"
                        valuePropName="checked"
                        extra="关闭后用户在该应用登录不会写入 OAuth2 Cookie，跨应用免登失效"
                      >
                        <Switch
                          onChange={(checked) =>
                            runSave({
                              loginPolicy: { ...loginForm.getFieldsValue(), ssoEnabled: checked },
                            })
                          }
                        />
                      </Form.Item>

                      <Divider
                        orientation="left"
                        plain
                        style={{ margin: '24px 0 12px', fontSize: 13, color: '#8c8c8c' }}
                      >
                        登录方式
                      </Divider>

                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16, marginLeft: 24 }}
                        message="参考 Authing 登录控制规范"
                        description={
                          <span>
                            可在此控制登录页展示哪些登录入口。当前 Demo 仅做字段持久化，
                            <code>oauth2-login</code> 页面已有的"密码 + 验证码"两个 Tab 不变；扫码 /
                            社会化 / 企业身份源属于扩展接入位，后续可基于此字段联动渲染。
                          </span>
                        }
                      />

                      {LOGIN_METHODS.map((m) => (
                        <Form.Item
                          key={m.key}
                          label={
                            <Space size={6}>
                              <span style={{ color: '#5b50e8' }}>{m.icon}</span>
                              <span>{m.label}</span>
                            </Space>
                          }
                          name={['enabledLoginMethods', m.key]}
                          valuePropName="checked"
                          extra={m.desc}
                        >
                          <Switch
                            onChange={(checked) => {
                              const current = loginForm.getFieldsValue();
                              runSave({
                                loginPolicy: {
                                  ...current,
                                  enabledLoginMethods: {
                                    ...current.enabledLoginMethods,
                                    [m.key]: checked,
                                  },
                                },
                              });
                            }}
                          />
                        </Form.Item>
                      ))}

                      {/* 社会化身份源关联区域：仅当 social 开关打开时展示 */}
                      {socialEnabled && (
                        <>
                          <Divider
                            orientation="left"
                            plain
                            style={{ margin: '24px 0 12px', fontSize: 13, color: '#8c8c8c' }}
                          >
                            关联社会化身份源
                          </Divider>
                          <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 16, marginLeft: 24 }}
                            message="选择需要在登录页展示的社会化身份源"
                            description="开启后，用户在该应用的登录页面将看到对应的第三方登录按钮。需先在「身份源管理 → 社会化身份源」中创建并启用身份源。"
                          />
                          {allSocialConnections.length === 0 ? (
                            <div style={{ marginLeft: 24, color: '#8c8c8c', marginBottom: 16 }}>
                              暂无可用的社会化身份源，请先前往
                              <Button
                                type="link"
                                size="small"
                                onClick={() => navigate('/connections/social')}
                              >
                                社会化身份源管理
                              </Button>
                              创建。
                            </div>
                          ) : (
                            <div style={{ marginLeft: 24, marginBottom: 16 }}>
                              {allSocialConnections.map((conn) => {
                                const isLinked = linkedSocialIds.includes(conn._id);
                                return (
                                  <div
                                    key={conn._id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '10px 16px',
                                      marginBottom: 8,
                                      borderRadius: 8,
                                      border: '1px solid #f0f0f0',
                                      background: isLinked ? '#f6ffed' : '#fafafa',
                                      maxWidth: 500,
                                    }}
                                  >
                                    <Space>
                                      {conn.logoUrl && (
                                        <img
                                          src={conn.logoUrl}
                                          alt={conn.displayName}
                                          style={{ width: 20, height: 20, borderRadius: 4 }}
                                        />
                                      )}
                                      <span style={{ fontWeight: 500 }}>
                                        {conn.displayName || conn.identifier}
                                      </span>
                                      <Tag color="blue" style={{ fontSize: 11 }}>
                                        {conn.provider}
                                      </Tag>
                                    </Space>
                                    <Switch
                                      size="small"
                                      checked={isLinked}
                                      onChange={async (checked) => {
                                        const newIds = checked
                                          ? [...linkedSocialIds, conn._id]
                                          : linkedSocialIds.filter((id) => id !== conn._id);
                                        setLinkedSocialIds(newIds);
                                        try {
                                          await runSave({ socialConnectionIds: newIds });
                                        } catch {
                                          // 保存失败时回滚本地状态
                                          setLinkedSocialIds(linkedSocialIds);
                                        }
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </Form>
                  </Section>

                  <Section title="已登录用户">
                    <Table
                      dataSource={loggedInUsers}
                      rowKey="userId"
                      loading={loggedInUsersLoading}
                      size="small"
                      pagination={false}
                      locale={{ emptyText: '当前无在线用户' }}
                      columns={[
                        {
                          title: '用户信息',
                          dataIndex: 'username',
                          render: (text, record) => (
                            <Space
                              style={{ cursor: 'pointer' }}
                              onClick={() => navigate(`/users/${record.userId}`)}
                            >
                              <Avatar
                                size={32}
                                style={{ backgroundColor: '#5b50e8' }}
                                src={record.picture || undefined}
                              >
                                {(record.name || record.username || '?').slice(0, 2)}
                              </Avatar>
                              <span style={{ color: '#1677ff' }}>
                                {record.name || record.username}
                              </span>
                            </Space>
                          ),
                        },
                        { title: '手机号', dataIndex: 'phone', render: (v) => v || '-' },
                        { title: '邮箱', dataIndex: 'email', render: (v) => v || '-' },
                        { title: '登录次数', dataIndex: 'loginCount', width: 90 },
                        {
                          title: '最后登录时间',
                          dataIndex: 'lastLoginAt',
                          width: 180,
                          render: (v) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
                        },
                        {
                          title: '活跃会话',
                          dataIndex: 'activeSessions',
                          width: 90,
                          render: (v) => <Tag color="green">{v} 个</Tag>,
                        },
                      ]}
                    />
                  </Section>
                </div>
              ),
            },
            {
              key: 'access',
              label: '访问授权',
              children: (
                <Suspense
                  fallback={<Spin style={{ display: 'block', textAlign: 'center', padding: 48 }} />}
                >
                  <AccessControlPanel clientId={clientId} />
                </Suspense>
              ),
            },
            {
              key: 'security',
              label: '安全管理',
              children: (
                <div className="app-detail-page__security">
                  <Section title="安全管理">
                    <Form
                      form={securityForm}
                      layout="horizontal"
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 14 }}
                      style={{ maxWidth: 720 }}
                    >
                      <Divider
                        orientation="left"
                        plain
                        style={{ margin: '0 0 16px', fontSize: 13, color: '#8c8c8c' }}
                      >
                        注册与锁定策略
                      </Divider>
                      <Form.Item
                        label="允许新用户注册"
                        name="allowRegister"
                        valuePropName="checked"
                        extra="开启后登录页将展示「立即注册」入口"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label="登录失败上限"
                        name="maxLoginFailures"
                        rules={[{ required: true, type: 'number', min: 1, max: 100 }]}
                        extra="同一账号连续失败 N 次后锁定"
                      >
                        <InputNumber min={1} max={100} addonAfter="次" />
                      </Form.Item>
                      <Form.Item
                        label="账号锁定时长"
                        name="lockoutDurationMinutes"
                        rules={[{ required: true, type: 'number', min: 1 }]}
                      >
                        <InputNumber min={1} addonAfter="分钟" />
                      </Form.Item>

                      <Divider
                        orientation="left"
                        plain
                        style={{ margin: '24px 0 16px', fontSize: 13, color: '#8c8c8c' }}
                      >
                        Token 与协议安全
                      </Divider>
                      <Form.Item
                        label="强制启用 PKCE"
                        name="requirePkce"
                        valuePropName="checked"
                        extra="Public Client（前端 SPA）建议保持开启，防止授权码拦截攻击（RFC 7636）"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label="Access Token 有效期"
                        name="tokenExpiresInSeconds"
                        rules={[{ required: true, type: 'number', min: 60 }]}
                        extra="单位：秒。建议 1800（30 分钟）~ 7200（2 小时）"
                      >
                        <InputNumber min={60} max={86400} addonAfter="秒" />
                      </Form.Item>

                      <Form.Item wrapperCol={{ offset: 6 }}>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={saving}
                          onClick={handleSaveSecurity}
                        >
                          保存安全管理
                        </Button>
                      </Form.Item>
                    </Form>
                  </Section>
                </div>
              ),
            },
            {
              key: 'audit',
              label: '审计日志',
              children: (
                <div className="app-detail-page__audit">
                  <Section title="登录审计日志">
                    <Suspense
                      fallback={
                        <div style={{ padding: 40, textAlign: 'center' }}>
                          <Spin />
                        </div>
                      }
                    >
                      <AuditLogTable clientId={clientId} />
                    </Suspense>
                  </Section>
                </div>
              ),
            },
            {
              key: 'brand',
              label: '品牌化',
              children: (
                <div className="app-detail-page__branding">
                  <Section title="登录页品牌化">
                    <Suspense
                      fallback={
                        <div style={{ padding: 40, textAlign: 'center' }}>
                          <Spin />
                        </div>
                      }
                    >
                      <BrandingForm
                        clientId={clientId}
                        initialValue={{ ...DEFAULT_BRANDING, ...(app.branding || {}) }}
                        onSaved={refresh}
                      />
                    </Suspense>
                  </Section>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 接入教程 Modal */}
      <Suspense fallback={null}>
        <IntegrationGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} app={app} />
      </Suspense>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="detail-section">
      <div className="detail-section__title">{title}</div>
      <div className="detail-section__body">{children}</div>
    </div>
  );
}
