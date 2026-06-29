import { useMemo } from 'react';
import { BackButton } from '../../components/common';
import {
  Typography,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Card,
  Avatar,
  Row,
  Col,
  message,
  Checkbox,
  Spin,
} from 'antd';
import { GithubOutlined, SaveOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getSocialConnectionTypes,
  getSocialConnection,
  getSocialConnectionSecret,
  createSocialConnection,
  updateSocialConnection,
  getLinkedApps,
  toggleLinkedApp,
} from '../../api';

const { Title, Text, Paragraph } = Typography;

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

const PROVIDER_ICONS = {
  gitee: 'https://gitee.com/favicon.ico',
  github: undefined,
};

const PROVIDER_COLORS = {
  gitee: '#C71D23',
  github: '#24292e',
  wechat: '#07C160',
  gitlab: '#FC6D26',
};

const GITEE_SCOPES = [
  'user_info',
  'projects',
  'pull_requests',
  'issues',
  'notes',
  'keys',
  'hook',
  'groups',
  'gists',
  'enterprises',
  'emails',
];

export default function SocialConnectionEditPage() {
  const navigate = useNavigate();
  const { connectionId } = useParams();
  const [searchParams] = useSearchParams();
  const providerFromQuery = searchParams.get('provider');
  const isEditMode = !!connectionId;

  const [form] = Form.useForm();

  const { data: providerTypes = [] } = useRequest(async () => {
    const res = await getSocialConnectionTypes();
    return res.data || [];
  });

  const { loading: detailLoading } = useRequest(
    async () => {
      if (!connectionId) return null;
      const [detailRes, secretRes] = await Promise.all([
        getSocialConnection(connectionId),
        getSocialConnectionSecret(connectionId),
      ]);
      return { detail: detailRes.data, secret: secretRes.data?.clientSecret || '' };
    },
    {
      ready: isEditMode,
      onSuccess: ({ detail, secret }) => {
        if (!detail) return;
        form.setFieldsValue({
          provider: detail.provider,
          identifier: detail.identifier,
          displayName: detail.displayName || '',
          clientId: detail.clientId,
          clientSecret: secret,
          callbackUrl: detail.callbackUrl || '',
          scopes: detail.scopes || ['user_info'],
          loginMode: detail.loginMode || 'normal',
          enabled: detail.enabled,
          description: detail.description || '',
        });
      },
    },
  );

  // 查询关联此身份源的应用列表（仅编辑模式）
  const { data: linkedApps = [], refresh: refreshLinkedApps } = useRequest(
    async () => {
      if (!connectionId) return [];
      const res = await getLinkedApps(connectionId);
      return res?.data || [];
    },
    { ready: isEditMode, refreshDeps: [connectionId] },
  );

  // 切换应用关联状态
  const { runAsync: runToggleLink } = useRequest(
    async (appId, linked) => toggleLinkedApp(connectionId, appId, linked),
    {
      manual: true,
      onSuccess: (res) => {
        message.success(res?.message || '操作成功');
        refreshLinkedApps();
      },
      onError: (err) => message.error(err?.error_description || '操作失败'),
    },
  );

  const currentProvider = Form.useWatch('provider', form) || providerFromQuery;

  const providerInfo = useMemo(
    () => providerTypes.find((t) => t.id === currentProvider),
    [providerTypes, currentProvider],
  );

  const callbackUrl = useMemo(() => {
    return `${OAUTH2_SERVER}/v1/oauth/social/${currentProvider || 'provider'}/callback`;
  }, [currentProvider]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // user_info 为必选项，确保始终包含在 scopes 中
      if (values.scopes && !values.scopes.includes('user_info')) {
        values.scopes = ['user_info', ...values.scopes];
      }
      if (isEditMode) {
        const payload = { ...values };
        if (!payload.clientSecret) delete payload.clientSecret;
        await updateSocialConnection(connectionId, payload);
        message.success('更新成功');
      } else {
        await createSocialConnection(values);
        message.success('创建成功');
      }
      navigate('/connections/social');
    } catch (error) {
      if (error?.error_description) {
        message.error(error.error_description);
      }
    }
  };

  if (isEditMode && detailLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 24px', maxWidth: 900 }}>
      <BackButton />

      {/* 头部：Provider 信息 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <Avatar
          size={48}
          src={PROVIDER_ICONS[currentProvider]}
          icon={currentProvider === 'github' ? <GithubOutlined style={{ fontSize: 28 }} /> : null}
          style={{ backgroundColor: PROVIDER_COLORS[currentProvider] || '#8c8c8c' }}
        />
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {providerInfo?.name || currentProvider?.toUpperCase() || '身份源'}
          </Title>
          <Text type="secondary">{providerInfo?.description || ''}</Text>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          provider: providerFromQuery || '',
          enabled: true,
          loginMode: 'normal',
          scopes: ['user_info'],
          displayName: providerInfo?.name || '',
        }}
      >
        <Form.Item name="provider" hidden>
          <Input />
        </Form.Item>

        {/* 基础配置 */}
        <Title level={5}>基础配置</Title>
        <Card style={{ marginBottom: 24 }}>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                name="identifier"
                label="唯一标识"
                rules={[{ required: true, message: '请输入唯一标识' }]}
                tooltip="用于区分同一类型的多个身份源配置"
              >
                <Input placeholder="请输入唯一标识" disabled={isEditMode} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="displayName"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder={providerInfo?.name || '请输入显示名称'} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                name="clientId"
                label="Client ID"
                rules={[{ required: true, message: '请输入 Client ID' }]}
              >
                <Input placeholder="请输入 Client ID" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="clientSecret"
                label="Client Secret"
                rules={isEditMode ? [] : [{ required: true, message: '请输入 Client Secret' }]}
              >
                <Input.Password placeholder="请输入 Client Secret" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="callbackUrl" label="Callback URL">
            <Input placeholder="请输入你的业务回调链接" />
          </Form.Item>
        </Card>

        {/* Scopes */}
        {currentProvider === 'gitee' && (
          <>
            <Title level={5}>Scopes</Title>
            <Card style={{ marginBottom: 24 }}>
              <Paragraph type="warning" style={{ marginBottom: 12 }}>
                请确保勾选的权限与 Gitee
                第三方应用中配置的权限一致，否则授权时可能出现页面错误。首次登录成功后，系统会自动同步
                Gitee 实际授予的权限并移除未授权的选项。
              </Paragraph>
              {/* user_info 为必选项，始终勾选且不可取消 */}
              <Row gutter={[16, 8]}>
                <Col span={6}>
                  <Checkbox checked disabled>
                    user_info
                  </Checkbox>
                </Col>
              </Row>
              <Form.Item name="scopes" noStyle>
                <Checkbox.Group>
                  <Row gutter={[16, 8]}>
                    {GITEE_SCOPES.filter((s) => s !== 'user_info').map((scope) => (
                      <Col span={6} key={scope}>
                        <Checkbox value={scope}>{scope}</Checkbox>
                      </Col>
                    ))}
                  </Row>
                </Checkbox.Group>
              </Form.Item>
            </Card>
          </>
        )}

        {/* 回调地址提示 */}
        <Title level={5}>回调地址</Title>
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text copyable code>
              {callbackUrl}
            </Text>
          </div>
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            你需要将此链接配置到对应身份源的回调地址中
          </Paragraph>
        </Card>

        {/* 登录模式 */}
        <Title level={5}>登录模式</Title>
        <Card style={{ marginBottom: 24 }}>
          <Form.Item name="loginMode" noStyle>
            <Select
              style={{ width: '100%' }}
              options={[
                { value: 'normal', label: '常规模式 — 若用户不存在则自动创建' },
                { value: 'login_only', label: '仅登录模式（谨慎选择） — 用户必须已存在' },
              ]}
            />
          </Form.Item>
        </Card>

        {/* 启用状态 & 描述 */}
        <Title level={5}>其他设置</Title>
        <Card style={{ marginBottom: 24 }}>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          {/* 使用此身份源的应用列表（仅编辑模式展示） */}
          {isEditMode && (
            <div style={{ marginBottom: 24 }}>
              <Text strong>使用此身份源的应用</Text>
              {linkedApps.length === 0 ? (
                <div style={{ color: '#8c8c8c', marginTop: 8 }}>暂无应用关联此身份源</div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  {linkedApps.map((app) => (
                    <div
                      key={app.clientId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 16px',
                        marginBottom: 8,
                        borderRadius: 8,
                        background: '#f6f6f6',
                      }}
                    >
                      <Space>
                        <Avatar size={28} style={{ backgroundColor: '#5b50e8', fontSize: 12 }}>
                          {(app.name || '').slice(0, 1).toUpperCase()}
                        </Avatar>
                        <span style={{ fontWeight: 500 }}>{app.name}</span>
                      </Space>
                      <Switch
                        size="small"
                        checked
                        onChange={(checked) => runToggleLink(app.clientId, checked)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Form.Item name="description" label="描述" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="可选描述" />
          </Form.Item>
        </Card>

        {/* 提交按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 48 }}>
          <Button onClick={() => navigate('/connections/social')}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSubmit}>
            {isEditMode ? '保存修改' : '创建身份源'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
