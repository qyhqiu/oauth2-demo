import React from 'react';
import { Row, Col, Card, Statistic, Typography, Tag, Button, Spin } from 'antd';
import {
  AppstoreOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import { getOverview, getApps } from '../../api/index';
import './OverviewPage.scss';

const { Title, Text, Paragraph } = Typography;

export default function OverviewPage() {
  const navigate = useNavigate();

  const { data: overviewData, loading: overviewLoading } = useRequest(getOverview, {
    onError: (err) => console.error(err),
  });

  const { data: appsData, loading: appsLoading } = useRequest(() => getApps({ pageSize: 100 }), {
    onError: (err) => console.error(err),
  });

  const stats = overviewData?.data || { totalApps: 0, totalUsers: 0, activeUsers: 0 };
  const apps = appsData?.data?.list || appsData?.data || [];

  const statCards = [
    {
      title: '已接入应用',
      value: stats.totalApps,
      icon: <AppstoreOutlined />,
      color: '#5b50e8',
      bgColor: '#eeecff',
    },
    {
      title: '总用户数',
      value: stats.totalUsers,
      icon: <TeamOutlined />,
      color: '#52c41a',
      bgColor: '#f6ffed',
    },
    {
      title: '活跃用户',
      value: stats.activeUsers,
      icon: <CheckCircleOutlined />,
      color: '#1890ff',
      bgColor: '#e6f4ff',
    },
  ];

  return (
    <div className="overview-page page-container">
      <div className="page-header">
        <div>
          <Title level={4} className="page-title">
            单点登录
          </Title>
          <Paragraph className="page-subtitle" type="secondary">
            单点登录是整合企业系统的解决方案之一，用户只需登录一次就可以访问所有相互信任的应用系统。
          </Paragraph>
        </div>
      </div>

      {/* 统计卡片 */}
      <Spin spinning={overviewLoading}>
        <Row gutter={16} className="overview-stats">
          {statCards.map((card) => (
            <Col span={8} key={card.title}>
              <Card className="stat-card" bordered={false}>
                <div className="stat-card__inner">
                  <div
                    className="stat-card__icon"
                    style={{ color: card.color, background: card.bgColor }}
                  >
                    {card.icon}
                  </div>
                  <div className="stat-card__content">
                    <Statistic
                      value={card.value}
                      valueStyle={{ color: card.color, fontSize: 28, fontWeight: 700 }}
                    />
                    <Text type="secondary" className="stat-card__label">
                      {card.title}
                    </Text>
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Spin>

      {/* 应用列表 */}
      <Card
        className="overview-apps"
        bordered={false}
        title={
          <div className="overview-apps__header">
            <span>应用列表</span>
            <Button
              type="link"
              size="small"
              icon={<ArrowRightOutlined />}
              onClick={() => navigate('/apps')}
            >
              查看全部
            </Button>
          </div>
        }
      >
        <Spin spinning={appsLoading}>
          <Row gutter={[16, 16]}>
            {apps.slice(0, 4).map((app) => (
              <Col xs={24} sm={12} lg={6} key={app.clientId}>
                <AppCard app={app} />
              </Col>
            ))}
          </Row>
        </Spin>
      </Card>
    </div>
  );
}

function AppCard({ app }) {
  return (
    <div className="app-card">
      <div className="app-card__header">
        <div className="app-card__icon">
          <ApiOutlined />
        </div>
        <div className="app-card__info">
          <Text strong className="app-card__name">
            {app.name}
          </Text>
          <Tag color="purple" className="app-card__tag">
            自建应用
          </Tag>
        </div>
      </div>
      <div className="app-card__meta">
        <Text type="secondary" className="app-card__id">
          APP ID: <code>{app.clientId}</code>
        </Text>
      </div>
      <Text className="app-card__origin" type="secondary">
        {app.origin}
      </Text>
    </div>
  );
}
