## OAuth2 JS SDK — 前端单点登录 SDK

OAuth2 单点登录客户端 JS SDK，支持授权码流程（PKCE S256）、Token 自动刷新、单点登出、跨应用免登录跳转、BroadcastChannel 多标签页同步。

### 安装

```bash
npm install oauth2-js-sdk
```

### 输出格式

| 格式 | 文件 | 使用场景 |
|------|------|----------|
| ESM | `dist/oauth2-js-sdk.es.js` | 现代构建工具（Vite/Webpack） |
| CJS | `dist/oauth2-js-sdk.cjs.js` | Node.js / CommonJS 环境 |
| UMD/IIFE | `dist/oauth2-js-sdk.umd.js` | 浏览器 `<script>` 直接引入 |
| TypeScript | `dist/types/index.d.ts` | 类型定义 |

### 快速接入

```javascript
import { OAuth2Client } from 'oauth2-js-sdk';

const oauth2 = new OAuth2Client({
  oauth2ServerUrl: 'http://localhost:3000',
  redirectUri: window.location.origin + '/callback',
  clientId: 'your-client-id',
  scope: 'openid profile',
});

// 应用入口检查登录态
const userInfo = await oauth2.checkAuth();
if (userInfo) {
  console.log('已登录:', userInfo);
}
```

### 配置项

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `oauth2ServerUrl` | string | 否 | `http://localhost:3000` | OAuth2 服务端地址 |
| `redirectUri` | string | 是 | — | OAuth2 回调地址 |
| `clientId` | string | 是 | — | 应用的 Client ID |
| `scope` | string | 否 | `openid profile` | 授权范围 |

### 核心 API

| 方法 | 说明 |
|------|------|
| `checkAuth()` | 检查登录态（入口必须调用）：处理回调 code / 校验本地 Token / 发起登录 |
| `login()` | 跳转到 OAuth2 登录页 |
| `logout()` | 单点登出（清除本地 Token + 通知其他标签页） |
| `isAuthenticated()` | 判断当前是否已登录 |
| `getAccessToken()` | 获取当前 Access Token |
| `getUserInfo()` | 获取用户信息 |
| `trackSession()` | 跨域静默登录检测（CAS 模式） |
| `onLogout(callback)` | 注册登出回调（BroadcastChannel 多标签页同步） |

### 工作流程

```
1. 应用入口调用 oauth2.checkAuth()
2. 检测 URL 有 code 参数？ → 用 code 换 Token → 登录完成
3. 本地有有效 Token？ → 直接返回用户信息
4. 未登录 → 跳转到 OAuth2 授权端点 → 用户登录 → 回调携带 code
```

### 安全特性

- **PKCE S256**：防止授权码拦截攻击，无需暴露 client_secret
- **Token 自动刷新**：Access Token 过期前自动使用 Refresh Token 续期
- **BroadcastChannel 登出同步**：一个标签页登出，所有同源标签页自动清除登录态
- **Client 注册校验**：启动时自动验证 clientId 与 origin 是否匹配

### 开发

```bash
# 构建
npm run build

# 监听模式
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 自动修复
npm run lint:fix

# 格式化
npm run format
```

### 依赖

- **peerDependencies**：`axios ^1.0.0`
- **dependencies**：`js-cookie ^3.0.5`

### License

MIT