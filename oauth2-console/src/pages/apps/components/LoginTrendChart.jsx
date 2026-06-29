import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Spin, Empty } from 'antd';
import { useRequest } from 'ahooks';
import { getLoginTrend } from '../../../api/index';

/**
 * 应用登录趋势折线图（基于 recharts，体积比 @ant-design/plots 小一个数量级）
 *
 * 数据来源：GET /api/console/apps/:clientId/login-trend
 * 当前 PoC 阶段后端返回的是基于 clientId 哈希生成的稳定伪随机数据，
 * 待接入真实登录埋点后即可展示真实趋势。
 */
export default function LoginTrendChart({ clientId, days = 7, height = 260 }) {
  const { data, loading } = useRequest(() => getLoginTrend(clientId, days), {
    refreshDeps: [clientId, days],
    ready: !!clientId,
  });

  const chartData = data?.data?.trend || [];

  if (loading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无登录数据"
        style={{ padding: 40 }}
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#8c8c8c' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#8c8c8c' }} />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #f0f0f0', fontSize: 12 }}
          labelStyle={{ color: '#1a1a2e', fontWeight: 600 }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
        <Line
          type="monotone"
          dataKey="loginCount"
          name="登录次数"
          stroke="#5b50e8"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="uniqueUsers"
          name="独立用户"
          stroke="#52c41a"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
