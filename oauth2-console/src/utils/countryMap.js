/**
 * 国家代码（ISO 3166-1 alpha-2，geoip-lite 输出）映射到：
 *   - mapName: 与 echarts world.json 中 properties.name 完全对应（用于地图区域定位）
 *   - cnName:  中文友好显示名（用于 tooltip）
 *
 * 仅维护常见国家，未命中时直接用原始代码兜底显示。
 */

// ISO Alpha-2 → echarts world map 名称
export const CODE_TO_MAP_NAME = {
  CN: 'China',
  US: 'United States',
  JP: 'Japan',
  KR: 'South Korea',
  DE: 'Germany',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  PT: 'Portugal',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  NO: 'Norway',
  FI: 'Finland',
  DK: 'Denmark',
  PL: 'Poland',
  RU: 'Russia',
  UA: 'Ukraine',
  TR: 'Turkey',
  GR: 'Greece',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  PE: 'Peru',
  VE: 'Venezuela',
  AU: 'Australia',
  NZ: 'New Zealand',
  IN: 'India',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  LK: 'Sri Lanka',
  TH: 'Thailand',
  VN: 'Vietnam',
  PH: 'Philippines',
  ID: 'Indonesia',
  MY: 'Malaysia',
  SG: 'Singapore',
  HK: 'China', // 香港归并到中国（geoip 大多返回 HK，但地图无独立块）
  TW: 'China', // 台湾同上
  MO: 'China',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  IL: 'Israel',
  IR: 'Iran',
  IQ: 'Iraq',
  EG: 'Egypt',
  ZA: 'South Africa',
  NG: 'Nigeria',
  KE: 'Kenya',
  ET: 'Ethiopia',
  IE: 'Ireland',
  IS: 'Iceland',
  CZ: 'Czech Republic',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  HR: 'Croatia',
  RS: 'Republic of Serbia',
};

// ISO Alpha-2 → 中文名（tooltip 用）
export const CODE_TO_CN_NAME = {
  CN: '中国',
  US: '美国',
  JP: '日本',
  KR: '韩国',
  DE: '德国',
  GB: '英国',
  UK: '英国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
  PT: '葡萄牙',
  NL: '荷兰',
  BE: '比利时',
  CH: '瑞士',
  AT: '奥地利',
  SE: '瑞典',
  NO: '挪威',
  FI: '芬兰',
  DK: '丹麦',
  PL: '波兰',
  RU: '俄罗斯',
  UA: '乌克兰',
  TR: '土耳其',
  GR: '希腊',
  CA: '加拿大',
  MX: '墨西哥',
  BR: '巴西',
  AR: '阿根廷',
  CL: '智利',
  CO: '哥伦比亚',
  PE: '秘鲁',
  VE: '委内瑞拉',
  AU: '澳大利亚',
  NZ: '新西兰',
  IN: '印度',
  PK: '巴基斯坦',
  BD: '孟加拉',
  LK: '斯里兰卡',
  TH: '泰国',
  VN: '越南',
  PH: '菲律宾',
  ID: '印度尼西亚',
  MY: '马来西亚',
  SG: '新加坡',
  HK: '中国香港',
  TW: '中国台湾',
  MO: '中国澳门',
  AE: '阿联酋',
  SA: '沙特阿拉伯',
  IL: '以色列',
  IR: '伊朗',
  IQ: '伊拉克',
  EG: '埃及',
  ZA: '南非',
  NG: '尼日利亚',
  KE: '肯尼亚',
  ET: '埃塞俄比亚',
  IE: '爱尔兰',
  IS: '冰岛',
  CZ: '捷克',
  HU: '匈牙利',
  RO: '罗马尼亚',
  BG: '保加利亚',
  HR: '克罗地亚',
  RS: '塞尔维亚',
};

export function codeToMapName(code) {
  return CODE_TO_MAP_NAME[code] || code;
}

export function codeToCnName(code) {
  return CODE_TO_CN_NAME[code] || code;
}

// 国旗 emoji（A-Z 的 Unicode 区域指示符）
export function codeToFlag(code) {
  if (!code || code.length !== 2 || code === 'LO') return '';
  const upper = code.toUpperCase();
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

// =====================================================================
// 中国省级映射（地图下钻 World → China 时使用）
//
// geoip-lite 对中国 IP 的 region 字段输出 ISO 3166-2:CN 子代码（两位字母），
// 例如 BJ=北京、SH=上海、JS=江苏、ZJ=浙江...
// china.json（DataV）的 properties.name 是中文全称（北京市/上海市/江苏省/...），
// 因此需要在中间架一张「region 缩写 → 地图省名」的桥接表。
// =====================================================================

// ISO 3166-2:CN → china.json 中 properties.name（中文全称）
export const CN_REGION_TO_MAP_NAME = {
  BJ: '北京市',
  TJ: '天津市',
  HE: '河北省',
  SX: '山西省',
  NM: '内蒙古自治区',
  LN: '辽宁省',
  JL: '吉林省',
  HL: '黑龙江省',
  SH: '上海市',
  JS: '江苏省',
  ZJ: '浙江省',
  AH: '安徽省',
  FJ: '福建省',
  JX: '江西省',
  SD: '山东省',
  HA: '河南省',
  HB: '湖北省',
  HN: '湖南省',
  GD: '广东省',
  GX: '广西壮族自治区',
  HI: '海南省',
  CQ: '重庆市',
  SC: '四川省',
  GZ: '贵州省',
  YN: '云南省',
  XZ: '西藏自治区',
  SN: '陕西省',
  GS: '甘肃省',
  QH: '青海省',
  NX: '宁夏回族自治区',
  XJ: '新疆维吾尔自治区',
  TW: '台湾省',
  HK: '香港特别行政区',
  MO: '澳门特别行政区',
};

// 短显示名（用于 TOP 排行榜节省空间）
export const CN_REGION_TO_SHORT_NAME = {
  BJ: '北京',
  TJ: '天津',
  HE: '河北',
  SX: '山西',
  NM: '内蒙古',
  LN: '辽宁',
  JL: '吉林',
  HL: '黑龙江',
  SH: '上海',
  JS: '江苏',
  ZJ: '浙江',
  AH: '安徽',
  FJ: '福建',
  JX: '江西',
  SD: '山东',
  HA: '河南',
  HB: '湖北',
  HN: '湖南',
  GD: '广东',
  GX: '广西',
  HI: '海南',
  CQ: '重庆',
  SC: '四川',
  GZ: '贵州',
  YN: '云南',
  XZ: '西藏',
  SN: '陕西',
  GS: '甘肃',
  QH: '青海',
  NX: '宁夏',
  XJ: '新疆',
  TW: '台湾',
  HK: '香港',
  MO: '澳门',
};

export function cnRegionToMapName(region) {
  if (!region) return '';
  return CN_REGION_TO_MAP_NAME[region.toUpperCase()] || region;
}

export function cnRegionToShortName(region) {
  if (!region) return '';
  return CN_REGION_TO_SHORT_NAME[region.toUpperCase()] || region;
}
