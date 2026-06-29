import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

/**
 * 公用返回按钮组件
 * @param {string}   backUrl  - 指定跳转地址，不传则回退上一页
 * @param {string}   text     - 按钮文字，默认 "返回"
 * @param {function} onClick  - 额外的点击回调
 * @param {ReactNode} rightNode - 右侧节点
 */
export default function BackButton({ backUrl, text = '返回', onClick, rightNode }) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backUrl) {
      navigate(backUrl);
    } else {
      navigate(-1);
    }
    onClick?.();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
      <Button
        type="text"
        size="large"
        onClick={handleBack}
        style={{ padding: 0, height: 'auto', color: '#595959', marginRight: 16 }}
      >
        <ArrowLeftOutlined style={{ marginRight: 4 }} />
        {text}
      </Button>
      {rightNode}
    </div>
  );
}
