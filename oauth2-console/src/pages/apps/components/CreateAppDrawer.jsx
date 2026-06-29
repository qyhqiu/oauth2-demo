import React, { useState } from 'react';
import { Drawer, Form, Input, Button, Space, Typography, message, Row, Col, Select } from 'antd';
import {
  AppstoreOutlined,
  MobileOutlined,
  DesktopOutlined,
  ApiOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { createApp } from '../../../api/index';
import './CreateAppDrawer.scss';

const { Text, Title } = Typography;

// 5 种应用类型枚举（type 值与后端约定，仅做标识；当前后端只校验非空字符串，未来可扩展）
const APP_TYPES = [
  {
    value: 'web',
    label: '标准 Web 应用',
    desc: '多页面并支持跳转的网页应用',
    icon: <AppstoreOutlined />,
    color: '#5b50e8',
  },
  {
    value: 'spa',
    label: '单页 Web 应用',
    desc: '只有单个页面的纯前端网页应用',
    icon: <DesktopOutlined />,
    color: '#1677ff',
  },
  {
    value: 'native',
    label: '客户端应用',
    desc: '在手机、桌面和其他智能设备上运行的本地应用',
    icon: <MobileOutlined />,
    color: '#13c2c2',
  },
  {
    value: 'service',
    label: '后端应用',
    desc: '无前端界面，只提供后端服务的应用',
    icon: <ApiOutlined />,
    color: '#722ed1',
  },
  {
    value: 'miniapp',
    label: '小程序应用',
    desc: '微信、支付宝等平台的小程序应用',
    icon: <WechatOutlined />,
    color: '#52c41a',
  },
];

const SCOPE_OPTIONS = [
  { label: 'openid', value: 'openid' },
  { label: 'profile', value: 'profile' },
  { label: 'email', value: 'email' },
  { label: 'phone', value: 'phone' },
];

/**
 * 创建自建应用 - 抽屉表单
 * @param {object} props
 * @param {boolean} props.open       是否展开抽屉
 * @param {() => void} props.onClose 关闭回调
 * @param {(newApp) => void} props.onSuccess 创建成功回调（带新应用对象，调用方可刷新列表 / 跳转详情）
 */
export default function CreateAppDrawer({ open, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedType, setSelectedType] = useState('web');

  const { loading: submitting, runAsync: runCreate } = useRequest(createApp, {
    manual: true,
    onError: (err) => messageApi.error(err?.error_description || '创建失败'),
  });

  const handleClose = () => {
    if (submitting) return;
    form.resetFields();
    setSelectedType('web');
    onClose?.();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const res = await runCreate({ ...values, type: selectedType });
    messageApi.success('应用创建成功');
    form.resetFields();
    setSelectedType('web');
    onSuccess?.(res?.data);
  };

  return (
    <Drawer
      title="创建自建应用"
      width={720}
      open={open}
      onClose={handleClose}
      destroyOnClose
      maskClosable={!submitting}
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={handleClose} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              创建
            </Button>
          </Space>
        </div>
      }
    >
      {contextHolder}

      <Form
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ scope: ['openid', 'profile'] }}
      >
        <Form.Item
          label="应用名称"
          name="name"
          rules={[{ required: true, message: '请输入应用名称' }]}
          extra="将在登录页和应用列表中展示给用户"
        >
          <Input placeholder="输入应用名称" maxLength={32} showCount />
        </Form.Item>

        <Form.Item
          label="认证地址（Origin 域名）"
          name="origin"
          rules={[
            { required: true, message: '请输入认证地址' },
            {
              pattern: /^https?:\/\/[^\s]+$/,
              message: '请输入合法的 URL（以 http:// 或 https:// 开头）',
            },
          ]}
          extra="OAuth2 授权码回调将基于该地址进行重定向校验，例如 http://localhost:3002"
        >
          <Input placeholder="例如：http://localhost:3002" />
        </Form.Item>

        <Form.Item label="应用描述" name="description">
          <Input.TextArea
            rows={2}
            placeholder="可选，简要描述该应用的用途"
            maxLength={200}
            showCount
          />
        </Form.Item>

        <Form.Item
          label={
            <span>
              选择类型 <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>
            </span>
          }
          required={false}
          extra="不同类型对应不同的 OAuth2 授权流程；Demo 模式下仅做类型标识，授权流程一致"
        >
          <Row gutter={[12, 12]}>
            {APP_TYPES.map((t) => {
              const active = selectedType === t.value;
              return (
                <Col xs={24} sm={12} md={8} key={t.value}>
                  <div
                    className={`app-type-card${active ? ' app-type-card--active' : ''}`}
                    onClick={() => setSelectedType(t.value)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedType(t.value);
                    }}
                  >
                    <div
                      className="app-type-card__icon"
                      style={{ background: `${t.color}1a`, color: t.color }}
                    >
                      {t.icon}
                    </div>
                    <div className="app-type-card__name">{t.label}</div>
                    <div className="app-type-card__desc">{t.desc}</div>
                  </div>
                </Col>
              );
            })}
          </Row>
        </Form.Item>

        <Form.Item
          label="授权 Scope"
          name="scope"
          extra="可申请的用户信息范围。openid 必选用于颁发 ID Token"
        >
          <Select mode="multiple" options={SCOPE_OPTIONS} placeholder="选择授权范围" />
        </Form.Item>
      </Form>

      <div style={{ marginTop: 16, padding: 12, background: '#fafafa', borderRadius: 6 }}>
        <Title level={5} style={{ fontSize: 13, margin: 0, marginBottom: 4 }}>
          提示
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          创建成功后将自动生成 Client ID 与 Client Secret，可在应用详情页查看并配置 OAuth2 集成。
        </Text>
      </div>
    </Drawer>
  );
}
