import React, { useEffect } from 'react';
import { Form, Input, Button, ColorPicker, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { updateApp } from '../../../api';

/**
 * 品牌化配置表单（独立组件 + 路由级懒加载）
 *
 * 抽离原因：
 * - ColorPicker 是 antd 中体积较重的组件之一
 * - 品牌化 Tab 仅在配置场景使用，首屏完全用不到
 * - 抽成独立 chunk 后，Vite/Rollup 可以按 import() 动态切片，
 *   只有用户真正点开「品牌化」Tab 时才会下载这部分代码
 */
export default function BrandingForm({ clientId, initialValue, onSaved }) {
  const [brandForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (initialValue) {
      brandForm.setFieldsValue(initialValue);
    }
  }, [initialValue, brandForm]);

  const { loading: saving, runAsync: runSave } = useRequest(
    (values) => updateApp(clientId, { branding: values }),
    {
      manual: true,
      onSuccess: () => {
        messageApi.success('品牌化配置已保存');
        onSaved?.();
      },
      onError: (err) => messageApi.error(err?.error_description || '保存失败'),
    },
  );

  const handleSave = async () => {
    const values = await brandForm.validateFields();
    // ColorPicker 返回 Color 对象，需要转字符串再保存
    const payload = {
      ...values,
      primaryColor:
        typeof values.primaryColor === 'string'
          ? values.primaryColor
          : values.primaryColor?.toHexString?.() || '#5b50e8',
    };
    await runSave(payload);
  };

  return (
    <>
      {contextHolder}
      <Form
        form={brandForm}
        layout="horizontal"
        labelCol={{ span: 6 }}
        wrapperCol={{ span: 14 }}
        style={{ maxWidth: 720 }}
      >
        <Form.Item label="登录页 Logo" name="logoUrl" extra="支持公网 URL，建议尺寸 120 x 120 px">
          <Input placeholder="https://example.com/logo.png" />
        </Form.Item>
        <Form.Item label="主题色" name="primaryColor" extra="影响登录按钮、链接颜色">
          <ColorPicker showText />
        </Form.Item>
        <Form.Item label="欢迎语" name="welcomeText">
          <Input placeholder="欢迎登录企业内网" maxLength={50} showCount />
        </Form.Item>
        <Form.Item label="底部版权" name="copyright">
          <Input
            placeholder="© 2026 Your Company. All rights reserved."
            maxLength={100}
            showCount
          />
        </Form.Item>
        <Form.Item wrapperCol={{ offset: 6 }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            保存品牌化配置
          </Button>
        </Form.Item>
      </Form>
    </>
  );
}
