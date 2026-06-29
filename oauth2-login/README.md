## OAuth2 Login — 统一登录页面

OAuth2 系统的统一登录界面，为所有接入应用提供一致的登录体验，支持账号密码登录、MFA 验证、社会化登录、自助注册。

### 技术栈

- **框架**：React 18
- **UI**：Ant Design 5
- **请求**：axios
- **Hooks**：ahooks
- **构建**：Vite 5
- **样式**：Sass (CSS Modules)
- **代码规范**：ESLint (flat config) + Prettier

### 功能特性

- 账号密码登录（用户名/手机号/邮箱）
- MFA 多因素认证（短信/邮箱/TOTP）
- 社会化登录（Gitee 等第三方身份源）
- OAuth2 免登录检测（已有 OAuth2 Session 时自动跳转）
- 应用品牌化（Logo、主题色、自定义文案）
- 用户自助注册（验证码校验流程）
  - 用户名必填
  - 手机号注册：图形验证码 → 短信验证码 → verifyToken 校验
  - 邮箱注册：邮箱验证码 → verifyToken 校验
  - Radio.Group 切换手机号/邮箱注册方式
- 登录表单预检（dry_run 模式）

### 页面组件

| 组件 | 说明 |
|------|------|
| `LoginForm.jsx` | 登录表单（账号密码 + 社会化登录入口） |
| `RegisterForm.jsx` | 注册表单（用户名必填 + 手机/邮箱验证码流程） |
| `ImageCaptcha.jsx` | 图形验证码组件（SVG 展示 + 点击刷新） |
| `MfaVerifyStep.jsx` | MFA 验证步骤（短信/邮箱/TOTP） |

### 快速启动

```bash
npm install
npm start         # http://localhost:3001
```

### 脚本命令

| 命令 | 说明 |
|------|------|
| `npm start` | 开发服务器（端口 3001） |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_OAUTH2_SERVER` | `http://localhost:3000` | OAuth2 服务端地址 |

### 工作流程

1. 用户访问业务应用 → SDK 检测未登录 → 跳转 `/v1/oauth/authorize`
2. OAuth2 Server 检测无 OAuth2 Session → 302 重定向到本登录页
3. 登录页解析 URL 中的 OAuth 参数（`client_id`、`redirect_uri`、`state` 等）
4. 用户输入凭证 → POST `/v1/oauth/login-and-authorize`
5. 验证通过 → 302 回调业务应用 `redirect_uri?code=xxx&state=xxx`

### 依赖服务

需要 `oauth2-server` (端口 3000) 提供登录验证和授权码颁发服务。

### License

MIT
