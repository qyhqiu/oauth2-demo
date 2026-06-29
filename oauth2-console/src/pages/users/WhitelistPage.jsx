import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Typography,
  Switch,
  Tag,
  Divider,
  Alert,
  Tooltip,
} from 'antd';
import {
  SafetyCertificateOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ImportOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import {
  getWhitelistConfig,
  updateWhitelistConfig,
  getWhitelist,
  addWhitelistItem,
  deleteWhitelistItem,
  batchDeleteWhitelist,
  batchImportWhitelist,
} from '../../api/index';

const { Title, Text } = Typography;
const { TextArea } = Input;

const TYPE_LABEL = { phone: '手机号', email: '邮箱', username: '用户名' };
const TYPE_COLOR = { phone: 'green', email: 'blue', username: 'orange' };

export default function WhitelistPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [filterType, setFilterType] = useState(undefined);
  const [importText, setImportText] = useState('');
  const [importType, setImportType] = useState('email');
  const [form] = Form.useForm();

  const { data: configResp, refresh: refreshConfig } = useRequest(getWhitelistConfig, {
    onError: () => messageApi.error('加载配置失败'),
  });
  const config = configResp?.data || { registrationEnabled: true, whitelistEnabled: false };

  const {
    data: listResp,
    loading,
    refresh,
  } = useRequest(
    () => getWhitelist({ ...(filterType ? { type: filterType } : {}), pageSize: 100 }),
    { refreshDeps: [filterType], onError: () => messageApi.error('加载白名单失败') },
  );
  const whitelistItems = listResp?.data?.list || listResp?.data || [];

  const handleConfigChange = async (field, value) => {
    try {
      await updateWhitelistConfig({ [field]: value });
      messageApi.success('配置更新成功');
      refreshConfig();
    } catch (err) {
      messageApi.error(err?.error_description || '更新失败');
    }
  };

  const handleAdd = async () => {
    const values = await form.validateFields();
    try {
      await addWhitelistItem(values);
      messageApi.success('白名单条目添加成功');
      setAddModalOpen(false);
      form.resetFields();
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '添加失败');
    }
  };

  const handleDelete = async (itemId) => {
    try {
      await deleteWhitelistItem(itemId);
      messageApi.success('条目已删除');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedRowKeys.length) return;
    try {
      await batchDeleteWhitelist(selectedRowKeys);
      messageApi.success('批量删除完成');
      setSelectedRowKeys([]);
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '批量删除失败');
    }
  };

  const handleImport = async () => {
    const lines = importText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      messageApi.warning('请输入至少一条数据');
      return;
    }
    const items = lines.map((value) => ({ type: importType, value }));
    try {
      const result = await batchImportWhitelist(items);
      const data = result?.data || {};
      messageApi.success(`导入完成：成功 ${data.success || 0}，跳过 ${data.skipped || 0}`);
      setImportModalOpen(false);
      setImportText('');
      refresh();
    } catch (err) {
      messageApi.error(err?.error_description || '导入失败');
    }
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      fixed: 'left',
      render: (v) => <Tag color={TYPE_COLOR[v]}>{TYPE_LABEL[v] || v}</Tag>,
    },
    { title: '值', dataIndex: 'value', key: 'value', width: 220 },
    { title: '备注', dataIndex: 'remark', key: 'remark', render: (v) => v || '-' },
    {
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm title="确定删除该条目？" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
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
          <SafetyCertificateOutlined style={{ marginRight: 8, color: '#5b50e8' }} />
          注册白名单
        </Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              refresh();
              refreshConfig();
            }}
          >
            刷新
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportModalOpen(true)}>
            批量导入
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setAddModalOpen(true);
            }}
          >
            添加条目
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong>允许自行注册</Text>
            <Tooltip title="关闭后，仅管理员可通过控制台创建账号">
              <InfoCircleOutlined style={{ color: '#999' }} />
            </Tooltip>
            <Switch
              checked={config.registrationEnabled}
              onChange={(v) => handleConfigChange('registrationEnabled', v)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong>启用注册白名单</Text>
            <Tooltip title="开启后，仅白名单内的手机号/邮箱/用户名可注册。管理员创建账号不受限制">
              <InfoCircleOutlined style={{ color: '#999' }} />
            </Tooltip>
            <Switch
              checked={config.whitelistEnabled}
              disabled={!config.registrationEnabled}
              onChange={(v) => handleConfigChange('whitelistEnabled', v)}
            />
          </div>
        </div>
        {!config.registrationEnabled && (
          <Alert
            type="warning"
            showIcon
            message="当前已禁止用户自行注册，仅管理员可通过控制台创建账号"
            style={{ marginTop: 12 }}
          />
        )}
        {config.registrationEnabled && config.whitelistEnabled && (
          <Alert
            type="info"
            showIcon
            message="注册白名单已启用，仅白名单内的手机号/邮箱/用户名可自行注册"
            style={{ marginTop: 12 }}
          />
        )}
      </Card>

      <Card size="small">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Space>
            <Select
              style={{ width: 140 }}
              placeholder="按类型过滤"
              allowClear
              value={filterType}
              onChange={setFilterType}
              options={[
                { label: '手机号', value: 'phone' },
                { label: '邮箱', value: 'email' },
                { label: '用户名', value: 'username' },
              ]}
            />
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 条？`}
                onConfirm={handleBatchDelete}
              >
                <Button danger size="small" icon={<DeleteOutlined />}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
          </Space>
          <Text type="secondary">共 {whitelistItems.length} 条</Text>
        </div>
        <Table
          dataSource={whitelistItems}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 900 }}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        />
      </Card>

      <Modal
        title="添加白名单条目"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={handleAdd}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'email' }}>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '手机号', value: 'phone' },
                { label: '邮箱', value: 'email' },
                { label: '用户名', value: 'username' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="value"
            label="值"
            rules={[{ required: true, message: '请输入白名单值' }]}
          >
            <Input placeholder="如：13800000001 或 @company.com" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量导入白名单"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onOk={handleImport}
        destroyOnClose
        width={520}
      >
        <Form layout="vertical">
          <Form.Item label="导入类型">
            <Select
              value={importType}
              onChange={setImportType}
              options={[
                { label: '手机号', value: 'phone' },
                { label: '邮箱', value: 'email' },
                { label: '用户名', value: 'username' },
              ]}
            />
          </Form.Item>
          <Form.Item label="数据（每行一条）">
            <TextArea
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                '每行一条，例如：\nuser1@company.com\nuser2@company.com\n@department.com'
              }
            />
          </Form.Item>
          <Text type="secondary">已有重复条目将自动跳过</Text>
        </Form>
      </Modal>
    </div>
  );
}
