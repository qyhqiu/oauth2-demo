## OAuth2 Console — 管理控制台

OAuth2 系统的管理控制台前端，提供应用管理、用户管理、分组管理、组织架构、身份源配置、安全设置等可视化管理能力。

### 技术栈

- **框架**：React 18 + React Router 6
- **UI**：Ant Design 6 + @ant-design/icons
- **请求**：axios + ahooks (useRequest)
- **图表**：ECharts + echarts-for-react + Recharts
- **构建**：Vite 5
- **样式**：Sass + Tailwind CSS
- **代码规范**：ESLint (flat config) + Prettier

### 目录结构

```
src/
├── App.jsx                # 路由配置（懒加载）
├── api/                   # API 请求层
├── components/
│   ├── common/            # 公共组件（BackButton / AppCard）
│   ├── layout/            # ConsoleLayout（侧边栏 + Header）
│   └── auth/              # RequireAuth 鉴权守卫
├── pages/
│   ├── home/              # 首页（统计卡片 + 快捷入口）
│   ├── apps/              # 应用管理（列表/详情/创建抽屉/集成指南）
│   ├── users/             # 用户管理
│   │   ├── UsersPage      # 用户列表
│   │   ├── UserDetailPage # 用户详情
│   │   ├── GroupsPage     # 分组列表
│   │   ├── GroupDetailPage# 分组详情（成员+授权应用）
│   │   ├── OrgsPage       # 组织架构
│   │   └── WhitelistPage  # 注册白名单
│   ├── connections/       # 身份源管理
│   ├── security/          # 安全设置（基础/登录/注册）
│   ├── login/             # 控制台登录 + OAuth2 回调
│   └── placeholder/       # 功能占位页
└── styles/                # 全局样式变量
```

### 快速启动

```bash
npm install
npm run dev       # http://localhost:3010
```

### 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（端口 3010） |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |

### 路由结构

| 路径 | 页面 |
|------|------|
| `/home` | 首页 |
| `/apps` | 应用列表 |
| `/apps/:clientId` | 应用详情 |
| `/users` | 用户列表 |
| `/users/:userId` | 用户详情 |
| `/users/groups` | 分组列表 |
| `/users/groups/:groupId` | 分组详情 |
| `/users/orgs` | 组织架构 |
| `/users/whitelist` | 注册白名单 |
| `/connections/social` | 社会化身份源 |
| `/security/basic` | 安全设置 |

### 依赖服务

需要 `oauth2-server` (端口 3000) 提供后端 API 支持。

### License

MIT
