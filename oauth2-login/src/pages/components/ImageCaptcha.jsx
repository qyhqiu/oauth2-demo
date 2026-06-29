import React, { useEffect, useCallback, useState } from 'react';
import { Input, Spin, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

const OAUTH2_SERVER = import.meta.env.VITE_OAUTH2_SERVER || 'http://localhost:3000';

/**
 * 图形验证码组件
 * - 展示 SVG 图形验证码
 * - 支持点击刷新
 * - 通过 onSessionIdChange 将 sessionId 回传给父组件
 */
export default function ImageCaptcha({ value, onChange, onSessionIdChange, disabled }) {
  const [loading, setLoading] = useState(false);
  const [svgHtml, setSvgHtml] = useState('');

  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${OAUTH2_SERVER}/v1/api/public/register-captcha/image-captcha`);
      const json = await response.json();
      if (json.code === 0 && json.data) {
        setSvgHtml(json.data.svg);
        onSessionIdChange?.(json.data.sessionId);
      }
    } catch (error) {
      console.error('获取图形验证码失败:', error);
    } finally {
      setLoading(false);
    }
  }, [onSessionIdChange]);

  useEffect(() => {
    fetchCaptcha();
  }, []);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Input
        placeholder="请输入图形验证码"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        style={{ flex: 1 }}
        maxLength={4}
        allowClear
        disabled={disabled}
      />

      <div
        style={{
          width: 120,
          height: 40,
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          overflow: 'hidden',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f0f4ff',
          flexShrink: 0,
        }}
        title="点击刷新验证码"
        onClick={fetchCaptcha}
      >
        {loading ? (
          <Spin size="small" />
        ) : svgHtml ? (
          <div dangerouslySetInnerHTML={{ __html: svgHtml }} style={{ lineHeight: 0 }} />
        ) : (
          <span style={{ fontSize: 12, color: '#999' }}>加载失败</span>
        )}
      </div>

      <Button
        icon={<ReloadOutlined />}
        onClick={fetchCaptcha}
        loading={loading}
        size="small"
        type="text"
        title="刷新验证码"
        disabled={disabled}
      />
    </div>
  );
}
