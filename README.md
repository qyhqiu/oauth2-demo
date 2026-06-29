## OAuth2 SSO 单点登录系统

基于 OAuth2 授权码 + PKCE 流程的企业级单点登录解决方案，支持多应用免登录、统一用户管理、MFA 多因素认证、社会化登录、组织架构分组管理等能力。

### 项目架构

```
oauth2-demo/
├── oauth2-server/        # OAuth2 授权服务端（Express + MongoDB + Redis，端口 3000）
│   └── src/
│       ├── controller/    # 控制器（oauth/console/groups/orgs/whitelist/cas/socialConnections...）
│       ├── service/       # 业务逻辑层（user/client/token/totp/consoleAuth/accessControl/imageCaptcha/verifyCode...）
│       ├── model/         # Mongoose 数据模型（user/client/loginLog/group/org/whitelist/socialConnection...）
│       ├── router/v1/     # 路由层（11 个路由模块）
│       ├── middleware/    # 中间件（traceId/verifyAccessToken/mergeParams）
│       ├── db/            # 数据库连接（MongoDB + Redis）
│       └── utils/         # 工具（keystore/logger/constants/requestMeta）
├── oauth2-login/         # 统一登录页面（React + Ant Design + Vite，端口 3001）
├── oauth2-js-sdk/    # 前端 SDK（TypeScript，IIFE/ESM/CJS 三格式）
├── oauth2-console/       # 管理控制台（React + Ant Design 6 + ahooks + ECharts，端口 3010）
│   └── src/pages/
│       ├── home/          # 首页（统计卡片 + 应用概览）
│       ├── apps/          # 应用管理（详情/数据概览/审计日志/品牌化）
│       ├── users/         # 用户管理 + 分组详情 + 组织架构 + 白名单
│       ├── connections/   # 社会化身份源管理
│       └── security/      # 安全配置（限流/密码策略）
├── app-a/             # 业务应用 A（React + Vite，端口 3002）
└── app-b/             # 业务应用 B（React + Vite，端口 3003）
```

### 技术栈

| 层级           | 技术                                                                 |
| -------------- | -------------------------------------------------------------------- |
| **授权服务**   | Node.js + Express + MongoDB (Mongoose) + Redis (ioredis)             |
| **日志**       | pino + pino-pretty 结构化日志                                        |
| **安全**       | helmet + express-rate-limit + bcryptjs + ES256/RS256 JWT             |
| **登录页面**   | React 18 + Ant Design + Vite                                         |
| **管理控制台** | React 18 + Ant Design 6 + ahooks + ECharts + React Router 6          |
| **客户端 SDK** | TypeScript + Vite（IIFE/ESM/CJS 多格式）                             |
| **JWT 签名**   | ES256（默认，ECDSA P-256）/ RS256（可选 3072 位），JWKS 公钥端点公开 |
| **MFA**        | TOTP (speakeasy + qrcode) + 短信 / 邮箱验证码                        |
| **地理定位**   | geoip-lite + ua-parser-js                                            |
| **容器化**     | Docker + Docker Compose（Node 20 + MongoDB 7 + Redis 7）             |
| **邮件服务**   | nodemailer（SMTP，支持 QQ/163/企业邮箱）                             |
| **验证码**     | svg-captcha 图形验证码 + Redis 存储 + 频率限制                       |

### 快速启动

```bash
# 方式一：Docker Compose（推荐）
cd oauth2-server
docker compose up -d      # 启动 MongoDB + Redis + oauth2-server

# 方式二：本地开发
# 1. 启动依赖服务
mongod                    # MongoDB（默认 27017）
redis-server              # Redis（默认 6379）

# 2. 启动 OAuth2 服务端
cd oauth2-server
npm install
npm run seed              # 初始化种子数据
npm run dev               # http://localhost:3000

# 3. 启动登录页面
cd oauth2-login
npm install
npm start                 # http://localhost:3001

# 4. 启动管理控制台
cd oauth2-console
npm install
npm run dev               # http://localhost:3010

# 5. 启动业务应用
cd app-a && npm install && npm start   # http://localhost:3002
cd app-b && npm install && npm start   # http://localhost:3003
```

### OAuth2 登录流程

```
                         ① 访问业务应用
用户 ──────────────────────────────────────► 业务应用 (app-a:3002)
                                               │
                                               │ ② SDK 检测未登录，302 跳转
                                               ▼
                                          oauth2-server:3000
                                          /v1/oauth/authorize
                                               │
                                               │ ③ 重定向到登录页
                                               ▼
                                          oauth2-login:3001
                                          (用户输入账号密码)
                                               │
                                               │ ④ POST /v1/oauth/login-and-authorize
                                               ▼
                                          oauth2-server:3000
                                          (验证密码 → 生成 code)
                                               │
                                               │ ⑤ 302 回调 redirect_uri?code=xxx
                                               ▼
                                          业务应用 (app-a:3002)
                                               │
                                               │ ⑥ SDK 用 code 换 token
                                               │    POST /v1/oauth/token
                                               ▼
                                          登录完成 ✅
                                          (Cookie 写入，获取用户信息)
```

### 功能模块

