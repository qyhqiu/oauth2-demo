import React, { useState } from 'react';
import {
  Table,
  Tag,
  Radio,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  message,
  Typography,
  DatePicker,
} from 'antd';
import {
  ReloadOutlined,
  UnlockOutlined,
  ChromeOutlined,
  AppleOutlined,
  WindowsOutlined,
  AndroidOutlined,
  MobileOutlined,
  DesktopOutlined,
  EnvironmentOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useAntdTable, useRequest } from 'ahooks';
import dayjs from 'dayjs';
import { getLoginLogs, unlockUser, buildExportLogsUrl } from '../../../api';

const { RangePicker } = DatePicker;

const { Text } = Typography;

// 浏览器名 → 图标 + 主题色
function getBrowserIcon(browser) {
  if (!browser) return null;
  const lower = browser.toLowerCase();
  if (lower.includes('chrome')) return <ChromeOutlined style={{ color: '#4285f4' }} />;
  if (lower.includes('safari')) return <ChromeOutlined style={{ color: '#1b88ca' }} />;
  if (lower.includes('firefox')) return <ChromeOutlined style={{ color: '#ff9500' }} />;
  if (lower.includes('edge')) return <ChromeOutlined style={{ color: '#0078d7' }} />;
  return <ChromeOutlined style={{ color: '#8c8c8c' }} />;
}

// OS 名 → 图标
function getOsIcon(os) {
  if (!os) return null;
  const lower = os.toLowerCase();
  if (lower.includes('mac') || lower.includes('ios'))
    return <AppleOutlined style={{ color: '#000' }} />;
  if (lower.includes('windows')) return <WindowsOutlined style={{ color: '#0078d7' }} />;
  if (lower.includes('android')) return <AndroidOutlined style={{ color: '#3ddc84' }} />;
  if (lower.includes('linux')) return <DesktopOutlined style={{ color: '#dd4814' }} />;
  return <DesktopOutlined style={{ color: '#8c8c8c' }} />;
}

// 设备类型 → 中文名
function getDeviceLabel(device) {
  const map = {
    desktop: '桌面',
    mobile: '手机',
    tablet: '平板',
    smarttv: '电视',
    wearable: '可穿戴',
  };
  return map[device] || device || '桌面';
}

// 国家代码 → 国旗 emoji（A-Z 的 Unicode 区域指示符）
function getCountryFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2 || countryCode === 'LO') return '';
  const upper = countryCode.toUpperCase();
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

