## OAuth2 生产环境部署指南：用「同根域」规避第三方 Cookie 限制

### 为什么需要同根域？

现代浏览器（Safari ITP、Chrome 隐身模式、Firefox ETP）默认阻止跨站请求携带第三方 Cookie，直接影响 OAuth2 核心能力：

| OAuth2 能力 | 受影响表现 |
|---|---|
| `trackSession()` 静默检测登录态 | 永远返回 `session: null` |
| `getSilentAccessToken()` 无感登录 | 拿不到 code，被迫整页跳转 |
| iframe / popup 登录态联动 | Cookie 丢失，OAuth2 失效 |

**根本解法：让 oauth2-server 与所有业务应用共享同一个根域名。**

---

### 推荐域名规划

| 角色 | 开发环境 | 生产环境（同根域） |
|---|---|---|
| oauth2-server | `http://localhost:3000` | `https://oauth2.example.com` |
| oauth2-login | `http://localhost:3001` | `https://login.example.com` |
| oauth2-console | `http://localhost:3010` | `https://console.example.com` |
| 业务应用 A | `http://localhost:3002` | `https://app-a.example.com` |
| 业务应用 B | `http://localhost:3003` | `https://app-b.example.com` |

所有域名共享根域 `example.com`，浏览器视为「同站请求」，Cookie 正常携带。

---

### 部署改造步骤

#### 1. DNS 配置

```
oauth2.example.com      A    1.2.3.4
login.example.com       A    1.2.3.4
console.example.com     A    1.2.3.4
app-a.example.com       A    1.2.3.5
app-b.example.com       A    1.2.3.6
```

#### 2. Cookie 配置（关键）

修改 `oauth2-server/src/controller/oauth.controller.js` 的 Cookie 设置：

```js
// 生产环境（同根域）
res.cookie(OAUTH2_SESSION_COOKIE_NAME, oauth2_token, {
  httpOnly: true,
  secure: true,                       // 生产强制 HTTPS
  sameSite: 'Lax',                    // 同站子域间已可用，不要改成 None
  domain: '.example.com',             // 关键：Cookie 在 *.example.com 子域共享
  path: '/',
  maxAge: OAUTH2_SESSION_EXPIRES_SECONDS * 1000,
});
```

> ⚠️ 不要用 `sameSite: 'None'`，在同根域架构下 `Lax` 是最佳选择。

#### 3. 环境变量配置

```bash
# oauth2-server/.env
OAUTH2_SERVER_URL=https://oauth2.example.com
OAUTH2_LOGIN_URL=https://login.example.com
CONSOLE_URL=https://console.example.com

# oauth2-login/.env
VITE_OAUTH2_SERVER=https://oauth2.example.com

# oauth2-console/.env
VITE_OAUTH2_SERVER=https://oauth2.example.com
```

#### 4. 业务应用 SDK 配置

```html
<meta name="oauth2-server-url" content="https://oauth2.example.com" />
<meta name="oauth2-client-id" content="your-client-id" />
<script src="/oauth2-js-sdk.iife.js"></script>
```

#### 5. 在 oauth2-console 中注册应用

将应用的 origin 改为生产域名：

| 应用 | origin |
|---|---|
| 应用 A | `https://app-a.example.com` |
| 应用 B | `https://app-b.example.com` |

---

### 同根域下 trackSession 流程

```
app-a.example.com（浏览器）
       │
       │  1. GET https://oauth2.example.com/v1/cas/session
       │     → 请求头自动带上 Cookie: oauth2_session=... ✅
       │
       │  2. 服务端返回 { session: {...}, userInfo: {...} }
       │
       │  3. GET https://oauth2.example.com/v1/cas/silent-authorize?...
       │     → 同样带上 Cookie ✅
       │
       │  4. POST https://oauth2.example.com/v1/oauth/token 拿到 access_token
       │
       ▼
  登录完成（全程无跳转，用户无感知）
```

### 第三方 Cookie 被拦截时的降级

如果未使用同根域部署（如开发环境跨域）：

- `/v1/cas/session` 响应仍然 200，但 body 是 `{ session: null }`
- SDK 自动降级为整页跳转 `/v1/oauth/authorize`，用户手动登录后 302 回调

---

### Nginx 反向代理参考

```nginx
# oauth2-server
server {
    listen 443 ssl;
    server_name oauth2.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# oauth2-login
server {
    listen 443 ssl;
    server_name login.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}

# 业务应用 A
server {
    listen 443 ssl;
    server_name app-a.example.com;

    # API 代理到后端（按 /v1 前缀匹配）
    location /v1/ {
        proxy_pass http://127.0.0.1:3000;
    }

    # 前端静态资源
    location / {
        proxy_pass http://127.0.0.1:3002;
    }
}
```

### Docker 部署

项目提供了 `oauth2-server/docker-compose.yml`，包含 oauth2-server（Node 20）+ MongoDB 7 + Redis 7（AOF 持久化）完整服务栈：

```bash
cd oauth2-server

# 修改 .env.docker 中的环境变量为生产域名
vim .env.docker

# 一键启动
docker compose up -d

# 初始化种子数据
docker compose exec oauth2-server npm run seed
```

密钥算法默认 ES256（ECDSA P-256），首次启动自动生成并通过 Docker Volume 持久化。
生产环境建议在 Nginx 反向代理层统一处理 HTTPS 和域名路由。

---

### 检查清单

- [ ] 所有子域名 DNS 解析正确
- [ ] HTTPS 证书覆盖 `*.example.com`（推荐通配符证书）
- [ ] Cookie `domain` 设置为 `.example.com`
- [ ] Cookie `sameSite` 为 `Lax`，`secure` 为 `true`
- [ ] 环境变量中的 URL 全部替换为生产域名
- [ ] oauth2-console 中应用 origin 更新为生产域名
- [ ] SDK `<meta name="oauth2-server-url">` 指向生产域名
- [ ] MongoDB / Redis 生产连接配置（认证、持久化、备份）
- [ ] Nginx 反向代理配置正确（proxy_set_header Host / X-Forwarded-Proto）