| 模块           | 功能                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| **应用管理**   | 创建/编辑/删除应用、App Secret 管理、登录控制策略、访问授权、品牌化定制 |
| **用户管理**   | 用户 CRUD、批量导入导出、锁定/解锁/停用、强制下线、密码重置             |
| **MFA 认证**   | 手机短信 / 邮箱验证码 / TOTP 认证器（Google Authenticator）             |
| **注册验证**   | 图形验证码 → 短信/邮箱验证码 → verifyToken 一次性校验机制               |
| **分组管理**   | 用户分组、分组授权应用、成员管理、分组详情页                            |
| **组织架构**   | 树形组织结构、节点 CRUD、成员绑定                                       |
| **注册白名单** | 手机号/邮箱/用户名白名单、域名后缀匹配、批量导入                        |
| **身份源管理** | 社会化身份源（Gitee/GitHub/微信/Google）接入配置                        |
| **访问控制**   | 基于用户/角色/分组的 ACL 策略，支持 allow/deny、启用/停用               |
| **数据分析**   | 登录趋势图表、地理分布地图、统计卡片、审计日志导出                      |
| **安全配置**   | 动态限流、密码策略、登录失败锁定、系统级参数管理                        |

### 关键设计点

- **零配置接入**：业务应用只需引入 SDK，服务端通过 `redirect_uri` 的 origin 自动匹配客户端
- **PKCE 强制**：所有客户端默认使用 PKCE S256，Public Client 无需 `client_secret`
- **OAuth2 Cookie**：登录成功后在 `oauth2-server` 域下设置 `oauth2_session` Cookie，同源应用可免登录
- **CAS trackSession**：跨域场景通过 `fetch + credentials:'include'` 调用 `/v1/cas/session` 实现静默登录检测
- **BroadcastChannel 单点登出**：一个标签页登出，同源所有标签页同步登出
- **分页查询**：所有列表接口统一支持 `page`/`pageSize`/`keyword` 参数，返回 `{ list, total, page, pageSize }` 格式
- **锁定联动下线**：锁定/停用用户时自动撤销所有 session，避免已登录用户继续操作

### 安全机制

| 机制             | 说明                                                           |
| ---------------- | -------------------------------------------------------------- |
| ES256 非对称签名 | 默认 ECDSA P-256 签名（性能比 RS256 快 ~10 倍），可选 RSA 3072 |
| PKCE S256        | 防授权码拦截攻击                                               |
| 动态限流         | 登录接口 10次/15分钟，注册 5次/15分钟（可在控制台动态调整）    |
| 登录失败锁定     | 连续失败 N 次自动锁定 M 分钟（每个应用独立配置）               |
| MFA 多因素认证   | 手机短信 / 邮箱 / TOTP 认证器                                  |
| 锁定联动下线     | 管理员锁定/停用账号时自动清除所有 session                      |
| helmet 安全头    | 自动设置安全 HTTP 头（CSP、HSTS、X-Frame-Options 等）          |
| 访问控制 ACL     | 分组 > 角色 > 用户三级优先级的访问控制策略                     |

### 环境变量

| 变量                | 默认值                                       | 说明                                          |
| ------------------- | -------------------------------------------- | --------------------------------------------- |
| `PORT`              | `3000`                                       | OAuth2 服务端口                               |
| `MONGODB_URI`       | `mongodb://127.0.0.1:27017/oauth2-server-db` | MongoDB 连接                                  |
| `REDIS_HOST`        | `127.0.0.1`                                  | Redis 主机                                    |
| `REDIS_PORT`        | `6379`                                       | Redis 端口                                    |
| `OAUTH2_SERVER_URL` | `http://localhost:3000`                      | OAuth2 服务外部地址                           |
| `OAUTH2_LOGIN_URL`  | `http://localhost:3001`                      | 登录页面地址                                  |
| `CONSOLE_URL`       | `http://localhost:3010`                      | 管理控制台地址                                |
| `KEY_ALGORITHM`     | `ec`                                         | 密钥算法：`ec`（ES256）或 `rsa`（RS256 3072） |
| `SMTP_HOST`         | `smtp.qq.com`                                | 邮件 SMTP 服务器                              |
| `SMTP_PORT`         | `465`                                        | SMTP 端口                                     |
| `SMTP_USER`         | —                                            | 邮箱账号                                      |
| `SMTP_PASS`         | —                                            | 邮箱授权码                                    |

### Redis Key 规则

```
oauth:code:<code>                → codeData  (TTL 10分钟，一次性)
oauth:session:<access_token>     → userId    (TTL 2小时)
oauth:refresh:<token>            → tokenData (TTL 7天)
oauth:oauth2_session:<token>     → userId    (TTL 7天)
oauth:login_fail:<clientId>:<userId> → failCount (TTL 可配置)
oauth:login_lock:<clientId>:<userId> → lockReason(TTL 可配置)
```

> 注：登录锁定按 **应用 + 用户ID** 维度独立计数。用户不存在时使用 `_unknown_:<username>` 作为兜底标识。

### 默认账号

| 角色     | 用户名  | 密码     |
| -------- | ------- | -------- |
| 管理员   | `admin` | `123456` |
| 普通用户 | `user1` | `123456` |
| 普通用户 | `user2` | `123456` |

### 相关文档

- [API 接口文档](./oauth2-server/API.md) — 完整的 REST API 参考
- [OAuth2 Server](./oauth2-server/README.md) — 服务端开发指南
- [OAuth2 Console](./oauth2-console/README.md) — 管理控制台说明
- [OAuth2 Login](./oauth2-login/README.md) — 统一登录页说明
- [OAuth2 JS SDK](./oauth2-js-sdk/README.md) — 前端 SDK 接入指南
- [自定义域名部署](./OAUTH2_CUSTOM_DOMAIN_GUIDE.md) — 生产环境域名配置

### License

MIT