// 拼接地理位置展示文本
function formatLocation(record) {
  if (record.country === 'LOCAL') return '本地';
  const parts = [record.country, record.region, record.city].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

/**
 * 审计日志表格
 * - 状态筛选：全部 / 仅成功 / 仅失败
 * - 失败行可"解锁该账号"（清掉 Redis 中的失败计数 + 锁定标记）
 * - 表格懒加载：每次最多 100 条，按 loggedInAt 倒序
 */
export default function AuditLogTable({ clientId }) {
  const [statusFilter, setStatusFilter] = useState('all'); // all | success | failure
  // 时间范围：默认不筛选；选中后传给后端用于查询和导出
  const [dateRange, setDateRange] = useState(null); // [dayjs, dayjs] | null
  const [messageApi, contextHolder] = message.useMessage();

  const fetchLoginLogs = async ({ current, pageSize }) => {
    const params = { page: current, pageSize };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (dateRange?.[0]) params.startDate = dateRange[0].format('YYYY-MM-DD');
    if (dateRange?.[1]) params.endDate = dateRange[1].format('YYYY-MM-DD');
    const res = await getLoginLogs(clientId, params);
    const { list = [], total = 0 } = res?.data || {};
    return { total, list };
  };

  const { tableProps, refresh, loading } = useAntdTable(fetchLoginLogs, {
    defaultPageSize: 10,
    refreshDeps: [clientId, statusFilter, dateRange],
  });

  // 触发 XLSX 下载：用 a[download] 触发，避免 axios 拦截器把响应当 JSON 解析
  const handleExportCsv = () => {
    const url = buildExportLogsUrl(clientId, {
      status: statusFilter,
      startDate: dateRange?.[0]?.format('YYYY-MM-DD'),
      endDate: dateRange?.[1]?.format('YYYY-MM-DD'),
    });
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    messageApi.success('正在导出，下载即将开始');
  };

  const { runAsync: runUnlock, loading: unlocking } = useRequest(unlockUser, {
    manual: true,
    onSuccess: () => {
      messageApi.success('账号已解锁');
      refresh();
    },
    onError: (err) => messageApi.error(err?.error_description || '解锁失败'),
  });

  const columns = [
    {
      title: '时间',
      dataIndex: 'loggedInAt',
      width: 170,
      render: (v) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '账号',
      dataIndex: 'username',
      width: 120,
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status) =>
        status === 'success' ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>,
    },
    {
      title: '失败原因',
      dataIndex: 'failureReason',
      ellipsis: true,
      render: (reason, record) =>
        record.status === 'failure' ? (
          <Text type="danger">{reason || '-'}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '浏览器',
      dataIndex: 'browser',
      width: 130,
      render: (v) =>
        v ? (
          <Space size={6}>
            {getBrowserIcon(v)}
            <Text>{v}</Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '操作系统',
      dataIndex: 'os',
      width: 130,
      render: (v, record) =>
        v ? (
          <Space size={6}>
            {getOsIcon(v)}
            <Text>{v}</Text>
            {record.device && record.device !== 'desktop' && (
              <Tag icon={<MobileOutlined />} color="blue" style={{ marginLeft: 4 }}>
                {getDeviceLabel(record.device)}
              </Tag>
            )}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '位置',
      width: 150,
      render: (_, record) => {
        const loc = formatLocation(record);
        if (!loc) return <Text type="secondary">-</Text>;
        const flag = getCountryFlag(record.country);
        return (
          <Space size={4}>
            <EnvironmentOutlined style={{ color: '#52c41a' }} />
            {flag && <span style={{ fontSize: 14 }}>{flag}</span>}
            <Text>{loc}</Text>
          </Space>
        );
      },
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 130,
      render: (v, record) => {
        if (!v) return <Text type="secondary">-</Text>;
        return (
          <Tooltip title={record.userAgent || ''} placement="topLeft">
            <Text code style={{ fontSize: 12 }}>
              {v}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, record) => {
        // 仅"账号已锁定"等失败场景且有 userId 才提供解锁入口
        const canUnlock = record.status === 'failure' && record.userId;
        if (!canUnlock) return <Text type="secondary">-</Text>;
        return (
          <Popconfirm
            title={`确定解锁账号「${record.username}」吗？`}
            description="将清空该账号在此应用下的失败计数和锁定标记"
            okText="解锁"
            cancelText="取消"
            onConfirm={() => runUnlock(clientId, record.userId)}
          >
            <Button size="small" type="link" icon={<UnlockOutlined />} loading={unlocking}>
              解锁
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      {contextHolder}
      <Space style={{ marginBottom: 16 }} size={12} wrap>
        <Radio.Group
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="all">全部</Radio.Button>
          <Radio.Button value="success">仅成功</Radio.Button>
          <Radio.Button value="failure">仅失败</Radio.Button>
        </Radio.Group>
        <RangePicker
          value={dateRange}
          onChange={setDateRange}
          allowClear
          placeholder={['开始日期', '结束日期']}
          presets={[
            { label: '今天', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
            {
              label: '近 7 天',
              value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')],
            },
            {
              label: '近 30 天',
              value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')],
            },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          刷新
        </Button>
        <Tooltip title="导出 Excel（默认最近 30 天，可通过日期筛选自定义；最多 10000 条）">
          <Button icon={<DownloadOutlined />} type="primary" ghost onClick={handleExportCsv}>
            导出 Excel
          </Button>
        </Tooltip>
        <Text type="secondary" style={{ fontSize: 12 }}>
          列表展示最近 100 条；导出最多 10000 条
        </Text>
      </Space>

      <Table
        rowKey="_id"
        size="middle"
        columns={columns}
        {...tableProps}
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无登录记录' }}
      />
    </div>
  );
}
