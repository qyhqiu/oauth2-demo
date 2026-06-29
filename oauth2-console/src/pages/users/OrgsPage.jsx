import React, { useState, useMemo } from 'react';
import {
  Card,
  Tree,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Typography,
  Empty,
  Spin,
  Table,
  Select,
  Tag,
} from 'antd';
import {
  ApartmentOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import {
  getOrgTree,
  createOrg,
  updateOrg,
  deleteOrg,
  getOrgList,
  getOrgMembers,
  addOrgMembers,
  removeOrgMembers,
  getUsers,
} from '../../api/index';

const { Title, Text } = Typography;

function flattenTree(nodes, result = []) {
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name });
    if (node.children?.length) flattenTree(node.children, result);
  }
  return result;
}

function toAntTreeData(nodes) {
  return nodes.map((node) => ({
    key: node.id,
    title: (
      <span>
        {node.name}
        {node.code ? (
          <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
            ({node.code})
          </Text>
        ) : null}
        <Tag style={{ marginLeft: 8 }} color="blue">
          {node.memberCount || 0} 人
        </Tag>
      </span>
    ),
    rawNode: node,
    children: node.children?.length ? toAntTreeData(node.children) : [],
  }));
}

export default function OrgsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState([]);
  const [form] = Form.useForm();

  const {
    data: treeResp,
    loading,
    refresh,
  } = useRequest(getOrgTree, {
    onError: () => messageApi.error('加载组织架构失败'),
  });
  const treeData = treeResp?.data || [];
  const antTreeData = useMemo(() => toAntTreeData(treeData), [treeData]);
  const flatOrgs = useMemo(() => flattenTree(treeData), [treeData]);

  const selectedOrg = useMemo(() => {
    function find(nodes) {
      for (const n of nodes) {
        if (n.id === selectedOrgId) return n;
        if (n.children?.length) {
          const r = find(n.children);
          if (r) return r;
        }
      }
      return null;
    }
    return selectedOrgId ? find(treeData) : null;
  }, [selectedOrgId, treeData]);

  const {
    data: membersResp,
    loading: membersLoading,
    refresh: refreshMembers,
  } = useRequest(
    () => (selectedOrgId ? getOrgMembers(selectedOrgId) : Promise.resolve({ data: [] })),
    { refreshDeps: [selectedOrgId] },
  );
  const members = membersResp?.data?.list || membersResp?.data || [];

  const { data: allUsersResp } = useRequest(() => getUsers({ pageSize: 100 }));
  const allUsers = allUsersResp?.data?.list || allUsersResp?.data || [];

  const openCreate = (parentId = null) => {
    setEditingOrg(null);
    form.resetFields();
    form.setFieldsValue({ parentId, order: 0 });
    setModalOpen(true);
  };
  const openEdit = (org) => {
    setEditingOrg(org);
    form.setFieldsValue({
      name: org.name,
      code: org.code,
      description: org.description,
      parentId: org.parentId,
      order: org.order || 0,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (editingOrg) {
        await updateOrg(editingOrg.id, values);
        messageApi.success('组织更新成功');
      } else {
        await createOrg(values);
        messageApi.success('组织创建成功');
      }
      setModalOpen(false);
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleDelete = async (orgId) => {
    try {
      await deleteOrg(orgId);
      messageApi.success('组织及其子节点已删除');
      if (selectedOrgId === orgId) setSelectedOrgId(null);
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '删除失败');
    }
  };

  const handleAddMembers = async () => {
    if (!addMemberIds.length) return;
    try {
      await addOrgMembers(selectedOrgId, addMemberIds);
      messageApi.success('成员添加成功');
      setMemberModalOpen(false);
      setAddMemberIds([]);
      refresh();
      refreshMembers();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const handleRemoveMember = async (userId) => {
    try {
      await removeOrgMembers(selectedOrgId, [userId]);
      messageApi.success('成员已移除');
      refresh();
      refreshMembers();
    } catch (err) {
      messageApi.error(err?.error_description || '操作失败');
    }
  };

  const memberColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username', render: (v) => v || '-' },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '邮箱', dataIndex: 'email', key: 'email', render: (v) => v || '-' },
    { title: '手机号', dataIndex: 'phone', key: 'phone', render: (v) => v || '-' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Popconfirm title="确定移除该成员？" onConfirm={() => handleRemoveMember(record.id)}>
          <Button type="link" size="small" danger icon={<UserDeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const existingMemberIds = new Set(members.map((m) => m.id));
  const availableUsers = (Array.isArray(allUsers) ? allUsers : []).filter(
    (u) => !existingMemberIds.has(u.id),
  );

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
          <ApartmentOutlined style={{ marginRight: 8, color: '#5b50e8' }} />
          组织架构
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            新建根节点
          </Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <Card style={{ width: 360, minHeight: 400 }} title="组织树" size="small">
          {loading ? (
            <Spin />
          ) : antTreeData.length === 0 ? (
            <Empty description="暂无组织" />
          ) : (
            <Tree
              treeData={antTreeData}
              defaultExpandAll
              selectedKeys={selectedOrgId ? [selectedOrgId] : []}
              onSelect={(keys) => setSelectedOrgId(keys[0] || null)}
              titleRender={(nodeData) => (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <span style={{ flex: 1 }}>{nodeData.title}</span>
                  <Space size={2} style={{ marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined style={{ fontSize: 12 }} />}
                      onClick={() => openCreate(nodeData.key)}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined style={{ fontSize: 12 }} />}
                      onClick={() => openEdit(nodeData.rawNode)}
                    />
                    <Popconfirm
                      title="删除此节点及所有子节点？"
                      onConfirm={() => handleDelete(nodeData.key)}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              )}
            />
          )}
        </Card>

        <Card
          style={{ flex: 1, minHeight: 400 }}
          title={selectedOrg ? `${selectedOrg.name} - 成员管理` : '请选择一个组织节点'}
          size="small"
          extra={
            selectedOrg ? (
              <Button
                size="small"
                type="primary"
                icon={<UserAddOutlined />}
                onClick={() => {
                  setAddMemberIds([]);
                  setMemberModalOpen(true);
                }}
              >
                添加成员
              </Button>
            ) : null
          }
        >
          {!selectedOrg ? (
            <Empty description="点击左侧树节点查看成员" />
          ) : (
            <Table
              dataSource={members}
              columns={memberColumns}
              rowKey="id"
              size="small"
              loading={membersLoading}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 600 }}
            />
          )}
        </Card>
      </div>

      <Modal
        title={editingOrg ? '编辑组织' : '新建组织'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="组织名称"
            rules={[{ required: true, message: '请输入组织名称' }]}
          >
            <Input placeholder="如：技术部" />
          </Form.Item>
          <Form.Item name="code" label="组织编码">
            <Input placeholder="如：tech-dept（可选）" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="组织描述（可选）" />
          </Form.Item>
          <Form.Item name="parentId" label="上级组织">
            <Select
              allowClear
              placeholder="无上级（根节点）"
              options={flatOrgs
                .filter((o) => o.id !== editingOrg?.id)
                .map((o) => ({ label: o.name, value: o.id }))}
            />
          </Form.Item>
          <Form.Item name="order" label="排序权重">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

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
    </div>
  );
}
