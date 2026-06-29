import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Card,
  Empty,
  Spin,
  Typography,
  Tag,
  Space,
  Radio,
  Button,
  Breadcrumb,
  message,
} from 'antd';
import { GlobalOutlined, RollbackOutlined, EnvironmentOutlined } from '@ant-design/icons';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  GeoComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react/lib/core';
import { useRequest } from 'ahooks';
import { useSearchParams } from 'react-router-dom';
import { getLoginGeo } from '../../../api';
import {
  codeToMapName,
  codeToCnName,
  codeToFlag,
  cnRegionToMapName,
  cnRegionToShortName,
} from '../../../utils/countryMap';
import worldGeoJson from '../../../assets/maps/world.json';

const { Text, Title } = Typography;

// 仅注册必要的组件，减少打包体积（echarts 5 模块化）
echarts.use([
  MapChart,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  GeoComponent,
  CanvasRenderer,
]);

// 地图懒注册：world 在组件挂载即注册（首屏地图必备），china 只在用户下钻时按需 import 后注册
// 用模块级 flag 避免重复注册（echarts.registerMap 重复调用虽无报错，但会重新解析 GeoJSON 浪费性能）
let worldMapRegistered = false;
let chinaMapRegistered = false;

function ensureWorldMapRegistered() {
  if (!worldMapRegistered) {
    echarts.registerMap('world', worldGeoJson);
    worldMapRegistered = true;
  }
}

/**
 * 懒加载注册中国地图：动态 import china.json（webpack/vite 会拆出独立 chunk，
 * 控制台首屏不加载，仅在用户点击中国下钻时才请求）
 */
async function ensureChinaMapRegistered() {
  if (chinaMapRegistered) return;
  const mod = await import('../../../assets/maps/china.json');
  echarts.registerMap('china', mod.default || mod);
  chinaMapRegistered = true;
}

// =====================================================================
// URL Query 同步工具
// 让分享链接可直达指定下钻视图，例如：
//   /apps/xxx?mapLevel=china&mapDays=90  → 直接打开中国省级 + 90 天窗口
//
// 设计原则：
// 1. 只读写 mapLevel / mapDays 两个 key，保留页面其他 query 参数（详情页可能有 tab 等）
// 2. 默认值（world + 30 天）时不写入 URL，保持分享链接干净；非默认才写入
// 3. 非法值（如 mapDays=999）安全降级到默认，不抛异常
// =====================================================================

const VALID_MAP_LEVELS = ['world', 'china'];
const VALID_MAP_DAYS = [7, 30, 90];
const DEFAULT_MAP_LEVEL = 'world';
const DEFAULT_MAP_DAYS = 30;

/**
 * 从 URLSearchParams 中解析地图视图状态
 * @param {URLSearchParams} searchParams
 * @param {number} fallbackDays 当 URL 没有 mapDays 时使用的默认天数（来自组件 props）
 * @returns {{mapLevel: 'world'|'china', windowDays: number}}
 */
function parseMapStateFromQuery(searchParams, fallbackDays) {
  const rawLevel = searchParams.get('mapLevel');
  const rawDays = parseInt(searchParams.get('mapDays'), 10);
  return {
    mapLevel: VALID_MAP_LEVELS.includes(rawLevel) ? rawLevel : DEFAULT_MAP_LEVEL,
    windowDays: VALID_MAP_DAYS.includes(rawDays) ? rawDays : fallbackDays,
  };
}

/**
 * 把当前地图视图状态写回 URLSearchParams（不改动其他 key）
 * @param {URLSearchParams} prev
 * @param {{mapLevel: string, windowDays: number}} next
 * @returns {URLSearchParams}
 */
function applyMapStateToQuery(prev, { mapLevel, windowDays }) {
  const merged = new URLSearchParams(prev);
  // 默认值不写入 URL，保持链接干净
  if (mapLevel && mapLevel !== DEFAULT_MAP_LEVEL) merged.set('mapLevel', mapLevel);
  else merged.delete('mapLevel');

  if (windowDays && windowDays !== DEFAULT_MAP_DAYS) merged.set('mapDays', String(windowDays));
  else merged.delete('mapDays');

  return merged;
}

