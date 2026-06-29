import React from 'react';
import { Card, Table, Button, Space, Tag, Typography, message, Popconfirm, Avatar } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GithubOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import { getSocialConnections, deleteSocialConnection } from '../../api';

const { Title, Text } = Typography;

const PROVIDER_ICONS = {
  gitee: 'https://gitee.com/favicon.ico',
  github: undefined,
};

const PROVIDER_COLORS = {
  gitee: '#C71D23',
  github: '#24292e',
};

export default function SocialConnectionsPage() {
  const navigate = useNavigate();

  const {
    data: connections,
    loading,
    refresh,
  } = useRequest(async () => {
    const res = await getSocialConnections();
    return res.data;
  });

  const handleDelete = async (connectionId) => {
    try {
      await deleteSocialConnection(connectionId);
      message.success('删除成功');
      refresh();
    } catch (error) {
      message.error(error?.error_description || '删除失败');
    }
  };

  const columns = [
    {
      title: '身份源',
      dataIndex: 'provider',
      render: (provider, record) => (
        <Space>
          <Avatar
            size="small"
            src={PROVIDER_ICONS[provider]}
            icon={provider === 'github' ? <GithubOutlined /> : null}
            style={{ backgroundColor: PROVIDER_COLORS[provider] }}
          />
          <div>
            <div>
              <Text strong>{record.displayName || provider.toUpperCase()}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.identifier}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      render: (enabled) => (
        <Tag color={enabled ? 'success' : 'default'}>{enabled ? '已启用' : '未启用'}</Tag>
      ),
    },
    {
      title: '登录模式',
      dataIndex: 'loginMode',
      width: 120,
      render: (mode) => (mode === 'login_only' ? '仅登录' : '登录并注册'),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (date) => new Date(date).toLocaleString(),
    },
    {
      title: '操作',
      width: 140,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/connections/social/${record._id}/edit`)}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除此身份源？" onConfirm={() => handleDelete(record._id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          社会化身份源
        </Title>
        <Text type="secondary">
          配置社会化登录（如 Gitee、GitHub），让用户可以使用第三方账号快速登录。
        </Text>
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text strong>已配置的身份源</Text>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/connections/social/select')}
          >
            创建身份源
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={connections || []}
          rowKey="_id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无身份源，点击「创建身份源」添加' }}
        />
      </Card>
    </div>
  );
}
