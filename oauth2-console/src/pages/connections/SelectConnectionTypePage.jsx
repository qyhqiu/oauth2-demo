import React, { useState } from 'react';
import { Typography, Input, Row, Col, Card, Avatar } from 'antd';
import { BackButton } from '../../components/common';
import { GithubOutlined, SearchOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { useNavigate } from 'react-router-dom';
import { getSocialConnectionTypes } from '../../api';

const { Title, Text } = Typography;

const PROVIDER_ICONS = {
  gitee: 'https://gitee.com/favicon.ico',
  github: undefined,
};

const PROVIDER_COLORS = {
  gitee: '#C71D23',
  github: '#24292e',
  wechat: '#07C160',
  gitlab: '#FC6D26',
};

export default function SelectConnectionTypePage() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');

  const { data: providerTypes = [] } = useRequest(async () => {
    const res = await getSocialConnectionTypes();
    return res.data || [];
  });

  const filteredTypes = providerTypes.filter((type) => {
    if (!searchText) return true;
    const keyword = searchText.toLowerCase();
    return (
      type.name?.toLowerCase().includes(keyword) ||
      type.description?.toLowerCase().includes(keyword) ||
      type.id?.toLowerCase().includes(keyword)
    );
  });

  return (
    <div style={{ padding: '0 24px' }}>
      <BackButton />

      <Title level={3} style={{ marginBottom: 24 }}>
        选择社会化身份源
      </Title>

      <Input
        prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        placeholder="搜索"
        size="large"
        allowClear
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 24 }}
      />

      <Row gutter={[16, 16]}>
        {filteredTypes.map((type) => (
          <Col xs={24} sm={12} md={6} key={type.id}>
            <Card
              hoverable
              style={{ cursor: 'pointer', height: '100%' }}
              styles={{
                body: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px' },
              }}
              onClick={() => navigate(`/connections/social/create?provider=${type.id}`)}
            >
              <Avatar
                size={40}
                src={PROVIDER_ICONS[type.id]}
                icon={type.id === 'github' ? <GithubOutlined style={{ fontSize: 22 }} /> : null}
                style={{ backgroundColor: PROVIDER_COLORS[type.id] || '#8c8c8c', flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div>
                  <Text strong>{type.name}</Text>
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12 }}
                  ellipsis={{ tooltip: type.description }}
                >
                  {type.description}
                </Text>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
