import React, { useState, useRef } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Popconfirm,
  message,
  Modal,
  Input,
  Card,
  Avatar,
  Badge,
  Segmented,
  Tooltip,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  EyeOutlined,
  UnlockOutlined,
  LockOutlined,
  UploadOutlined,
  DownloadOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useRequest, useAntdTable } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import {
  getUsers,
  deleteUser,
  forceLogout,
  getUserSessionsBatch,
  unlockUserAccount,
  importUsers,
  exportUsersBlob,
  getImportTemplateUrl,
} from '../../api/index';
import { getCachedUser } from '../../utils/auth';
import CreateUserModal from './components/CreateUserModal';
import './UsersPage.scss';

// E1：判定用户当前是否处于「已锁定」状态
// 与后端 isUserLocked 保持一致：blocked=true OR (lockedUntil && lockedUntil > now)
function isUserLocked(user) {
  if (!user) return false;
  if (user.blocked) return true;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return true;
  return false;
}

// 计算锁定剩余时长（分钟），仅用于 tooltip 展示
function getLockRemainText(user) {
  if (!user?.lockedUntil) return '';
  const remainMs = new Date(user.lockedUntil).getTime() - Date.now();
  if (remainMs <= 0) return '';
  const remainMin = Math.ceil(remainMs / 60000);
  return remainMin >= 60
    ? `${Math.floor(remainMin / 60)} 小时 ${remainMin % 60} 分钟后解锁`
    : `${remainMin} 分钟后解锁`;
}

const { Text } = Typography;
const { Search } = Input;
const ROLE_CONFIG = {
  admin: { label: '管理员', color: 'purple' },
  user: { label: '普通用户', color: 'green' },
};

