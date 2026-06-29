import React from 'react';
import { Typography, Tag } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import './AppCard.scss';

const { Text } = Typography;

/**
 * 应用卡片组件 - /apps 和 /home 页面共用
 * @param {object}   app     - 应用数据对象 { name, totalLogins, ... }
 * @param {function} onClick - 点击卡片回调
 */
export default function AppCard({ app, onClick }) {
  return (
    <div className="app-card-common" onClick={onClick}>
      <div className="app-card-common__header">
        <div className="app-card-common__icon">
          <ApiOutlined />
        </div>
        <div className="app-card-common__meta">
          <Text strong className="app-card-common__name">
            {app.name}
          </Text>
          <Tag color="purple" className="app-card-common__tag">
            标准 Web 应用
          </Tag>
        </div>
      </div>
      <div className="app-card-common__chart">
        <Text type="secondary" style={{ fontSize: 12 }}>
          登录趋势
        </Text>
        <div className="app-card-common__chart-bar">
          <div className="app-card-common__chart-dot" />
          <Text className="app-card-common__chart-value">{app.totalLogins ?? 0}</Text>
        </div>
      </div>
    </div>
  );
}
