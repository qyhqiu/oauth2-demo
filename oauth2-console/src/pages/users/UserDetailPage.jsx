import React, { useState } from 'react';
import { BackButton } from '../../components/common';
import {
  Card,
  Button,
  Avatar,
  Tabs,
  Descriptions,
  Typography,
  Space,
  Tag,
  Modal,
  Dropdown,
  message,
  Empty,
  Spin,
  Form,
  Input,
  Badge,
  Popconfirm,
  Table,
  Switch,
  Select,
  Alert,
  Row,
  Col,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownOutlined,
  LockOutlined,
  KeyOutlined,
  CopyOutlined,
  UserOutlined,
  MailOutlined,
  MobileOutlined,
  StopOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  EditOutlined,
  QrcodeOutlined,
  ApiOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import JsonView from '@uiw/react-json-view';
import { monokaiTheme } from '@uiw/react-json-view/monokai';
import { useNavigate, useParams } from 'react-router-dom';
import { useRequest, useAntdTable } from 'ahooks';
import {
  getUser,
  updateUser,
  deleteUser,
  forceLogout,
  getUserSessions,
  lockUser,
  unlockUserAccount,
  disableUser,
  enableUser,
  resetUserPassword,
  getUserLoginHistory,
  getUserLoginApps,
  sendUserVerifyCode,
  bindUserPhone,
  bindUserEmail,
  unbindUserPhone,
  unbindUserEmail,
  toggleUserMfa,
  setupUserTotp,
  confirmUserTotp,
  unbindUserTotp,
} from '../../api/index';
import { getCachedUser } from '../../utils/auth';
import './UserDetailPage.scss';

const { Text, Paragraph, Title } = Typography;

const ROLE_TAG = {
  admin: { label: '管理员', color: 'purple' },
  user: { label: '普通用户', color: 'green' },
};

const GENDER_TEXT = { M: '男', F: '女', U: '未知' };

const STATUS_BADGE = {
  active: { status: 'success', text: '活跃' },
  disabled: { status: 'error', text: '已停用' },
};

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN', { hour12: false });
}

