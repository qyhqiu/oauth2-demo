import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, Form, Input, Tabs, Select, Switch, Button, Space, message, Radio } from 'antd';
import {
  UserOutlined,
  MobileOutlined,
  MailOutlined,
  LockOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { createUser, sendCreateUserCode } from '../../../api/index';

const { Option } = Select;

/**
 * 创建用户弹窗（参考 Authing 控制台）
 *
 * 三种创建方式（Tab）：
 *  - 用户名：username + password 必填
 *  - 手机号：phone + password 必填（管理员创建跳过验证码，phoneVerified=false）
 *  - 邮箱：  email + password 必填（管理员创建 emailVerified=false）
 *
 * 共同点：管理员创建均跳过「禁止注册」「注册白名单」等限制
 *        registerSource = 'admin'，让后端走管理员创建分支
 */
function generatePassword(length = 12) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let pwd = '';
  for (let i = 0; i < length; i += 1) {
    pwd += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return pwd;
}

const TAB_USERNAME = 'username';
const TAB_PHONE = 'phone';
const TAB_EMAIL = 'email';

export default function CreateUserModal({ open, onCancel, onSuccess }) {
  const [activeTab, setActiveTab] = useState(TAB_USERNAME);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef(null);

  // 倒计时清理
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const startCountdown = useCallback(() => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const { loading: sendingCode, runAsync: runSendCode } = useRequest(sendCreateUserCode, {
    manual: true,
    onSuccess: (res) => {
      messageApi.success('验证码已发送');
      // Demo 模式下在控制台输出验证码方便调试
      if (res?.data?.devCode) messageApi.info(`[Dev] 验证码: ${res.data.devCode}`, 5);
      startCountdown();
    },
    onError: (err) => messageApi.error(err?.error_description || '发送失败'),
  });

  const handleSendCode = async () => {
    try {
      const phone = form.getFieldValue('phone');
      await form.validateFields(['phone']);
      await runSendCode('sms', phone);
    } catch {
      /* 表单校验失败，忽略 */
    }
  };

  const { loading, runAsync } = useRequest(createUser, {
    manual: true,
    onSuccess: (res) => {
      messageApi.success(res?.message || '用户创建成功');
      handleClose();
      onSuccess?.();
    },
    onError: (err) => messageApi.error(err?.error_description || '创建失败'),
  });

  const handleClose = () => {
    form.resetFields();
    setActiveTab(TAB_USERNAME);
    setCountdown(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onCancel?.();
  };

  const handleAutoGenPassword = () => {
    const pwd = generatePassword();
    form.setFieldsValue({ password: pwd, confirmPassword: pwd });
    messageApi.success('已自动生成强密码，请妥善保管');
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();

    // 按 Tab 拼装提交字段，标记 registerSource='admin' 让后端走"管理员创建"分支
    const payload = {
      password: values.password,
      name: values.name || values[activeTab], // 没填姓名时，用账号标识兜底作为展示名
      role: values.role || 'user',
      registerSource: 'admin',
    };
    if (activeTab === TAB_USERNAME) payload.username = values.username;
    if (activeTab === TAB_PHONE) {
      payload.phone = values.phone;
      payload.verifyCode = values.verifyCode;
    }
    if (activeTab === TAB_EMAIL) payload.email = values.email;

    await runAsync(payload);
  };

  // ============ 各 Tab 的特定字段渲染 ============
  const renderIdentityField = () => {
    if (activeTab === TAB_USERNAME) {
      return (
        <Form.Item
          label="用户名"
          name="username"
          rules={[
            { required: true, message: '请输入用户名' },
            { min: 3, message: '用户名至少 3 位' },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: '只允许字母、数字、下划线、连字符' },
          ]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="请输入用户名（如：zhangsan）"
            autoComplete="off"
          />
        </Form.Item>
      );
    }
    if (activeTab === TAB_PHONE) {
      return (
        <>
          <Form.Item
            label="手机号"
            name="phone"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号' },
            ]}
          >
            <Input prefix={<MobileOutlined />} placeholder="请输入手机号" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="验证码"
            name="verifyCode"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="请输入短信验证码" style={{ flex: 1 }} />
              <Button
                type="primary"
                disabled={countdown > 0}
                loading={sendingCode}
                onClick={handleSendCode}
                style={{ width: 130 }}
              >
                {countdown > 0 ? `${countdown}s 后重新发送` : '发送验证码'}
              </Button>
            </Space.Compact>
          </Form.Item>
        </>
      );
    }
    if (activeTab === TAB_EMAIL) {
      return (
        <Form.Item
          label="邮箱"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入正确的邮箱格式' },
          ]}
          extra="管理员创建账号无需邮箱验证，但创建后 emailVerified 字段为 false"
        >
          <Input prefix={<MailOutlined />} placeholder="请输入邮箱" autoComplete="off" />
        </Form.Item>
      );
    }
    return null;
  };

  const tabItems = [
    { key: TAB_USERNAME, label: '用户名' },
    { key: TAB_PHONE, label: '手机号' },
    { key: TAB_EMAIL, label: '邮箱' },
  ];

  return (
    <Modal
      title="创建成员"
      open={open}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          保 存
        </Button>,
      ]}
      width={560}
      destroyOnClose
      maskClosable={false}
    >
      {contextHolder}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => {
          setActiveTab(k);
          form.resetFields(['username', 'phone', 'email']);
        }}
        items={tabItems}
        type="card"
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical" initialValues={{ role: 'user' }} autoComplete="off">
        {renderIdentityField()}

        <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
          <Input placeholder="例如：张三（用户在控制台的展示名）" />
        </Form.Item>

        <Form.Item
          label={
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <span>
                密码 <span style={{ color: '#ff4d4f' }}>*</span>
              </span>
              <Button
                type="link"
                size="small"
                onClick={handleAutoGenPassword}
                style={{ padding: 0 }}
              >
                自动生成密码
              </Button>
            </Space>
          }
          name="password"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少 6 位' },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="请输入密码"
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        <Form.Item
          label="确认密码"
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: '请确认密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="请确认密码"
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        <Form.Item label="角色" name="role">
          <Radio.Group>
            <Radio value="user">普通用户</Radio>
            <Radio value="admin">管理员</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
