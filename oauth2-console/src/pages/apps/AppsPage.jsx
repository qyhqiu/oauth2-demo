import React, { useState } from 'react';
import { Button, Typography, Input, Card, Empty, Spin, Row, Col } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import { getApps } from '../../api/index';
import CreateAppDrawer from './components/CreateAppDrawer';
import { AppCard } from '../../components/common';
import './AppsPage.scss';

const { Text, Title, Paragraph } = Typography;
const { Search } = Input;

export default function AppsPage() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const { data, loading, refresh } = useRequest(() => getApps({ pageSize: 100 }));

  const rawApps = data?.data?.list || data?.data || [];
  const apps = rawApps.filter(
    (app) => !searchText || app.name.includes(searchText) || app.clientId.includes(searchText),
  );

  const handleCreateSuccess = (newApp) => {
    setCreateDrawerOpen(false);
    refresh();
    // 创建成功后跳转到应用详情页（带 Client ID/Secret + 体验登录入口）
    if (newApp?.clientId) {
      navigate(`/apps/${newApp.clientId}`);
    }
  };

  return (
    <div className="apps-page page-container">
      <div className="page-header">
        <div>
          <Title level={4} className="page-title">
            自建应用
          </Title>
          <Paragraph type="secondary" className="page-subtitle">
            创建移动、Web、IoT 应用并使用 OAuth2 进行身份验证。
          </Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateDrawerOpen(true)}>
          创建自建应用
        </Button>
      </div>

      <Card bordered={false} className="apps-list-card">
        <div className="apps-toolbar">
          <Search
            placeholder="输入关键字搜索"
            allowClear
            style={{ width: 360 }}
            prefix={<SearchOutlined />}
            onSearch={setSearchText}
            onChange={(e) => !e.target.value && setSearchText('')}
          />
        </div>

        <Spin spinning={loading}>
          {apps.length === 0 ? (
            <Empty
              description="还没有应用，点击右上角创建第一个应用"
              style={{ padding: '60px 0' }}
            />
          ) : (
            <Row gutter={[16, 16]}>
              {apps.map((app) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={app.clientId}>
                  <AppCard app={app} onClick={() => navigate(`/apps/${app.clientId}`)} />
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </Card>

      <CreateAppDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