export default function UserDetailPage() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [messageApi, contextHolder] = message.useMessage();
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdForm] = Form.useForm();
  const currentUser = getCachedUser();
  const isSelf = currentUser?.id === userId;

  // Tabs 受控：保留 activeTab 状态以支持后续可能的程序化切换需求；
  // 操作成功后不再强制跳回首 Tab，避免打断用户当前操作上下文。
  const [activeTab, setActiveTab] = useState('user-info');

  // 绑定/换绑手机号、邮箱
  const [bindPhoneOpen, setBindPhoneOpen] = useState(false);
  const [bindEmailOpen, setBindEmailOpen] = useState(false);
  const [bindPhoneForm] = Form.useForm();
  const [bindEmailForm] = Form.useForm();
  const [phoneCodeSending, setPhoneCodeSending] = useState(false);
  const [emailCodeSending, setEmailCodeSending] = useState(false);
  const [phoneCodeCountdown, setPhoneCodeCountdown] = useState(0);
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0);

  // ===== TOTP 绑定弹窗状态 =====
  // totpSetupOpen: 是否打开「绑定 TOTP」弹窗
  // totpSetupData: { secret, otpauthUrl, qrCodeDataUrl, accountLabel } — 服务端返回的二维码 + 密钥
  // totpConfirmCode: 用户在认证器 App 看到的 6 位动态码
  // totpConfirming: 提交校验中
  const [totpSetupOpen, setTotpSetupOpen] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState('');
  const [totpConfirming, setTotpConfirming] = useState(false);
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);

  const {
    data: userResp,
    loading,
    refresh,
  } = useRequest(() => getUser(userId), {
    refreshDeps: [userId],
    onError: () => messageApi.error('加载用户信息失败'),
  });
  const user = userResp?.data;

  const { data: sessionResp } = useRequest(() => getUserSessions(userId), {
    refreshDeps: [userId],
  });
  const sessionInfo = sessionResp?.data;

  const fetchLoginHistory = async ({ current, pageSize }) => {
    const res = await getUserLoginHistory(userId, { page: current, pageSize });
    const { list = [], total = 0 } = res?.data || {};
    return { total, list };
  };
  const { tableProps: historyTableProps, refresh: refreshHistory } = useAntdTable(
    fetchLoginHistory,
    {
      defaultPageSize: 10,
      refreshDeps: [userId],
    },
  );

  const { data: appsResp } = useRequest(() => getUserLoginApps(userId), {
    refreshDeps: [userId],
  });
  const loginApps = appsResp?.data || [];

  // ============ 操作回调 ============
  const handleLock = async () => {
    try {
      await lockUser(userId);
      messageApi.success('账号已锁定');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  // E2：一键解锁 — 后端会清零 blocked + lockedUntil + failedLoginAttempts + redis 锁
  const handleUnlock = async () => {
    try {
      const res = await unlockUserAccount(userId);
      messageApi.success(res?.message || '账号已解锁');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleDisable = async () => {
    try {
      await disableUser(userId);
      messageApi.success('账号已停用');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleEnable = async () => {
    try {
      await enableUser(userId);
      messageApi.success('账号已启用');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleDelete = () => {
    Modal.confirm({
      title: '删除账号',
      content: `确定删除用户「${user?.name || user?.username}」吗？此操作不可恢复！`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteUser(userId);
        messageApi.success('用户已删除');
        navigate('/users', { replace: true });
      },
    });
  };

  const handleForceLogout = async () => {
    try {
      const res = await forceLogout(userId);
      messageApi.success(res?.message || '已强制下线');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleResetPassword = async () => {
    const values = await pwdForm.validateFields();
    try {
      await resetUserPassword(userId, values.password);
      messageApi.success('密码重置成功');
      setPwdModalOpen(false);
      pwdForm.resetFields();
    } catch (err) {
      messageApi.error(err?.error_description || '密码重置失败');
    }
  };

  const handleCopyJson = () => {
    if (!user) return;
    navigator.clipboard.writeText(JSON.stringify(user, null, 2));
    messageApi.success('已复制原始 JSON 数据');
  };

  // ============ 发送验证码 + 绑定/换绑 ============
  const startCountdown = (channel) => {
    const setCount = channel === 'phone' ? setPhoneCodeCountdown : setEmailCodeCountdown;
    setCount(60);
    const timer = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendPhoneCode = async () => {
    const target = bindPhoneForm.getFieldValue('phone');
    if (!target) {
      messageApi.warning('请先输入手机号');
      return;
    }
    setPhoneCodeSending(true);
    try {
      const resp = await sendUserVerifyCode(userId, 'phone', target, 'bind-phone');
      const devCode = resp?.data?.devCode;
      messageApi.success(devCode ? `验证码已发送（Demo: ${devCode}）` : '验证码已发送');
      startCountdown('phone');
    } catch (err) {
      messageApi.error(err?.error_description || '发送失败');
    } finally {
      setPhoneCodeSending(false);
    }
  };

  const handleSendEmailCode = async () => {
    const target = bindEmailForm.getFieldValue('email');
    if (!target) {
      messageApi.warning('请先输入邮箱');
      return;
    }
    setEmailCodeSending(true);
    try {
      const resp = await sendUserVerifyCode(userId, 'email', target, 'bind-email');
      const devCode = resp?.data?.devCode;
      messageApi.success(devCode ? `验证码已发送（Demo: ${devCode}）` : '验证码已发送');
      startCountdown('email');
    } catch (err) {
      messageApi.error(err?.error_description || '发送失败');
    } finally {
      setEmailCodeSending(false);
    }
  };

  const handleBindPhone = async () => {
    const values = await bindPhoneForm.validateFields();
    try {
      await bindUserPhone(userId, values.phone, values.code);
      messageApi.success('手机号绑定成功');
      setBindPhoneOpen(false);
      bindPhoneForm.resetFields();
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '绑定失败');
    }
  };

  const handleBindEmail = async () => {
    const values = await bindEmailForm.validateFields();
    try {
      await bindUserEmail(userId, values.email, values.code);
      messageApi.success('邮箱绑定成功');
      setBindEmailOpen(false);
      bindEmailForm.resetFields();
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '绑定失败');
    }
  };

  const handleUnbindPhone = () => {
    Modal.confirm({
      title: '解绑手机号',
      content: '解绑后该用户将无法通过手机号登录，确定继续？',
      okType: 'danger',
      onOk: async () => {
        try {
          await unbindUserPhone(userId);
          messageApi.success('手机号已解绑');
          refresh();
        } catch (err) {
          messageApi.error(err?.error_description || '解绑失败');
        }
      },
    });
  };

  const handleUnbindEmail = () => {
    Modal.confirm({
      title: '解绑邮箱',
      content: '解绑后该用户将无法通过邮箱登录，确定继续？',
      okType: 'danger',
      onOk: async () => {
        try {
          await unbindUserEmail(userId);
          messageApi.success('邮箱已解绑');
          refresh();
        } catch (err) {
          messageApi.error(err?.error_description || '解绑失败');
        }
      },
    });
  };

  // ============ 操作菜单 ============
  // E1/E2：菜单显示「解锁」的判定要兼顾 MFA 自动锁（lockedUntil > now），不能只看 blocked
  const isLocked = !!(
    user?.blocked ||
    (user?.lockedUntil && new Date(user.lockedUntil) > new Date())
  );
  const actionMenuItems = [
    isLocked
      ? { key: 'unlock', icon: <PlayCircleOutlined />, label: '一键解锁' }
      : { key: 'lock', icon: <LockOutlined />, label: '锁定账号', disabled: isSelf },
    user?.status === 'disabled'
      ? { key: 'enable', icon: <PlayCircleOutlined />, label: '启用账号' }
      : { key: 'disable', icon: <StopOutlined />, label: '停用账号', disabled: isSelf },
    { type: 'divider' },
    {
      key: 'force-logout',
      icon: <ThunderboltOutlined style={{ color: isSelf ? '#d9d9d9' : '#fa8c16' }} />,
      label: '强制下线',
      disabled: isSelf,
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除账号',
      danger: !isSelf,
      disabled: isSelf,
    },
  ];

  const onActionClick = ({ key }) => {
    if (key === 'lock') handleLock();
    else if (key === 'unlock') handleUnlock();
    else if (key === 'disable') handleDisable();
    else if (key === 'enable') handleEnable();
    else if (key === 'delete') handleDelete();
    else if (key === 'force-logout') handleForceLogout();
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) {
    return <Empty description="用户不存在" style={{ marginTop: 80 }} />;
  }

  // ============ Tab：用户信息 ============
  const renderUserInfoTab = () => (
    <Card bordered={false} title="基本信息">
      <Descriptions column={3} bordered={false} size="middle">
        <Descriptions.Item label="用户 ID">
          <Text copyable={{ text: user.id }} className="mono-code">
            {user.id}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDate(user.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="最后登录时间">{formatDate(user.lastLogin)}</Descriptions.Item>

        <Descriptions.Item label="用户名">{user.username || '-'}</Descriptions.Item>
        <Descriptions.Item label="昵称">{user.nickname || '-'}</Descriptions.Item>
        <Descriptions.Item label="姓名">{user.name || '-'}</Descriptions.Item>

        <Descriptions.Item label="性别">{GENDER_TEXT[user.gender] || '未知'}</Descriptions.Item>
        <Descriptions.Item label="生日">
          {user.birthdate ? new Date(user.birthdate).toLocaleDateString('zh-CN') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="公司">{user.company || '-'}</Descriptions.Item>

        <Descriptions.Item label="地址" span={2}>
          {user.address || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="个人网站">{user.website || '-'}</Descriptions.Item>

        <Descriptions.Item label="已锁定">
          {user.blocked ? <Tag color="red">是</Tag> : <Tag color="green">否</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="账号状态">
          <Badge {...(STATUS_BADGE[user.status] || { status: 'default', text: user.status })} />
        </Descriptions.Item>
        <Descriptions.Item label="注册来源">
          <Tag>
            {user.registerSource === 'admin'
              ? '管理员创建'
              : user.registerSource === 'self-register'
                ? '自行注册'
                : user.registerSource === 'import'
                  ? '导入'
                  : '未知'}
          </Tag>
        </Descriptions.Item>

        <Descriptions.Item label="登录次数">{user.loginsCount || 0}</Descriptions.Item>
        <Descriptions.Item label="最后登录 IP">{user.lastIP || '-'}</Descriptions.Item>
        <Descriptions.Item label="时区 / 语言">{`${user.zoneinfo || '-'} / ${user.locale || '-'}`}</Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 24 }}>
        <Title level={5} style={{ marginBottom: 12 }}>
          历史登录应用
        </Title>
        {loginApps.length === 0 ? (
          <Empty description="暂无登录记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space wrap>
            {loginApps.map((app) => (
              <Tag key={app.clientId} color="blue" style={{ padding: '4px 10px', fontSize: 13 }}>
                {app.name}
              </Tag>
            ))}
          </Space>
        )}
      </div>
    </Card>
  );

  // ============ MFA 开关操作 ============
  const handleToggleMfa = async (checked) => {
    // 未传 mfaChannel 时后端会读用户当前通道（B5 修复后）；这里前端继续显式传一次保持兼容
    const preferChannel = user.mfaChannel || 'phone';
    try {
      await toggleUserMfa(userId, checked, preferChannel);
      messageApi.success(checked ? 'MFA 已开启' : 'MFA 已关闭');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || 'MFA 设置失败');
    }
  };

  const MFA_CHANNEL_LABEL = {
    phone: '手机短信',
    email: '邮箱',
    totp: '认证器 App',
  };

  const handleChangeMfaChannel = async (channel) => {
    try {
      await toggleUserMfa(userId, true, channel);
      messageApi.success(`MFA 验证通道已切换为${MFA_CHANNEL_LABEL[channel] || channel}`);
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '切换失败');
    }
  };

  // ============ TOTP 绑定 / 确认 / 解绑 ============
  // 打开绑定弹窗 → 调 setup 接口拿密钥+二维码 → 用户扫码后输入 6 位动态码 → 调 confirm 接口落库
  const handleOpenTotpSetup = async () => {
    setTotpSetupOpen(true);
    setTotpSetupData(null);
    setTotpConfirmCode('');
    setTotpSetupLoading(true);
    try {
      const resp = await setupUserTotp(userId);
      setTotpSetupData(resp?.data);
    } catch (err) {
      messageApi.error(err?.error_description || '生成 TOTP 二维码失败');
      setTotpSetupOpen(false);
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleConfirmTotp = async () => {
    if (!totpConfirmCode || totpConfirmCode.length !== 6) {
      messageApi.warning('请输入认证器 App 显示的 6 位动态码');
      return;
    }
    setTotpConfirming(true);
    try {
      await confirmUserTotp(userId, totpConfirmCode);
      messageApi.success('TOTP 已绑定，可以在 MFA 通道中选择「认证器 App」');
      setTotpSetupOpen(false);
      setTotpSetupData(null);
      setTotpConfirmCode('');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '动态码校验失败');
    } finally {
      setTotpConfirming(false);
    }
  };

  const handleUnbindTotp = () => {
    Modal.confirm({
      title: '解绑认证器 App（TOTP）',
      content:
        user?.mfaChannel === 'totp'
          ? '解绑后会自动回退到手机/邮箱通道（若都未绑则关闭 MFA），确定继续？'
          : '确定解绑该用户的 TOTP 密钥？解绑后下次需重新扫码绑定。',
      okType: 'danger',
      onOk: async () => {
        try {
          await unbindUserTotp(userId);
          messageApi.success('TOTP 已解绑');
          refresh();
        } catch (err) {
          messageApi.error(err?.error_description || '解绑失败');
        }
      },
    });
  };

  // ============ Tab：权限信息 ============
  const renderPermissionTab = () => {
    // E1/E3：本地计算锁定状态 + 锁定剩余时长 + 是否管理员手动锁
    const autoLockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    const isAutoLocked = !!(autoLockedUntil && autoLockedUntil > new Date());
    const isAdminLocked = user.blocked && !isAutoLocked;
    const lockRemainText = (() => {
      if (!isAutoLocked) return '';
      const remainMin = Math.ceil((autoLockedUntil.getTime() - Date.now()) / 60000);
      return remainMin >= 60
        ? `${Math.floor(remainMin / 60)} 小时 ${remainMin % 60} 分钟后自动解锁`
        : `${remainMin} 分钟后自动解锁`;
    })();

    return (
      <Card bordered={false} title="权限信息">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="角色">
            <Tag color={(ROLE_TAG[user.role] || {}).color || 'default'}>
              {(ROLE_TAG[user.role] || {}).label || user.role}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="是否管理员">
            {user.role === 'admin' ? <Tag color="purple">是</Tag> : <Tag>否</Tag>}
          </Descriptions.Item>
        </Descriptions>

        {/* E3：安全审计 — 锁定状态 + 失败计数 + 最近一次失败 IP/时间 */}
        <div style={{ marginTop: 24 }}>
          <Title level={5} style={{ marginBottom: 16 }}>
            安全审计
            {(isAutoLocked || isAdminLocked) && (
              <Tag
                color={isAutoLocked ? 'orange' : 'red'}
                icon={<LockOutlined />}
                style={{ marginLeft: 12 }}
              >
                {isAutoLocked ? '自动锁定中' : '管理员锁定中'}
              </Tag>
            )}
          </Title>
          {(isAutoLocked || isAdminLocked) && (
            <Alert
              type={isAutoLocked ? 'warning' : 'error'}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                isAutoLocked
                  ? `账号因连续 MFA / 登录失败 ${user.failedLoginAttempts || 0} 次被自动锁定，${lockRemainText}`
                  : '账号已被管理员手动锁定，需手动解锁'
              }
              action={
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleUnlock}
                >
                  一键解锁
                </Button>
              }
            />
          )}
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="连续失败次数">
              <Text
                strong
                style={{ color: (user.failedLoginAttempts || 0) > 0 ? '#fa541c' : undefined }}
              >
                {user.failedLoginAttempts || 0}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="锁定到期时间">
              {user.lockedUntil ? formatDate(user.lockedUntil) : <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="最近失败 IP">
              {user.lastFailedLoginIp ? (
                <Text copyable={{ text: user.lastFailedLoginIp }} className="mono-code">
                  {user.lastFailedLoginIp}
                </Text>
              ) : (
                <Text type="secondary">-</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="最近失败时间">
              {user.lastFailedLoginAt ? (
                formatDate(user.lastFailedLoginAt)
              ) : (
                <Text type="secondary">-</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* MFA 多因素认证设置 */}
        <div style={{ marginTop: 24 }}>
          <Title level={5} style={{ marginBottom: 16 }}>
            多因素认证（MFA）
          </Title>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <Text>启用 MFA：</Text>
            <Switch
              checked={!!user.mfaEnabled}
              onChange={handleToggleMfa}
              checkedChildren="开"
              unCheckedChildren="关"
            />
            {user.mfaEnabled && (
              <Select
                value={user.mfaChannel || 'phone'}
                onChange={handleChangeMfaChannel}
                style={{ width: 180 }}
                options={[
                  { value: 'phone', label: '📱 手机短信', disabled: !user.phone },
                  { value: 'email', label: '📧 邮箱验证', disabled: !user.email },
                  { value: 'totp', label: '🔐 认证器 App（TOTP）', disabled: !user.totpBound },
                ]}
              />
            )}
          </div>

          {/* TOTP 绑定状态 + 操作按钮（独立一行，显眼） */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <Text>认证器 App（TOTP）：</Text>
            {user.totpBound ? (
              <>
                <Tag color="green">已绑定</Tag>
                <Button size="small" icon={<QrcodeOutlined />} onClick={handleOpenTotpSetup}>
                  重新绑定
                </Button>
                <Button size="small" danger onClick={handleUnbindTotp}>
                  解绑
                </Button>
              </>
            ) : (
              <>
                <Tag>未绑定</Tag>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<QrcodeOutlined />}
                  onClick={handleOpenTotpSetup}
                >
                  绑定认证器 App
                </Button>
              </>
            )}
          </div>

          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            开启后，用户登录时需先通过密码验证，再输入
            {user.mfaChannel === 'totp'
              ? '认证器 App 显示的'
              : user.mfaChannel === 'email'
                ? '邮箱收到的'
                : '手机收到的'}
            验证码才能完成登录。
            {!user.phone && !user.email && !user.totpBound && (
              <Tag color="warning" style={{ marginLeft: 8 }}>
                请先绑定手机号、邮箱或认证器 App
              </Tag>
            )}
          </Text>
        </div>

        <div style={{ marginTop: 24, color: '#8c8c8c' }}>
          <Text type="secondary">基于角色的细粒度权限策略（RBAC）即将上线，敬请期待。</Text>
        </div>
      </Card>
    );
  };

  // ============ Tab：授权管理 ============
  // 这里展示的是用户「成功登录过」的应用清单（来自 LoginLog distinct clientId），
  // 不是显式授权关系，因此卡片不提供「撤销授权」按钮，仅做信息展示 + 点击跳转应用详情。
  const renderAuthorizationTab = () => (
    <Card bordered={false} title="授权管理">
      <Title level={5} style={{ marginBottom: 16 }}>
        已授权的应用
      </Title>
      {loginApps.length === 0 ? (
        <Empty description="该用户暂未授权任何应用" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Row gutter={[16, 16]}>
          {loginApps.map((app) => (
            <Col key={app.clientId} xs={24} sm={12} md={12} lg={8} xl={6}>
              <div
                className="user-app-card"
                onClick={() => navigate(`/apps/${app.clientId}`)}
                title="点击查看应用详情"
              >
                <div className="user-app-card__top">
                  <div className="user-app-card__icon">
                    <ApiOutlined />
                  </div>
                  <div className="user-app-card__meta">
                    <span className="user-app-card__name">{app.name || app.clientId}</span>
                    <Tag color="purple" style={{ width: 'fit-content', margin: 0, fontSize: 11 }}>
                      标准 Web 应用
                    </Tag>
                  </div>
                </div>

                <div className="user-app-card__bottom">
                  <div className="user-app-card__field">
                    <span className="user-app-card__field-label">Client ID</span>
                    <Tooltip title="点击复制" placement="topLeft">
                      <span
                        className="user-app-card__field-value"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(app.clientId);
                          messageApi.success('Client ID 已复制');
                        }}
                      >
                        {app.clientId}
                      </span>
                    </Tooltip>
                  </div>
                  {app.origin && (
                    <div className="user-app-card__field">
                      <span className="user-app-card__field-label">
                        <LinkOutlined style={{ marginRight: 2 }} />
                        回调
                      </span>
                      <Tooltip title="点击复制" placement="topLeft">
                        <span
                          className="user-app-card__field-value"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(app.origin);
                            messageApi.success('回调地址已复制');
                          }}
                        >
                          {app.origin}
                        </span>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );

  // ============ Tab：访问记录 ============
  const renderHistoryTab = () => (
    <Card
      bordered={false}
      title="访问记录"
      extra={
        <Button size="small" onClick={refreshHistory}>
          刷新
        </Button>
      }
    >
      <Table
        rowKey="_id"
        {...historyTableProps}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: '时间',
            dataIndex: 'loggedInAt',
            key: 'loggedInAt',
            width: 180,
            fixed: 'left',
            render: formatDate,
          },
          { title: '应用', dataIndex: 'clientId', key: 'clientId', width: 160 },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 90,
            render: (s) =>
              s === 'success' ? (
                <Badge status="success" text="成功" />
              ) : (
                <Badge status="error" text="失败" />
              ),
          },
          {
            title: '失败原因',
            dataIndex: 'failureReason',
            key: 'failureReason',
            width: 180,
            render: (v) => v || '-',
          },
          { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
          {
            title: '设备',
            key: 'ua',
            render: (_, log) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {[log.browser, log.os].filter(Boolean).join(' · ') || '-'}
              </Text>
            ),
          },
          {
            title: '位置',
            key: 'geo',
            render: (_, log) =>
              [log.country, log.region, log.city].filter(Boolean).join(' / ') || '-',
          },
        ]}
      />
    </Card>
  );

  // ============ Tab：原始 JSON（用 @uiw/react-json-view 只读渲染，支持折叠/复制）============
  const renderRawJsonTab = () => (
    <Card
      bordered={false}
      title="原始 JSON 数据"
      extra={
        <Button icon={<CopyOutlined />} size="small" onClick={handleCopyJson}>
          复制
        </Button>
      }
    >
      <div className="user-detail__json-viewer">
        <JsonView
          value={user || {}}
          displayDataTypes={false}
          displayObjectSize
          enableClipboard
          collapsed={2}
          shortenTextAfterLength={120}
          style={{
            ...monokaiTheme,
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.7,
            fontFamily: "'SF Mono', Monaco, Menlo, Consolas, monospace",
          }}
        />
      </div>
    </Card>
  );

  // ============ Tab：安全等级 ============
  const renderSecurityTab = () => (
    <Card bordered={false} title="安全等级">
      {/* 密码修改 */}
      <div className="security-section">
        <div className="security-section-header">
          <div>
            <Title level={5} style={{ margin: 0 }}>
              登录密码
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              用于账号密码方式登录系统
            </Text>
          </div>
          <Button icon={<KeyOutlined />} onClick={() => setPwdModalOpen(true)}>
            修改密码
          </Button>
        </div>
      </div>

      {/* 手机号绑定 */}
      <div className="security-section">
        <div className="security-section-header">
          <div>
            <Title level={5} style={{ margin: 0 }}>
              手机号绑定
              {user.phone &&
                (user.phoneVerified ? (
                  <Tag color="green" style={{ marginLeft: 8 }}>
                    已验证
                  </Tag>
                ) : (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    未验证
                  </Tag>
                ))}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {user.phone
                ? `当前绑定：${user.phone}`
                : '未绑定手机号，绑定后可用于短信验证码登录和 MFA'}
            </Text>
          </div>
          <Space>
            <Button
              onClick={() => {
                bindPhoneForm.resetFields();
                setBindPhoneOpen(true);
              }}
            >
              {user.phone ? '换绑' : '绑定'}
            </Button>
            {user.phone && (
              <Button danger onClick={handleUnbindPhone}>
                解绑
              </Button>
            )}
          </Space>
        </div>
      </div>

      {/* 邮箱绑定 */}
      <div className="security-section">
        <div className="security-section-header">
          <div>
            <Title level={5} style={{ margin: 0 }}>
              邮箱绑定
              {user.email &&
                (user.emailVerified ? (
                  <Tag color="green" style={{ marginLeft: 8 }}>
                    已验证
                  </Tag>
                ) : (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    未验证
                  </Tag>
                ))}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {user.email
                ? `当前绑定：${user.email}`
                : '未绑定邮箱，绑定后可用于邮箱验证码登录和 MFA'}
            </Text>
          </div>
          <Space>
            <Button
              onClick={() => {
                bindEmailForm.resetFields();
                setBindEmailOpen(true);
              }}
            >
              {user.email ? '换绑' : '绑定'}
            </Button>
            {user.email && (
              <Button danger onClick={handleUnbindEmail}>
                解绑
              </Button>
            )}
          </Space>
        </div>
      </div>

      {/* MFA 多因素认证 */}
      <div className="security-section">
        <div className="security-section-header">
          <div>
            <Title level={5} style={{ margin: 0 }}>
              多因素认证（MFA）
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {user.mfaEnabled ? '已开启，登录时需二次验证' : '未开启，建议开启以提升安全性'}
            </Text>
          </div>
          <Switch
            checked={!!user.mfaEnabled}
            onChange={handleToggleMfa}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </div>
        {user.mfaEnabled && (
          <div style={{ marginTop: 12, paddingLeft: 16 }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text>验证通道：</Text>
                <Select
                  value={user.mfaChannel || 'phone'}
                  onChange={handleChangeMfaChannel}
                  style={{ width: 200 }}
                  options={[
                    { value: 'phone', label: '📱 手机短信', disabled: !user.phone },
                    { value: 'email', label: '📧 邮箱验证', disabled: !user.email },
                    { value: 'totp', label: '🔐 认证器 App（TOTP）', disabled: !user.totpBound },
                  ]}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text>认证器 App（TOTP）：</Text>
                {user.totpBound ? (
                  <Space>
                    <Tag color="green">已绑定</Tag>
                    <Button size="small" icon={<QrcodeOutlined />} onClick={handleOpenTotpSetup}>
                      重新绑定
                    </Button>
                    <Button size="small" danger onClick={handleUnbindTotp}>
                      解绑
                    </Button>
                  </Space>
                ) : (
                  <Space>
                    <Tag>未绑定</Tag>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<QrcodeOutlined />}
                      onClick={handleOpenTotpSetup}
                    >
                      绑定
                    </Button>
                  </Space>
                )}
              </div>
            </Space>
          </div>
        )}
      </div>
    </Card>
  );

  // ============ Tab 配置 ============
  const tabItems = [
    { key: 'user-info', icon: <UserOutlined />, label: '个人信息', children: renderUserInfoTab() },
    {
      key: 'permission',
      icon: <LockOutlined />,
      label: '认证信息',
      children: renderPermissionTab(),
    },
    {
      key: 'authorization',
      icon: <ApiOutlined />,
      label: '账号绑定',
      children: renderAuthorizationTab(),
    },
    { key: 'history', icon: <KeyOutlined />, label: '访问记录', children: renderHistoryTab() },
    { key: 'security', icon: <LockOutlined />, label: '安全等级', children: renderSecurityTab() },
    { key: 'raw-json', icon: <CopyOutlined />, label: '原始 JSON', children: renderRawJsonTab() },
  ];

  return (
    <div className="user-detail-page page-container">
      {contextHolder}

      <BackButton />

      {/* 用户头像 + 名称 + 操作 */}
      <Card bordered={false} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar
            size={56}
            src={user.picture || user.photo || undefined}
            style={{ backgroundColor: '#5b50e8', fontSize: 22, fontWeight: 600 }}
          >
            {(user.name || user.username || '?').charAt(0)}
          </Avatar>
          <div style={{ flex: 1 }}>
            <Title level={5} style={{ margin: 0 }}>
              {user.nickname || user.name || user.username}
            </Title>
            <Space size={4} wrap style={{ marginTop: 4 }}>
              <Tag color={(ROLE_TAG[user.role] || {}).color}>
                {(ROLE_TAG[user.role] || {}).label}
              </Tag>
              <Badge {...(STATUS_BADGE[user.status] || { status: 'default', text: user.status })} />
              {user.blocked && <Tag color="red">已锁定</Tag>}
              {sessionInfo?.isOnline && (
                <Tag color="processing">{sessionInfo.activeSessions} 个会话在线</Tag>
              )}
            </Space>
          </div>
          <Dropdown
            menu={{ items: actionMenuItems, onClick: onActionClick }}
            placement="bottomRight"
          >
            <Button>
              操作 <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      </Card>

      {/* Tabs 左侧垂直模式 */}
      <Card bordered={false} className="user-detail-tabs-card">
        <Tabs tabPosition="left" activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      {/* ============ 绑定/换绑手机号弹窗 ============ */}
      <Modal
        title={user.phone ? '换绑手机号' : '绑定手机号'}
        open={bindPhoneOpen}
        onCancel={() => {
          setBindPhoneOpen(false);
          bindPhoneForm.resetFields();
        }}
        onOk={handleBindPhone}
        okText="确认绑定"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={bindPhoneForm} layout="vertical" style={{ marginTop: 16 }} autoComplete="off">
          <Form.Item
            label="新手机号"
            name="phone"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input prefix={<MobileOutlined />} placeholder="请输入新手机号" />
          </Form.Item>
          <Form.Item
            label="验证码"
            name="code"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <Input.Search
              placeholder="请输入收到的 6 位验证码"
              enterButton={
                <Button disabled={phoneCodeCountdown > 0} loading={phoneCodeSending}>
                  {phoneCodeCountdown > 0 ? `${phoneCodeCountdown}s 后重试` : '获取验证码'}
                </Button>
              }
              onSearch={handleSendPhoneCode}
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Demo 模式下验证码会在 message 提示和服务端日志中显示，5 分钟有效
          </Text>
        </Form>
      </Modal>

      {/* ============ 绑定/换绑邮箱弹窗 ============ */}
      <Modal
        title={user.email ? '换绑邮箱' : '绑定邮箱'}
        open={bindEmailOpen}
        onCancel={() => {
          setBindEmailOpen(false);
          bindEmailForm.resetFields();
        }}
        onOk={handleBindEmail}
        okText="确认绑定"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={bindEmailForm} layout="vertical" style={{ marginTop: 16 }} autoComplete="off">
          <Form.Item
            label="新邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="请输入新邮箱" />
          </Form.Item>
          <Form.Item
            label="验证码"
            name="code"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <Input.Search
              placeholder="请输入收到的 6 位验证码"
              enterButton={
                <Button disabled={emailCodeCountdown > 0} loading={emailCodeSending}>
                  {emailCodeCountdown > 0 ? `${emailCodeCountdown}s 后重试` : '获取验证码'}
                </Button>
              }
              onSearch={handleSendEmailCode}
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Demo 模式下验证码会在 message 提示和服务端日志中显示，5 分钟有效
          </Text>
        </Form>
      </Modal>

      {/* ============ 修改密码弹窗 ============ */}
      <Modal
        title="重置密码"
        open={pwdModalOpen}
        onCancel={() => {
          setPwdModalOpen(false);
          pwdForm.resetFields();
        }}
        onOk={handleResetPassword}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical" style={{ marginTop: 16 }} autoComplete="off">
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            label="确认密码"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, v) {
                  if (!v || getFieldValue('password') === v) return Promise.resolve();
                  return Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ============ TOTP 绑定弹窗（G7） ============
          流程说明：
          1. 打开弹窗时立即调 setupUserTotp 拿到 { qrCodeDataUrl, secret, otpauthUrl }
          2. 用户用 Google Authenticator / 1Password / Authy 等 App 扫码（或手动输入 secret）
          3. App 显示 6 位动态码（每 30s 刷新），用户输入后调 confirmUserTotp 校验
          4. 校验通过 → 后端正式入库 totpSecret + 清理 Redis 暂存 → 关闭弹窗 + 刷新用户详情 */}
      <Modal
        title={
          <Space>
            <QrcodeOutlined />
            绑定认证器 App（TOTP）
          </Space>
        }
        open={totpSetupOpen}
        onCancel={() => {
          setTotpSetupOpen(false);
          setTotpSetupData(null);
          setTotpConfirmCode('');
        }}
        onOk={handleConfirmTotp}
        okText="确认绑定"
        okButtonProps={{
          loading: totpConfirming,
          disabled: !totpSetupData || totpConfirmCode.length !== 6,
        }}
        cancelText="取消"
        destroyOnClose
        width={640}
      >
        {totpSetupLoading || !totpSetupData ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="正在生成密钥..." />
          </div>
        ) : (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="使用任意支持 TOTP 的认证器 App 扫描下方二维码"
              description="推荐：Google Authenticator / 1Password / Authy / 微软 Authenticator。扫码后，App 中会出现一个新条目，每 30 秒刷新一次的 6 位动态码。"
            />

            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img
                src={totpSetupData.qrCodeDataUrl}
                alt="TOTP 绑定二维码"
                style={{ width: 240, height: 240, border: '1px solid #f0f0f0', borderRadius: 8 }}
              />
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  账户：{totpSetupData.accountLabel}
                </Text>
              </div>
            </div>

            {/* 手动输入密钥兜底（部分 App 不支持扫码 / 二维码加载失败） */}
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                无法扫码？手动在 App 中粘贴以下密钥（Base32）：
              </Text>
              <Input
                readOnly
                value={totpSetupData.secret}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                addonAfter={
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => {
                      navigator.clipboard.writeText(totpSetupData.secret);
                      messageApi.success('密钥已复制');
                    }}
                  >
                    复制
                  </Button>
                }
              />
            </div>

            <Form layout="vertical">
              <Form.Item
                label="请输入认证器 App 显示的 6 位动态码"
                required
                style={{ marginBottom: 0 }}
              >
                <Input
                  placeholder="6 位数字"
                  value={totpConfirmCode}
                  onChange={(e) =>
                    setTotpConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  maxLength={6}
                  size="large"
                  style={{
                    textAlign: 'center',
                    fontSize: 18,
                    letterSpacing: 4,
                    fontFamily: 'monospace',
                  }}
                  autoFocus
                  onPressEnter={handleConfirmTotp}
                />
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 12 }}>
                动态码每 30 秒刷新；服务端允许 ±30 秒时钟偏移，输入失败请确认 App 时间同步。 密钥 5
                分钟内未确认将自动失效，需重新生成。
              </Text>
            </Form>
          </div>
        )}
      </Modal>
    </div>
  );
}
