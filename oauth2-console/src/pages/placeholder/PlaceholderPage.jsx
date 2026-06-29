import React from 'react';
import { Empty, Typography, Card } from 'antd';

const { Title, Paragraph } = Typography;

export default function PlaceholderPage({ title, description }) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Title level={4} className="page-title">
            {title}
          </Title>
          <Paragraph className="page-subtitle" type="secondary">
            {description}
          </Paragraph>
        </div>
      </div>

      <Card bordered={false}>
        <Empty
          description={<span style={{ color: '#8c8c8c' }}>{description}</span>}
          style={{ padding: '60px 0' }}
        />
      </Card>
    </div>
  );
}