export default function UsersPage() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [lockFilter, setLockFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const currentUser = getCachedUser();

  // useAntdTable：后端分页 + 搜索 + 锁定状态筛选
  const fetchUsers = async ({ current, pageSize }) => {
    const params = { page: current, pageSize, lockStatus: lockFilter };
    if (searchText) params.keyword = searchText;
    const res = await getUsers(params);
    const { list = [], total = 0 } = res?.data || {};
    return { total, list };
  };

  const { tableProps, refresh, loading } = useAntdTable(fetchUsers, {
    defaultPageSize: 10,
    refreshDeps: [lockFilter, searchText],
    onError: () => messageApi.error('获取用户列表失败'),
  });

  // sessions 批量查询（独立请求，不影响分页）
  const { data: sessionsData } = useRequest(
    () => getUserSessionsBatch().catch(() => ({ data: {} })),
    { refreshDeps: [tableProps.dataSource] },
  );
  const sessions = sessionsData?.data || {};

  const totalCount = tableProps.pagination?.total || 0;

  // E2：一键解锁
  const { runAsync: runUnlock } = useRequest(unlockUserAccount, {
    manual: true,
    onSuccess: (res) => {
      messageApi.success(res?.message || '账号已解锁');
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '解锁失败'),
  });

  // 批量导入
  const { loading: importing, runAsync: runImport } = useRequest(importUsers, {
    manual: true,
    onSuccess: (res) => {
      const { success, failed } = res?.data || {};
      messageApi.success(`导入完成：成功 ${success} 个${failed ? `，失败 ${failed} 个` : ''}`);
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '导入失败'),
  });

  // 导入弹框
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleDownloadTemplate = () => {
    const url = getImportTemplateUrl();
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSelectFile = (file) => {
    setImportFile(file);
    return false;
  };

  const handleImportConfirm = async () => {
    if (!importFile) {
      messageApi.warning('请先选择文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (jsonData.length < 2) {
          messageApi.error('文件至少需要表头 + 1 行数据');
          return;
        }
        const headerMap = {
          用户名: 'username',
          '用户名（必填）': 'username',
          姓名: 'name',
          邮箱: 'email',
          手机号: 'phone',
          密码: 'password',
          角色: 'role',
        };
        const headers = jsonData[0].map((h) => String(h).trim());
        const users = jsonData
          .slice(1)
          .map((row) => {
            const user = {};
            headers.forEach((h, i) => {
              const key = headerMap[h] || h;
              if (row[i] != null && String(row[i]).trim()) user[key] = String(row[i]).trim();
            });
            return user;
          })
          .filter((r) => r.username || r.phone || r.email);
        if (users.length === 0) {
          messageApi.error('未解析到有效用户数据');
          return;
        }
        if (users.length > 500) {
          messageApi.error('单次导入上限 500 条，当前文件包含 ' + users.length + ' 条数据');
          return;
        }
        await runImport(users);
        setImportModalOpen(false);
        setImportFile(null);
      } catch {
        messageApi.error('文件解析失败，请检查文件格式');
      }
    };
    reader.readAsArrayBuffer(importFile);
  };

  const handleExport = async () => {
    try {
      const blob = await exportUsersBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `users_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      messageApi.success('导出成功');
    } catch (err) {
      messageApi.error(err?.error_description || '导出失败');
    }
  };

  const { runAsync: runDelete } = useRequest(deleteUser, {
    manual: true,
    onSuccess: () => {
      messageApi.success('用户已删除');
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '删除失败'),
  });

  const { runAsync: runForceLogout } = useRequest(forceLogout, {
    manual: true,
    onSuccess: (res) => {
      messageApi.success(res?.message || '已强制下线');
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '操作失败'),
  });

  // F3：列宽显式设置 + 首列「用户」固定左侧 + 操作列固定右侧 + 表格 scroll.x=1280 触发横向滚动
  const columns = [
    {
      title: '用户',
      key: 'user',
      width: 200,
      fixed: 'left',
      render: (_, user) => (
        <Space size={10}>
          <Avatar
            size={32}
            src={user.picture || user.photo || undefined}
            style={{ backgroundColor: '#5b50e8', fontSize: 14, fontWeight: 600 }}
          >
            {(user.name || user.username || '?').charAt(0)}
          </Avatar>
          <a
            onClick={() => navigate(`/users/${user.id}`)}
            style={{ color: '#262626', fontWeight: 600 }}
          >
            {user.name || user.username || user.email || user.phone || '-'}
          </a>
        </Space>
      ),
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 130,
      render: (username) =>
        username ? <code className="mono-code">{username}</code> : <Text type="secondary">-</Text>,
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
      render: (phone) => phone || <Text type="secondary">-</Text>,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      render: (email) => email || <Text type="secondary">-</Text>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role) => {
        const config = ROLE_CONFIG[role] || { label: role, color: 'default' };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status) =>
        status === 'active' ? (
          <Badge status="success" text="活跃" />
        ) : (
          <Badge status="error" text="禁用" />
        ),
    },
    {
      title: '锁定状态',
      key: 'lockStatus',
      width: 140,
      render: (_, user) => {
        const locked = isUserLocked(user);
        if (!locked) return <Badge status="default" text="正常" />;
        // 区分两种锁定原因：管理员手动锁 vs MFA/密码失败自动锁
        const isAutoLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
        const remainText = getLockRemainText(user);
        const tooltipContent = isAutoLocked
          ? `${remainText}（连续登录失败 ${user.failedLoginAttempts || 0} 次）`
          : '管理员手动锁定（永久，需手动解锁）';
        return (
          <Tooltip title={tooltipContent}>
            <Tag
              icon={<LockOutlined />}
              color={isAutoLocked ? 'orange' : 'red'}
              style={{ cursor: 'help' }}
            >
              {isAutoLocked ? '自动锁定' : '管理员锁定'}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '在线状态',
      key: 'online',
      width: 110,
      render: (_, user) => {
        const sessionInfo = sessions[user.id];
        if (!sessionInfo) return <Text type="secondary">-</Text>;
        return sessionInfo.isOnline ? (
          <Badge status="processing" text={`${sessionInfo.activeSessions} 个会话`} />
        ) : (
          <Badge status="default" text="离线" />
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (date) => (date ? new Date(date).toLocaleDateString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      fixed: 'right',
      render: (_, user) => {
        const isOnline = sessions[user.id]?.isOnline;
        const locked = isUserLocked(user);
        const isSelf = currentUser?.id === user.id;
        return (
          <Space size={0}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/users/${user.id}`)}
            >
              详情
            </Button>
            {/* E2：一键解锁 — 仅对已锁定用户显示 */}
            {locked && (
              <Popconfirm
                title={`确定一键解锁「${user.name || user.username}」吗？`}
                description="将清零失败计数 + 解除自动/管理员锁 + 同步清理临时锁"
                onConfirm={() => runUnlock(user.id)}
                okText="解锁"
                cancelText="取消"
              >
                <Button
                  type="link"
                  size="small"
                  icon={<UnlockOutlined />}
                  style={{ color: '#52c41a' }}
                >
                  解锁
                </Button>
              </Popconfirm>
            )}
            {isOnline && !isSelf && (
              <Popconfirm
                title={`确定强制「${user.name}」下线吗？`}
                onConfirm={() => runForceLogout(user.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="link"
                  size="small"
                  icon={<ThunderboltOutlined />}
                  style={{ color: '#fa8c16' }}
                >
                  下线
                </Button>
              </Popconfirm>
            )}
            {!isSelf && (
              <Popconfirm
                title={`确定删除用户「${user.name}」吗？此操作不可恢复。`}
                onConfirm={() => runDelete(user.id)}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="users-page page-container">
      {contextHolder}

      <div className="page-header">
        <div>
          <div className="page-title">用户管理</div>
          <div className="page-subtitle">管理 OAuth2 系统中的所有用户账号</div>
        </div>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
            导入
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>
            导出
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            创建成员
          </Button>
        </Space>
      </div>

      <Card bordered={false} className="users-table-card">
        <div className="users-toolbar">
          <Space size={12} wrap>
            <Search
              placeholder="搜索姓名 / 用户名 / 邮箱 / 手机号"
              allowClear
              style={{ width: 300 }}
              prefix={<SearchOutlined />}
              onSearch={setSearchText}
              onChange={(e) => !e.target.value && setSearchText('')}
            />
            {/* E1：锁定状态筛选 Tab */}
            <Segmented
              value={lockFilter}
              onChange={setLockFilter}
              options={[
                { label: '全部', value: 'all' },
                {
                  label: (
                    <span>
                      <LockOutlined style={{ marginRight: 4 }} />
                      已锁定
                    </span>
                  ),
                  value: 'locked',
                },
                { label: '正常', value: 'normal' },
              ]}
            />
          </Space>
          <Text type="secondary" style={{ fontSize: 13 }}>
            共 {totalCount} 位用户
          </Text>
        </div>

        <Table
          rowKey="id"
          columns={columns}
          {...tableProps}
          loading={loading}
          scroll={{ x: 1430 }}
        />
      </Card>

      {/* 导入弹框 */}
      <Modal
        title="批量导入用户"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          setImportFile(null);
        }}
        footer={null}
        width={520}
        destroyOnClose
      >
        <div
          style={{
            border: '1px dashed #d9d9d9',
            borderRadius: 8,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <InboxOutlined style={{ fontSize: 40, color: '#999', marginBottom: 12 }} />
          <div style={{ marginBottom: 16, color: '#666' }}>
            请先
            <a onClick={handleDownloadTemplate} style={{ fontWeight: 600 }}>
              下载模板
            </a>
            ，填写数据后上传文件
          </div>
          <div
            style={{
              textAlign: 'left',
              color: '#999',
              fontSize: 13,
              marginBottom: 20,
              paddingLeft: 20,
            }}
          >
            <div>1. 请下载模板并按格式填写数据后再导入</div>
            <div>2. 文件大小不超过 2MB</div>
            <div>3. 单次导入上限 500 条</div>
          </div>
          <Space size={16}>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
              下载模板
            </Button>
            <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleSelectFile}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Space>
          {importFile && (
            <div
              style={{
                marginTop: 16,
                padding: '8px 16px',
                background: '#e6f4ff',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ color: '#1677ff' }}>📄 {importFile.name}</span>
              <Button type="primary" size="small" loading={importing} onClick={handleImportConfirm}>
                确认导入
              </Button>
            </div>
          )}
        </div>
      </Modal>

      <CreateUserModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSuccess={refresh}
      />
    </div>
  );
}
