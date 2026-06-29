import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Typography,
  Tag,
  Badge,
} from 'antd';
import {
  TeamOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import './GroupsPage.scss';
import { useRequest } from 'ahooks';
import { getGroups, createGroup, updateGroup, deleteGroup } from '../../api/index';

const { Title } = Typography;

export default function GroupsPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [form] = Form.useForm();

  const {
    data: groupsResp,
    loading,
    refresh,
  } = useRequest(() => getGroups({ pageSize: 100 }), {
    onError: () => messageApi.error('加载分组列表失败'),
  });
  const groups = groupsResp?.data?.list || groupsResp?.data || [];

  const openCreate = () => {
    setEditingGroup(null);
    form.resetFields();
    setModalOpen(true);
  };
  const openEdit = (group) => {
    setEditingGroup(group);
    form.setFieldsValue({ name: group.name, code: group.code, description: group.description });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (editingGroup) {
        await updateGroup(editingGroup.id, values);
        messageApi.success('分组更新成功');
      } else {
        await createGroup(values);
        messageApi.success('分组创建成功');
      }
      setModalOpen(false);
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleDelete = async (groupId) => {
    try {
      await deleteGroup(groupId);
      messageApi.success('分组已删除');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '删除失败');
    }
  };

  const groupColumns = [
    {
      title: '分组名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      fixed: 'left',
      render: (v, r) => <a onClick={() => navigate(`/users/groups/${r.id}`)}>{v}</a>,
    },
    { title: '编码', dataIndex: 'code', key: 'code', width: 160, render: (v) => v || '-' },
    {
      title: '成员数',
      dataIndex: 'memberCount',
      key: 'memberCount',
      width: 100,
      render: (v) => <Badge count={v || 0} showZero color="#5b50e8" overflowCount={999} />,
    },
    {
      title: '已授权应用',
      key: 'apps',
      width: 130,
      render: (_, r) => <Tag color="blue">{(r.authorizedApps || []).length} 个应用</Tag>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该分组？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginRight: 8, color: '#5b50e8' }} />
          分组管理
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建分组
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Table
          dataSource={groups}
          columns={groupColumns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={false}
          scroll={{ x: 1000 }}
          locale={{ emptyText: '暂无分组，点击右上方"新建分组"创建' }}
        />
      </Card>

      <Modal
        title={editingGroup ? '编辑分组' : '新建分组'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="分组名称"
            rules={[{ required: true, message: '请输入分组名称' }]}
          >
            <Input placeholder="如：VIP 用户组" />
          </Form.Item>
          <Form.Item name="code" label="分组编码">
            <Input placeholder="如：vip-group（可选）" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="分组描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
