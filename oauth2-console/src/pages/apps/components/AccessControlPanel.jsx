import React, { useState, useMemo } from 'react';
import {
  Typography,
  Radio,
  Select,
  Button,
  Table,
  Tag,
  Switch,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  message,
  Spin,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import {
  getAppAccessControlList,
  addAppAccessControlItem,
  updateAppAccessControlItem,
  deleteAppAccessControlItem,
  updateAppDefaultPermission,
  getUsers,
  getGroups,
} from '../../../api/index';

const { Title, Text } = Typography;

const TARGET_TYPE_OPTIONS = [
  { label: '所有授权对象类型', value: 'all' },
  { label: '用户', value: 'user' },
  { label: '角色', value: 'role' },
  { label: '分组', value: 'group' },
];

const TARGET_TYPE_LABEL = { user: '用户', role: '角色', group: '分组' };
const EFFECT_LABEL = { allow: '允许', deny: '拒绝' };

const ROLE_OPTIONS = [
  { label: '管理员（admin）', value: 'admin', name: '管理员' },
  { label: '普通用户（user）', value: 'user', name: '普通用户' },
];

export default function AccessControlPanel({ clientId }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [filterType, setFilterType] = useState('all');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();

  // 获取访问控制列表
  const {
    data: aclData,
    loading,
    refresh,
  } = useRequest(() => getAppAccessControlList(clientId, { targetType: filterType }), {
    refreshDeps: [clientId, filterType],
  });
  const defaultPermission = aclData?.data?.defaultPermission || 'allow';
  const accessControlList = aclData?.data?.list || [];

  // 更新默认权限
  const { loading: updatingDefault, runAsync: runUpdateDefault } = useRequest(
    (value) => updateAppDefaultPermission(clientId, value),
    { manual: true },
  );

  // 添加授权项
  const { loading: adding, runAsync: runAdd } = useRequest(
    (data) => addAppAccessControlItem(clientId, data),
    { manual: true },
  );

  // 更新授权项（启停 / 编辑）
  const { runAsync: runUpdate } = useRequest(
    (itemId, data) => updateAppAccessControlItem(clientId, itemId, data),
    { manual: true },
  );

  // 删除授权项
  const { runAsync: runDelete } = useRequest(
    (itemId) => deleteAppAccessControlItem(clientId, itemId),
    { manual: true },
  );

  const handleDefaultPermissionChange = async (e) => {
    try {
      await runUpdateDefault(e.target.value);
      messageApi.success('默认权限已更新');
      refresh();
    } catch (err) {
      messageApi.error(err?.message || '更新失败');
    }
  };

  const handleToggleEnabled = async (record, checked) => {
    try {
      await runUpdate(record._id, { enabled: checked });
      messageApi.success(checked ? '已启用' : '已停用');
      refresh();
    } catch (err) {
      messageApi.error(err?.message || '操作失败');
    }
  };

  const handleDelete = async (record) => {
    try {
      await runDelete(record._id);
      messageApi.success('已删除');
      refresh();
    } catch (err) {
      messageApi.error(err?.message || '删除失败');
    }
  };

  const handleAddSubmit = async () => {
    try {
      const values = await addForm.validateFields();
      await runAdd(values);
      messageApi.success('添加成功');
      setAddModalOpen(false);
      addForm.resetFields();
      refresh();
    } catch (err) {
      if (err?.message) messageApi.error(err.message);
    }
  };

  const columns = [
    {
      title: '授权对象名称',
      dataIndex: 'targetName',
      key: 'targetName',
      render: (text, record) => text || record.targetId,
    },
    {
      title: '授权类型',
      dataIndex: 'targetType',
      key: 'targetType',
      width: 120,
      render: (type) => TARGET_TYPE_LABEL[type] || type,
    },
    {
      title: '授权作用',
      dataIndex: 'effect',
      key: 'effect',
      width: 100,
      render: (effect) => (
        <Tag color={effect === 'allow' ? 'green' : 'red'}>{EFFECT_LABEL[effect] || effect}</Tag>
      ),
    },
    {
      title: '是否生效',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (enabled, record) => (
        <Switch
          checked={enabled}
          onChange={(checked) => handleToggleEnabled(record, checked)}
          size="small"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space>
          <Popconfirm
            title="确定删除此授权项？"
            onConfirm={() => handleDelete(record)}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {contextHolder}

      {/* 默认权限 */}
      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          默认权限
        </Text>
        <Radio.Group
          value={defaultPermission}
          onChange={handleDefaultPermissionChange}
          disabled={updatingDefault}
        >
          <Radio value="allow">允许所有用户访问</Radio>
          <Radio value="deny">拒绝所有用户访问</Radio>
        </Radio.Group>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            默认权限的生效优先级低于下方授权列表。例如：默认权限选择「拒绝所有用户访问」，但如果下方授权列表中有允许的授权项，则以列表中的授权优先。
          </Text>
        </div>
      </div>

      {/* 授权类型筛选 + 添加按钮 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            应用授权类型
          </Text>
          <Select
            value={filterType}
            onChange={setFilterType}
            options={TARGET_TYPE_OPTIONS}
            style={{ width: 180 }}
          />
        </div>
        <Button type="link" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
          添加
        </Button>
      </div>

      {/* 授权列表 */}
      <Table
        rowKey="_id"
        columns={columns}
        dataSource={accessControlList}
        loading={loading}
        pagination={false}
        size="middle"
        locale={{ emptyText: '暂无授权项' }}
      />

      {/* 添加授权弹窗 */}
      <AddAuthorizationModal
        open={addModalOpen}
        form={addForm}
        loading={adding}
        onOk={handleAddSubmit}
        onCancel={() => {
          setAddModalOpen(false);
          addForm.resetFields();
        }}
      />
    </div>
  );
}

function AddAuthorizationModal({ open, form, loading, onOk, onCancel }) {
  const targetType = Form.useWatch('targetType', form);

  // 搜索用户
  const {
    data: usersResp,
    loading: loadingUsers,
    run: searchUsers,
  } = useRequest((keyword) => getUsers({ keyword, page: 1, pageSize: 20 }), {
    manual: true,
    debounceWait: 300,
  });
  const userOptions = useMemo(() => {
    const list = usersResp?.data?.list || usersResp?.data || [];
    return list.map((user) => ({
      label: `${user.name || user.username} (${user.username})`,
      value: user.id || user._id,
      name: user.name || user.username,
    }));
  }, [usersResp]);

  // 获取分组列表
  const { data: groupsResp, loading: loadingGroups } = useRequest(
    () => getGroups({ page: 1, pageSize: 100 }),
    { ready: open },
  );
  const groupOptions = useMemo(() => {
    const list = groupsResp?.data?.list || groupsResp?.data || [];
    return list.map((group) => ({
      label: group.name,
      value: group.id || group._id,
      name: group.name,
    }));
  }, [groupsResp]);

  const handleTargetTypeChange = () => {
    form.setFieldsValue({ targetId: undefined, targetName: '' });
  };

  const handleTargetSelect = (value, option) => {
    form.setFieldsValue({ targetName: option?.name || option?.label || value });
  };

  return (
    <Modal
      title="添加授权"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="vertical" initialValues={{ effect: 'allow' }}>
        <Form.Item
          label="授权类型"
          name="targetType"
          rules={[{ required: true, message: '请选择授权类型' }]}
        >
          <Select
            placeholder="请选择授权类型"
            onChange={handleTargetTypeChange}
            options={[
              { label: '用户', value: 'user' },
              { label: '角色', value: 'role' },
              { label: '分组', value: 'group' },
            ]}
          />
        </Form.Item>

        {targetType === 'user' && (
          <Form.Item
            label="授权对象"
            name="targetId"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              showSearch
              placeholder="输入用户名、手机号或邮箱搜索"
              filterOption={false}
              onSearch={searchUsers}
              onSelect={handleTargetSelect}
              loading={loadingUsers}
              options={userOptions}
              notFoundContent={loadingUsers ? <Spin size="small" /> : '未找到用户'}
            />
          </Form.Item>
        )}

        {targetType === 'role' && (
          <Form.Item
            label="授权对象"
            name="targetId"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              placeholder="请选择角色"
              onSelect={handleTargetSelect}
              options={ROLE_OPTIONS.map((r) => ({ label: r.label, value: r.value, name: r.name }))}
            />
          </Form.Item>
        )}

        {targetType === 'group' && (
          <Form.Item
            label="授权对象"
            name="targetId"
            rules={[{ required: true, message: '请选择分组' }]}
          >
            <Select
              showSearch
              placeholder="请选择分组"
              optionFilterProp="label"
              onSelect={handleTargetSelect}
              loading={loadingGroups}
              options={groupOptions}
              notFoundContent={loadingGroups ? <Spin size="small" /> : '暂无分组'}
            />
          </Form.Item>
        )}

        <Form.Item name="targetName" hidden>
          <Input />
        </Form.Item>

        <Form.Item
          label="授权作用"
          name="effect"
          rules={[{ required: true, message: '请选择授权作用' }]}
        >
          <Radio.Group>
            <Radio value="allow">允许</Radio>
            <Radio value="deny">拒绝</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