/**
 * 地理分布地图组件（支持 World ↔ China 双层下钻）
 *
 * 视图层级：
 * - mapLevel='world'：世界地图，按国家聚合；点击 "China" 区域可下钻到中国省级
 * - mapLevel='china'：中国地图，按省份聚合（数据来自 login-geo?level=region&country=CN）
 *
 * 数据流：
 * - 国家级：getLoginGeo(clientId, { days })  → [{ country, count, cities }]，
 *   前端用 codeToMapName 把 ISO Alpha-2 转成 world.json 区域名
 * - 省级：  getLoginGeo(clientId, { days, level:'region', country:'CN' })
 *   → [{ region, count, cities }]，前端用 cnRegionToMapName 把 BJ/SH/JS 转成中文省名
 */
export default function GeoDistributionMap({ clientId, days = 30 }) {
  // URL Query 同步：mapLevel + mapDays 写进地址栏，让分享链接可直达指定视图
  // 用 lazy initializer 仅在首次挂载时读 URL，后续靠 setter 包装 + searchParams 监听双向同步
  const [searchParams, setSearchParams] = useSearchParams();
  const initialState = parseMapStateFromQuery(searchParams, days);

  const [windowDays, setWindowDaysState] = useState(initialState.windowDays);
  const [mapLevel, setMapLevelState] = useState(initialState.mapLevel);
  // china 地图首次进入时需要等待 import + registerMap 完成才能渲染
  // 注意：如果初始 URL 就是 mapLevel=china，这里需要立刻触发 china 地图加载（见下方 useEffect）
  const [chinaMapReady, setChinaMapReady] = useState(false);

  // 包装 setter：state 变化的同时把新值写回 URL（replace: true 不污染后退栈）
  // 用 setSearchParams 的函数式更新，确保读到的 prev 永远是最新的，避免并发更新丢失
  const setMapLevel = useCallback(
    (next) => {
      setMapLevelState(next);
      setSearchParams((prev) => applyMapStateToQuery(prev, { mapLevel: next, windowDays }), {
        replace: true,
      });
    },
    [setSearchParams, windowDays],
  );

  const setWindowDays = useCallback(
    (next) => {
      setWindowDaysState(next);
      setSearchParams((prev) => applyMapStateToQuery(prev, { mapLevel, windowDays: next }), {
        replace: true,
      });
    },
    [setSearchParams, mapLevel],
  );

  // 反向同步：浏览器前进/后退按钮 / 外部脚本改 URL 时，把组件 state 拉回与 URL 一致
  // 仅当 URL 中的值与当前 state 不一致时才 setState，避免触发死循环
  useEffect(() => {
    const next = parseMapStateFromQuery(searchParams, days);
    if (next.mapLevel !== mapLevel) setMapLevelState(next.mapLevel);
    if (next.windowDays !== windowDays) setWindowDaysState(next.windowDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 国家级数据
  const { data: countryResp, loading: countryLoading } = useRequest(
    () => getLoginGeo(clientId, { days: windowDays, level: 'country' }),
    { refreshDeps: [clientId, windowDays] },
  );

  // 省级数据：仅在 mapLevel='china' 时才请求（ready=false 时 useRequest 不触发）
  const { data: regionResp, loading: regionLoading } = useRequest(
    () => getLoginGeo(clientId, { days: windowDays, level: 'region', country: 'CN' }),
    { ready: mapLevel === 'china', refreshDeps: [clientId, windowDays, mapLevel] },
  );

  useEffect(() => {
    ensureWorldMapRegistered();
  }, []);

  // 切换到 china 视图时按需注册中国地图
  // 注意：依赖中加上 setMapLevel（包装版），保证 catch 中拿到最新 setter，避免闭包陷阱
  useEffect(() => {
    if (mapLevel !== 'china') return;
    let cancelled = false;
    ensureChinaMapRegistered()
      .then(() => {
        if (!cancelled) setChinaMapReady(true);
      })
      .catch((err) => {
        console.error('[GeoDistributionMap] 加载中国地图失败:', err);
        message.error('中国地图加载失败');
        if (!cancelled) setMapLevel('world');
      });
    return () => {
      cancelled = true;
    };
  }, [mapLevel, setMapLevel]);

  // ============= 国家级 series 数据（world 视图）=============
  const countryData = countryResp?.data || [];
  const worldSeriesData = useMemo(() => {
    // HK/TW/MO 都映射到 China，需合并 count + 累计 codes/cities
    const merged = new Map();
    countryData.forEach((item) => {
      const mapName = codeToMapName(item.country);
      const prev = merged.get(mapName) || { value: 0, codes: [], cities: [] };
      merged.set(mapName, {
        value: prev.value + item.count,
        codes: [...prev.codes, item.country],
        cities: [...prev.cities, ...(item.cities || [])],
      });
    });
    return Array.from(merged.entries()).map(([name, info]) => ({
      name,
      value: info.value,
      codes: info.codes,
      cities: info.cities.filter(Boolean),
    }));
  }, [countryData]);

  // ============= 省级 series 数据（china 视图）=============
  const regionData = regionResp?.data || [];
  const chinaSeriesData = useMemo(() => {
    // china.json 的 properties.name 是中文全称，需把 region (BJ/SH/JS) 桥接为中文省名
    return regionData
      .map((item) => {
        const mapName = cnRegionToMapName(item.region);
        if (!mapName) return null;
        return {
          name: mapName,
          value: item.count,
          region: item.region,
          cities: (item.cities || []).filter(Boolean),
        };
      })
      .filter(Boolean);
  }, [regionData]);

  // ============= 当前视图统一变量 =============
  const isWorldLevel = mapLevel === 'world';
  const seriesData = isWorldLevel ? worldSeriesData : chinaSeriesData;
  const loading = isWorldLevel ? countryLoading : regionLoading || !chinaMapReady;
  const maxValue = Math.max(1, ...seriesData.map((d) => d.value));
  const totalLogins = seriesData.reduce((s, d) => s + d.value, 0);

  // ============= 下钻交互 =============
  // 点击地图区域：world 视图下点击 China 进入下钻（同时把状态写回 URL）
  const handleMapClick = useCallback(
    (params) => {
      if (!isWorldLevel) return;
      if (params?.name === 'China') {
        setChinaMapReady(false);
        setMapLevel('china');
      }
    },
    [isWorldLevel, setMapLevel],
  );

  const handleBackToWorld = useCallback(() => {
    setMapLevel('world');
  }, [setMapLevel]);

  // ============= echarts option =============
  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          if (!params.data) {
            return `<b>${params.name}</b><br/>暂无登录记录`;
          }
          const cities = params.data.cities || [];
          const cityText = cities.length
            ? `<br/>城市: ${[...new Set(cities)].slice(0, 5).join(' · ')}`
            : '';

          if (isWorldLevel) {
            const code = (params.data.codes || [])[0];
            const flag = codeToFlag(code) || '🌍';
            const cnName = codeToCnName(code) || params.name;
            const drillHint =
              params.name === 'China'
                ? '<br/><span style="color:#5b50e8;font-size:11px">点击下钻到省级 →</span>'
                : '';
            return `${flag} <b>${cnName}</b><br/>登录次数: <b style="color:#5b50e8">${params.value || 0}</b>${cityText}${drillHint}`;
          }
          // 省级 tooltip
          return `🇨🇳 <b>${params.name}</b><br/>登录次数: <b style="color:#5b50e8">${params.value || 0}</b>${cityText}`;
        },
      },
      visualMap: {
        min: 0,
        max: maxValue,
        left: 'left',
        bottom: 12,
        text: ['多', '少'],
        calculable: true,
        itemWidth: 12,
        itemHeight: 100,
        inRange: {
          color: ['#e6f4ff', '#91caff', '#5b50e8', '#3a32a0'],
        },
        textStyle: { fontSize: 12 },
      },
      series: [
        {
          name: '登录次数',
          type: 'map',
          // china 视图下用 china map；其余仍用 world
          map: isWorldLevel ? 'world' : 'china',
          roam: true,
          scaleLimit: { min: 1, max: 5 },
          // 省级视图自动展示省份名（中国地图区域较少，标签不会拥挤）
          label: { show: !isWorldLevel, fontSize: 10, color: '#595959' },
          itemStyle: {
            areaColor: '#fafafa',
            borderColor: '#d9d9d9',
            borderWidth: 0.5,
          },
          emphasis: {
            itemStyle: { areaColor: '#ffd666' },
            label: { show: true, fontSize: 11, color: '#262626' },
          },
          data: seriesData,
        },
      ],
    }),
    [seriesData, maxValue, isWorldLevel],
  );

  // ============= TOP 5 排行（兼容两种维度）=============
  const topItems = useMemo(() => {
    return [...seriesData].sort((a, b) => b.value - a.value).slice(0, 5);
  }, [seriesData]);

  // ============= 渲染 =============
  return (
    <Card
      bordered={false}
      bodyStyle={{ padding: 0 }}
      title={
        <Space size={8}>
          {isWorldLevel ? (
            <GlobalOutlined style={{ color: '#5b50e8' }} />
          ) : (
            <EnvironmentOutlined style={{ color: '#5b50e8' }} />
          )}
          <Text strong>地理分布</Text>
          <Tag color="purple">最近 {windowDays} 天</Tag>
          {totalLogins > 0 && <Tag color="success">共 {totalLogins} 次登录</Tag>}
        </Space>
      }
      extra={
        <Space size={12}>
          {!isWorldLevel && (
            <Button size="small" icon={<RollbackOutlined />} onClick={handleBackToWorld}>
              返回世界
            </Button>
          )}
          <Radio.Group
            size="small"
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
          >
            <Radio.Button value={7}>7 天</Radio.Button>
            <Radio.Button value={30}>30 天</Radio.Button>
            <Radio.Button value={90}>90 天</Radio.Button>
          </Radio.Group>
        </Space>
      }
    >
      {/* 面包屑导航：清晰展示当前下钻层级 */}
      <div
        style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}
      >
        <Breadcrumb
          items={
            isWorldLevel
              ? [
                  {
                    title: (
                      <span>
                        <GlobalOutlined /> 世界
                      </span>
                    ),
                  },
                ]
              : [
                  {
                    title: (
                      <a onClick={handleBackToWorld}>
                        <GlobalOutlined /> 世界
                      </a>
                    ),
                  },
                  {
                    title: (
                      <span>
                        <EnvironmentOutlined /> 中国
                      </span>
                    ),
                  },
                ]
          }
        />
      </div>

      <div style={{ display: 'flex', minHeight: 380 }}>
        {/* 地图区 */}
        <div style={{ flex: 1, position: 'relative', borderRight: '1px solid #f0f0f0' }}>
          {loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 380,
              }}
            >
              <Spin tip={isWorldLevel ? '加载地理数据中...' : '加载中国地图中...'} />
            </div>
          ) : seriesData.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 380,
              }}
            >
              <Empty
                description={
                  isWorldLevel
                    ? '暂无可定位的登录记录（仅展示外网 IP）'
                    : '该时间窗口内中国境内暂无登录记录'
                }
              />
            </div>
          ) : (
            <ReactECharts
              echarts={echarts}
              // key 触发重新初始化：避免在切换 map 类型时复用旧实例残留 world 视图状态
              key={mapLevel}
              option={option}
              style={{ height: 420, width: '100%' }}
              opts={{ renderer: 'canvas' }}
              onEvents={{ click: handleMapClick }}
            />
          )}
        </div>

        {/* 右侧 TOP 排行 */}
        <div style={{ width: 220, padding: '16px 20px', background: '#fafafa' }}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
            {isWorldLevel ? '登录来源 TOP 5' : '中国省份 TOP 5'}
          </Title>
          {topItems.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无数据
            </Text>
          ) : (
            <div>
              {topItems.map((item, i) => {
                // 两种视图下取标签和图标的方式不同
                const label = isWorldLevel
                  ? codeToCnName((item.codes || [])[0]) || item.name
                  : cnRegionToShortName(item.region) || item.name;
                const icon = isWorldLevel ? codeToFlag((item.codes || [])[0]) || '🌍' : '📍';
                const percent = totalLogins > 0 ? Math.round((item.value / totalLogins) * 100) : 0;
                return (
                  <div key={item.name} style={{ marginBottom: 12 }}>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, color: '#8c8c8c', width: 16 }}>#{i + 1}</Text>
                      <span style={{ fontSize: 16 }}>{icon}</span>
                      <Text strong style={{ fontSize: 13 }}>
                        {label}
                      </Text>
                    </Space>
                    <div
                      style={{
                        position: 'relative',
                        background: '#e6f4ff',
                        height: 6,
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${percent}%`,
                          background: 'linear-gradient(90deg, #5b50e8, #3a32a0)',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.value} 次
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {percent}%
                      </Text>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
