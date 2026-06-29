import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BackButton } from '../../components/common';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Select,
  message,
  Popconfirm,
  Typography,
  Tabs,
  Empty,
  Row,
  Col,
  Spin,
  Descriptions,
  Tag,
} from 'antd';
import {
  TeamOutlined,
  ArrowLeftOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  AppstoreAddOutlined,
  ApiOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import './GroupsPage.scss';
import { useRequest } from 'ahooks';
import {
  getGroups,
  getGroupMembers,
  addGroupMembers,
  removeGroupMembers,
  authorizeGroupApps,
  revokeGroupApps,
  getUsers,
  getApps,
} from '../../api/index';

const { Title } = Typography;

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState([]);
  const [addAppIds, setAddAppIds] = useState([]);

  const {
    data: groupsResp,
    loading: groupLoading,
    refresh: refreshGroup,
  } = useRequest(() => getGroups({ pageSize: 100 }), {
    onError: () => messageApi.error('加载分组信息失败'),
  });
  const groups = groupsResp?.data?.list || groupsResp?.data || [];
  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);

  const {
    data: membersResp,
    loading: membersLoading,
    refresh: refreshMembers,
  } = useRequest(() => (groupId ? getGroupMembers(groupId) : Promise.resolve({ data: [] })), {
    refreshDeps: [groupId],
  });
  const members = membersResp?.data?.list || membersResp?.data || [];

  const { data: allUsersResp } = useRequest(() => getUsers({ pageSize: 100 }));
  const allUsers = allUsersResp?.data?.list || allUsersResp?.data || [];

  const { data: allAppsResp } = useRequest(() => getApps({ pageSize: 100 }));
  const allApps = allAppsResp?.data?.list || allAppsResp?.data || [];

  const existingMemberIds = new Set(members.map((m) => m.id));
  const availableUsers = (Array.isArray(allUsers) ? allUsers : []).filter(
    (u) => !existingMemberIds.has(u.id),
  );

  const authorizedAppIds = new Set(group?.authorizedApps || []);
  const availableApps = (Array.isArray(allApps) ? allApps : []).filter(
    (a) => !authorizedAppIds.has(a.clientId),
  );

  const handleAddMembers = async () => {
    if (!addMemberIds.length) return;
    try {
      await addGroupMembers(groupId, addMemberIds);
      messageApi.success('成员添加成功');
      setMemberModalOpen(false);
      setAddMemberIds([]);
      refreshGroup();
      refreshMembers();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleRemoveMember = async (userId) => {
    try {
      await removeGroupMembers(groupId, [userId]);
      messageApi.success('成员已移除');
      refreshGroup();
      refreshMembers();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleAuthorizeApps = async () => {
    if (!addAppIds.length) return;
    try {
      await authorizeGroupApps(groupId, addAppIds);
      messageApi.success('应用授权成功');
      setAppModalOpen(false);
      setAddAppIds([]);
      refreshGroup();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleRevokeApp = async (clientId) => {
    try {
      await revokeGroupApps(groupId, [clientId]);
      messageApi.success('已取消授权');
      refreshGroup();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const memberColumns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 140,
      fixed: 'left',
      render: (v, record) => <a onClick={() => navigate(`/users/${record.id}`)}>{v || '-'}</a>,
    },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 140 },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (v) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm title="确定移除该成员？" onConfirm={() => handleRemoveMember(record.id)}>
          <Button type="link" size="small" danger icon={<UserDeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  if (groupLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!group) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description="分组不存在或已被删除">
          <Button type="primary" onClick={() => navigate('/users/groups')}>
            返回分组列表
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <BackButton
          rightNode={
            <Title level={4} style={{ margin: 0 }}>
              <TeamOutlined style={{ marginRight: 8, color: '#5b50e8' }} />
              {group.name}
            </Title>
          }
        />
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="分组名称">{group.name}</Descriptions.Item>
          <Descriptions.Item label="编码">{group.code || '-'}</Descriptions.Item>
          <Descriptions.Item label="成员数">
            <Tag color="purple">{group.memberCount || members.length || 0}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="已授权应用">
            <Tag color="blue">{(group.authorizedApps || []).length} 个应用</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {group.description || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small">
        <Tabs
          defaultActiveKey="members"
          items={[
            {
              key: 'members',
              label: `成员 (${members.length})`,
              children: (
                <div>
                  <div style={{ marginBottom: 12, textAlign: 'right' }}>
                    <Button
                      type="primary"
                      icon={<UserAddOutlined />}
                      onClick={() => {
                        setAddMemberIds([]);
                        setMemberModalOpen(true);
                      }}
                    >
                      添加成员
                    </Button>
                  </div>
                  <Table
                    dataSource={members}
                    columns={memberColumns}
                    rowKey="id"
                    size="small"
                    loading={membersLoading}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 600 }}
                  />
                </div>
              ),
            },
            {
              key: 'apps',
              label: `已授权应用 (${(group.authorizedApps || []).length})`,
              children: (
                <div>
                  <div style={{ marginBottom: 12, textAlign: 'right' }}>
                    <Button
                      type="primary"
                      icon={<AppstoreAddOutlined />}
                      onClick={() => {
                        setAddAppIds([]);
                        setAppModalOpen(true);
                      }}
                    >
                      授权应用
                    </Button>
                  </div>
                  {(group.authorizedApps || []).length === 0 ? (
                    <Empty description="暂无已授权应用" />
                  ) : (
                    <Row gutter={[16, 16]}>
                      {(group.authorizedApps || []).map((clientId) => {
                        const app = (Array.isArray(allApps) ? allApps : []).find(
                          (a) => a.clientId === clientId,
                        );
                        return (
                          <Col key={clientId} xs={24} sm={12} md={8} lg={6}>
                            <div className="group-app-card">
                              <Popconfirm
                                title="取消授权该应用？"
                                description="取消后该分组下成员将无法再访问此应用"
                                okText="取消授权"
                                okButtonProps={{ danger: true }}
                                cancelText="保留"
                                onConfirm={() => handleRevokeApp(clientId)}
                              >
                                <Button
                                  className="group-app-card__remove"
                                  type="text"
                                  size="small"
                                  shape="circle"
                                  title="取消授权"
                                  icon={<CloseOutlined />}
                                />
                              </Popconfirm>
                              <div
                                className="group-app-card__top"
                                onClick={() => navigate(`/apps/${clientId}`)}
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="group-app-card__icon">
                                  <ApiOutlined />
                                </div>
                                <div className="group-app-card__meta">
                                  <span className="group-app-card__name">
                                    {app ? app.name : clientId}
                                  </span>
                                  <span className="group-app-card__client-id">{clientId}</span>
                                </div>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="添加成员"
        open={memberModalOpen}
        onCancel={() => setMemberModalOpen(false)}
        onOk={handleAddMembers}
        destroyOnClose
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="搜索并选择用户"
          value={addMemberIds}
          onChange={setAddMemberIds}
          optionFilterProp="label"
          showSearch
          options={availableUsers.map((u) => ({
            label: `${u.name || u.username} (${u.email || u.phone || u.username})`,
            value: u.id,
          }))}
        />
      </Modal>

      <Modal
        title="授权应用"
        open={appModalOpen}
        onCancel={() => setAppModalOpen(false)}
        onOk={handleAuthorizeApps}
        destroyOnClose
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="搜索并选择应用"
          value={addAppIds}
          onChange={setAddAppIds}
          optionFilterProp="label"
          showSearch
          options={availableApps.map((a) => ({
            label: `${a.name} (${a.clientId})`,
            value: a.clientId,
          }))}
        />
      </Modal>
    </div>
  );
}
