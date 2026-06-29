## OAuth2 Server — 授权服务端

基于 Node.js + Express 的 OAuth2/OIDC 授权服务端，提供完整的单点登录、用户管理、应用管理、MFA 认证等能力。

### 技术栈

- **运行时**：Node.js 20（Docker）/ 18+（本地）
- **框架**：Express 4
- **数据库**：MongoDB 7 (Mongoose 9) + Redis 7 (ioredis 5)
- **JWT**：ES256（默认，ECDSA P-256）/ RS256（可选 3072 位），jsonwebtoken + 自管理密钥对
- **安全**：helmet + express-rate-limit + bcryptjs
- **日志**：pino + pino-pretty（结构化日志）
- **MFA**：speakeasy (TOTP) + qrcode
- **邮件**：nodemailer（SMTP，支持 QQ/163/企业邮箱）
- **验证码**：svg-captcha 图形验证码 + Redis 存储
- **地理**：geoip-lite + ua-parser-js
- **容器化**：Docker 多阶段构建 + Docker Compose

### 目录结构

```
src/
├── index.js               # 入口文件
├── app/                   # Express 应用初始化 + 错误处理
├── controller/            # 控制器层
│   ├── oauth.controller.js        # OAuth2/OIDC 核心（authorize/token/logout/register...）
│   ├── console.controller.js      # 管理控制台 API（应用/用户/MFA/统计/访问控制...）
│   ├── groups.controller.js       # 分组管理
│   ├── orgs.controller.js         # 组织架构管理
│   ├── whitelist.controller.js    # 注册白名单
│   ├── socialConnections.controller.js  # 社会化身份源 + Gitee OAuth
│   ├── cas.controller.js          # CAS 会话检测 + 静默授权
│   ├── api.controller.js          # 健康检查 + 受保护数据
│   ├── public.controller.js       # 公开接口（clientId 校验/品牌化）
│   └── wellknown.controller.js    # OIDC 发现端点
├── service/               # 业务逻辑层
│   ├── user.service.js            # 用户 CRUD + 查询
│   ├── client.service.js          # 应用（Client）管理
│   ├── token.service.js           # Authorization Code + PKCE
│   ├── consoleAuth.service.js     # 管理员登录鉴权
│   ├── accessControl.service.js   # 访问控制策略判断
│   ├── totp.service.js            # TOTP 密钥管理
│   ├── verifyCode.service.js      # 短信/邮箱验证码（nodemailer 发送邮件）
│   ├── imageCaptcha.service.js    # 图形验证码（svg-captcha + Redis）
│   └── oidcClaims.service.js      # OIDC Claims 组装
├── model/                 # Mongoose 数据模型
│   ├── user.model.js
│   ├── client.model.js
│   ├── loginLog.model.js
│   ├── group.model.js
│   ├── org.model.js
│   ├── whitelist.model.js
│   ├── socialConnection.model.js
│   └── systemConfig.model.js
├── router/v1/             # 路由定义
├── middleware/            # 中间件
│   ├── verifyAccessToken.middleware.js
│   ├── traceId.middleware.js
│   └── mergeParams.middleware.js
├── db/                    # 数据库连接
│   ├── mongo.db.js
│   └── redis.db.js
├── utils/                 # 工具函数
│   ├── constants.js       # 配置常量（签名算法动态获取）
│   ├── keystore.js        # 密钥管理（ES256/RS256 双模式，KeyObject 缓存）
│   ├── logger.js          # pino 日志实例
│   └── requestMeta.js     # 请求元信息提取
└── scripts/               # 脚本
    ├── initDb.js          # 数据库初始化
    └── seed.js            # 种子数据
```

### 快速启动

```bash
# 安装依赖
npm install

# 初始化种子数据（首次运行）
npm run seed

# 开发模式（nodemon 热重载）
npm run dev

# 生产模式
npm start
```

### 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（nodemon） |
| `npm start` | 生产启动 |
| `npm run seed` | 初始化种子数据 |
| `npm run init-db` | 数据库初始化 |
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |
| `npm run docker:up` | Docker Compose 启动 |
| `npm run docker:down` | Docker Compose 停止 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/oauth2-server-db` | MongoDB 连接串 |
| `REDIS_HOST` | `127.0.0.1` | Redis 主机 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | — | Redis 密码 |
| `REDIS_DB` | `0` | Redis 数据库 |
| `OAUTH2_SERVER_URL` | `http://localhost:3000` | OAuth2 服务外部地址 |
| `OAUTH2_LOGIN_URL` | `http://localhost:3001` | 登录页面地址 |
| `CONSOLE_URL` | `http://localhost:3010` | 管理控制台地址 |
| `KEY_ALGORITHM` | `ec` | 密钥算法：`ec`（ES256 P-256）或 `rsa`（RS256 3072位） |
| `SMTP_HOST` | `smtp.qq.com` | 邮件 SMTP 服务器 |
| `SMTP_PORT` | `465` | SMTP 端口 |
| `SMTP_SECURE` | `true` | 是否使用 SSL |
| `SMTP_USER` | — | 邮箱账号 |
| `SMTP_PASS` | — | 邮箱授权码（非登录密码） |
| `SMTP_FROM` | 同 `SMTP_USER` | 发件人地址 |

### Docker 部署

```bash
# 构建镜像（Node 20 Alpine 多阶段构建）
npm run docker:build

# 启动所有服务（oauth2-server + MongoDB 7 + Redis 7）
npm run docker:up

# 查看日志
npm run docker:logs

# 停止
npm run docker:down
```

Docker Compose 环境变量通过 `.env.docker` 配置，首次启动自动生成 EC P-256 密钥并通过 Docker Volume 持久化。

### 密钥管理

- 默认使用 **ES256**（ECDSA P-256），性能比 RS256 快 ~10 倍，Token 更短
- 可通过 `KEY_ALGORITHM=rsa` 切换到 RSA 3072 位
- 密钥持久化在 `src/keys/` 目录（Docker 中通过 volume 持久化）
- 自动检测已有密钥类型，向后兼容旧 RSA 密钥
- 使用 KeyObject 缓存，避免每次签名时重复解析 PEM

### API 文档

完整的 API 接口文档请参阅 [API.md](./API.md)。

### License

MIT