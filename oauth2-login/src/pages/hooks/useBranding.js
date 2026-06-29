import { useMemo } from 'react';
import { useRequest } from 'ahooks';
import { fetchBranding } from '../../api/branding';

const DEFAULT_BRANDING = {
  primaryColor: '#667eea',
  logoUrl: '',
  welcomeText: '',
  copyright: '',
  name: '',
};

/**
 * 颜色明度调整工具：把 #RRGGBB 调亮/调暗
 * @param {string} hex 形如 #5b50e8 的颜色
 * @param {number} percent -100 ~ 100，正数变亮，负数变暗
 */
function shadeColor(hex, percent) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return hex;
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const adjust = (value) => {
    const next = Math.round(value + (value * percent) / 100);
    return Math.max(0, Math.min(255, next));
  };
  const toHex = (number) => number.toString(16).padStart(2, '0');
  return `#${toHex(adjust(red))}${toHex(adjust(green))}${toHex(adjust(blue))}`;
}

/**
 * 拉取应用品牌化配置（Logo、主题色、欢迎语）+ 派生动态样式
 *
 * @param {string} clientId
 * @returns {{ branding: object, dynamicStyles: object }}
 */
export default function useBranding(clientId) {
  const { data: remoteBranding } = useRequest(() => fetchBranding(clientId), {
    ready: !!clientId,
    refreshDeps: [clientId],
    onSuccess: (data) => {
      if (data?.name) {
        document.title = `登录 · ${data.name}`;
      }
    },
  });

  const branding = useMemo(() => ({ ...DEFAULT_BRANDING, ...remoteBranding }), [remoteBranding]);

  const dynamicStyles = useMemo(() => {
    const primary = branding.primaryColor || DEFAULT_BRANDING.primaryColor;
    return {
      background: `linear-gradient(135deg, ${primary} 0%, ${shadeColor(primary, -25)} 100%)`,
      iconColor: primary,
      buttonBackground: `linear-gradient(135deg, ${primary} 0%, ${shadeColor(primary, -20)} 100%)`,
    };
  }, [branding.primaryColor]);

  return { branding, dynamicStyles, DEFAULT_BRANDING };
}
