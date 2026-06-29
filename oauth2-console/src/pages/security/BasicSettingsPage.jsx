import React, { useEffect } from 'react';
import {
  Card,
  Tabs,
  Form,
  Switch,
  InputNumber,
  Button,
  Space,
  Typography,
  Alert,
  Divider,
  Spin,
  message,
  Row,
  Col,
  Tag,
} from 'antd';
import {
  SaveOutlined,
  SettingOutlined,
  LoginOutlined,
  UserAddOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { getSystemConfig, updateSystemConfig } from '../../api/index';
import './BasicSettingsPage.scss';

const { Title, Text, Paragraph } = Typography;

// 默认值，避免老数据缺字段时表单显示异常
const DEFAULT_CONFIG = {
  registrationEnabled: true,
  whitelistEnabled: false,
  mfaEnabled: false,
  rateLimitEnabled: true,
  loginRateLimit: { windowMs: 15 * 60 * 1000, max: 10 },
  generalRateLimit: { windowMs: 60 * 1000, max: 60 },
};

/**
 * 安全设置 - 基础设置
 *
 * 参考 Authing 用户目录配置项规范：
 *   https://docs.authing.cn/v2/guides/users/settings.html
 *
 * 3 个 Tab：
 *   - 基础设置（global）：MFA 全局开关 + 简介
 *   - 登录设置（login） ：API 限流总开关 + 登录/通用限流参数
 *   - 注册设置（register）：是否允许自助注册 + 是否启用注册白名单
 *
 * 注意：注册白名单的"具体名单管理"仍走 /users/whitelist（用户级配置，不迁移）
 */
export default function BasicSettingsPage() {
  const [globalForm] = Form.useForm();
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const { data, loading, refresh } = useRequest(getSystemConfig);
  const config = { ...DEFAULT_CONFIG, ...(data?.data || {}) };

  useEffect(() => {
    if (data?.data) {
      globalForm.setFieldsValue({ mfaEnabled: config.mfaEnabled });
      loginForm.setFieldsValue({
        rateLimitEnabled: config.rateLimitEnabled,
        loginRateLimit: config.loginRateLimit,
        generalRateLimit: config.generalRateLimit,
      });
      registerForm.setFieldsValue({
        registrationEnabled: config.registrationEnabled,
        whitelistEnabled: config.whitelistEnabled,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const { loading: saving, runAsync: runSave } = useRequest(updateSystemConfig, {
    manual: true,
    onSuccess: () => {
      messageApi.success('保存成功');
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '保存失败'),
  });

  const handleSaveGlobal = async () => {
    const values = await globalForm.validateFields();
    await runSave(values);
  };
  const handleSaveLogin = async () => {
    const values = await loginForm.validateFields();
    await runSave(values);
  };
  const handleSaveRegister = async () => {
    const values = await registerForm.validateFields();
    await runSave(values);
  };

  if (loading) {
    return (
      <div
        className="page-container basic-settings-page"
        style={{ textAlign: 'center', padding: 80 }}
      >
        <Spin />
      </div>
    );
  }

  return (
    <div className="page-container basic-settings-page">
      {contextHolder}

      <div className="basic-settings-page__header">
        <Space size={12} align="center">
          <div className="basic-settings-page__icon">
            <SafetyCertificateOutlined />
          </div>
          <div>
            <Title level={4} className="page-title">
              基础设置
            </Title>
            <Text type="secondary">
              配置系统全局的安全策略：API 限流、用户自助注册、注册白名单等
            </Text>
          </div>
        </Space>
      </div>

      <Card bordered={false} className="basic-settings-page__card">
        <Tabs
          defaultActiveKey="global"
          items={[
            {
              key: 'global',
              label: (
                <span>
                  <SettingOutlined /> 基础设置
                </span>
              ),
              children: <GlobalTab form={globalForm} saving={saving} onSave={handleSaveGlobal} />,
            },
            {
              key: 'login',
              label: (
                <span>
                  <LoginOutlined /> 登录设置
                </span>
              ),
              children: <LoginTab form={loginForm} saving={saving} onSave={handleSaveLogin} />,
            },
            {
              key: 'register',
              label: (
                <span>
                  <UserAddOutlined /> 注册设置
                </span>
              ),
              children: (
                <RegisterTab form={registerForm} saving={saving} onSave={handleSaveRegister} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

// ==================== Tab 1：基础设置 ====================
function GlobalTab({ form, saving, onSave }) {
  return (
    <div className="basic-settings-page__tab">
      <SectionHeader title="全局安全开关" desc="控制系统级别的安全策略，影响所有应用和用户" />
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 6 }}
        wrapperCol={{ span: 14 }}
        style={{ maxWidth: 720 }}
      >
        <Form.Item
          label="启用 MFA"
          name="mfaEnabled"
          valuePropName="checked"
          extra="开启后管理员可在用户详情页为指定用户开启多因素认证（短信 / 邮箱 / TOTP）。关闭则全局禁用 MFA 流程。"
        >
          <Switch />
        </Form.Item>

        <Form.Item wrapperCol={{ offset: 6 }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
            保存基础设置
          </Button>
        </Form.Item>
      </Form>

      <Divider />

      <Alert
        type="info"
        showIcon
        message="安全设置文档"
        description={
          <span>
            本页参考{' '}
            <a
              href="https://docs.authing.cn/v2/guides/users/settings.html"
              target="_blank"
              rel="noreferrer"
            >
              Authing 用户目录配置项
            </a>{' '}
            设计。 更多细分策略（密码强度、会话有效期、IP 白名单等）将在后续版本逐步上线。
          </span>
        }
      />
    </div>
  );
}

// ==================== Tab 2：登录设置（API 限流） ====================
function LoginTab({ form, saving, onSave }) {
  return (
    <div className="basic-settings-page__tab">
      <SectionHeader
        title="API 限流"
        desc="基于 IP 的请求频率限制，防止暴力破解 / DoS 攻击。变更立即生效（5 秒内）"
        icon={<ThunderboltOutlined />}
      />

      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 14 }}
        style={{ maxWidth: 760 }}
      >
        <Form.Item
          label="启用 API 限流"
          name="rateLimitEnabled"
          valuePropName="checked"
          extra="关闭后所有限流中间件直接放行，仅在压测 / 应急排障时关闭。生产环境强烈建议保持开启。"
        >
          <Switch />
        </Form.Item>

        <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
          登录接口限流（更严格）
        </Divider>

        <Form.Item
          label="时间窗口"
          name={['loginRateLimit', 'windowMs']}
          rules={[{ required: true, type: 'number', min: 1000 }]}
          extra="同一 IP 在该时间窗口内最多允许的登录尝试次数。建议 15 分钟（900000ms）"
        >
          <InputNumber min={1000} step={60000} addonAfter="毫秒" style={{ width: 220 }} />
        </Form.Item>

        <Form.Item
          label="最大请求数"
          name={['loginRateLimit', 'max']}
          rules={[{ required: true, type: 'number', min: 1 }]}
          extra="超出后返回 429 too_many_requests，提示『请稍后再试』"
        >
          <InputNumber min={1} max={1000} addonAfter="次" style={{ width: 180 }} />
        </Form.Item>

        <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
          通用接口限流（适用所有非登录端点）
        </Divider>

        <Form.Item
          label="时间窗口"
          name={['generalRateLimit', 'windowMs']}
          rules={[{ required: true, type: 'number', min: 1000 }]}
          extra="建议 1 分钟（60000ms）"
        >
          <InputNumber min={1000} step={1000} addonAfter="毫秒" style={{ width: 220 }} />
        </Form.Item>

        <Form.Item
          label="最大请求数"
          name={['generalRateLimit', 'max']}
          rules={[{ required: true, type: 'number', min: 1 }]}
        >
          <InputNumber min={1} max={10000} addonAfter="次" style={{ width: 180 }} />
        </Form.Item>

        <Form.Item wrapperCol={{ offset: 8 }}>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
              保存登录设置
            </Button>
            <Tag color="green">变更立即生效</Tag>
          </Space>
        </Form.Item>
      </Form>

      <Alert
        type="warning"
        showIcon
        style={{ marginTop: 16 }}
        message="限流命中后的行为"
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              浏览器整页跳转入口（如 <code>/oauth/authorize</code>）→ 302 重定向到登录页 +
              ?error=too_many_requests，前端 message.error 友好提示
            </li>
            <li>API 调用（axios / fetch）→ 返回 429 JSON，调用方拦截器处理</li>
            <li>
              <code>dry_run=1</code> 预检模式不计入登录限流配额（避免双倍消耗）
            </li>
          </ul>
        }
      />
    </div>
  );
}

// ==================== Tab 3：注册设置 ====================
function RegisterTab({ form, saving, onSave }) {
  return (
    <div className="basic-settings-page__tab">
      <SectionHeader
        title="用户注册"
        desc="控制是否允许新用户自助注册账号，以及是否启用注册白名单（精确控制可注册的手机号 / 邮箱 / 用户名）"
      />

      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 6 }}
        wrapperCol={{ span: 14 }}
        style={{ maxWidth: 720 }}
      >
        <Form.Item
          label="允许自助注册"
          name="registrationEnabled"
          valuePropName="checked"
          extra="开启后用户可在登录页自行注册账号；关闭则只能由管理员在控制台创建账号"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          label="启用注册白名单"
          name="whitelistEnabled"
          valuePropName="checked"
          extra="开启后只有匹配白名单（手机号 / 邮箱 / 邮箱域名 / 用户名）的账号才能注册成功"
        >
          <Switch />
        </Form.Item>

        <Form.Item wrapperCol={{ offset: 6 }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
            保存注册设置
          </Button>
        </Form.Item>
      </Form>

      <Divider />

      <Alert
        type="info"
        showIcon
        message="管理白名单具体条目"
        description={
          <span>
            本页只管理注册<strong>开关</strong>。具体的白名单条目（添加 /
            删除手机号、邮箱、域名等）请到 <a href="/users/whitelist">用户管理 → 注册白名单</a>{' '}
            页面操作。
          </span>
        }
      />
    </div>
  );
}

// ==================== 工具组件 ====================
function SectionHeader({ title, desc, icon }) {
  return (
    <div className="basic-settings-page__section-header">
      <Space size={8}>
        {icon}
        <Text strong style={{ fontSize: 15 }}>
          {title}
        </Text>
      </Space>
      {desc && (
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 16, fontSize: 13 }}>
          {desc}
        </Paragraph>
      )}
    </div>
  );
}
