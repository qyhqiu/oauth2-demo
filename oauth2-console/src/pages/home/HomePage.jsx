import React, { useState } from 'react';
import { Row, Col, Card, Statistic, Typography, Button, Spin, Empty } from 'antd';
import {
  AppstoreOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import { getOverview, getApps } from '../../api/index';
import { AppCard } from '../../components/common';
import './HomePage.scss';

const { Title, Text, Paragraph } = Typography;

export default function HomePage() {
  const navigate = useNavigate();
  const { data: overviewData, loading: overviewLoading } = useRequest(getOverview);
  const { data: appsData, loading: appsLoading } = useRequest(() => getApps({ pageSize: 8 }));

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
    <div className="home-page page-container">
      <div className="page-header">
        <div>
          <Title level={4} className="page-title">
            首页
          </Title>
          <Paragraph className="page-subtitle" type="secondary">
            欢迎使用 OAuth2 控制台，集中管理你的应用、用户、权限和登录策略。
          </Paragraph>
        </div>
      </div>

      {/* 统计卡片 */}
      <Spin spinning={overviewLoading}>
        <Row gutter={16} className="home-stats">
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
      <Card className="home-apps" bordered={false} title="最近接入应用" extra={null}>
        <Spin spinning={appsLoading}>
          {apps.length === 0 ? (
            <Empty description="还没有接入任何应用，立即创建一个吧" />
          ) : (
            <>
              <Row gutter={[16, 16]}>
                {apps.slice(0, 8).map((app) => (
                  <Col xs={24} sm={12} lg={6} key={app.clientId}>
                    <AppCard app={app} onClick={() => navigate(`/apps/${app.clientId}`)} />
                  </Col>
                ))}
              </Row>
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Button
                  type="default"
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigate('/apps')}
                >
                  查看全部应用
                </Button>
              </div>
            </>
          )}
        </Spin>
      </Card>
    </div>
  );
}
