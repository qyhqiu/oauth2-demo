# OAuth2 Server API 接口文档

> 基础路径前缀：`/v1`
>
> 服务默认端口：`3000`

---

## 目录

- [OAuth2 认证端点](#oauth2-认证端点)
- [CAS 会话端点](#cas-会话端点)
- [公开接口](#公开接口)
- [注册验证码](#注册验证码)
- [社会化身份源](#社会化身份源)
- [控制台管理 API](#控制台管理api)
  - [管理员认证](#管理员认证)
  - [应用管理](#应用管理)
  - [应用分析](#应用分析)
  - [应用访问控制](#应用访问控制)
  - [用户管理](#用户管理)
  - [MFA 管理](#mfa-管理)
  - [用户组管理](#用户组管理)
  - [组织架构管理](#组织架构管理)
  - [白名单管理](#白名单管理)
  - [系统配置](#系统配置)
- [Well-Known 端点](#well-known-端点)
- [通用接口](#通用接口)

---

## OAuth2 认证端点

基础路径：`/v1/oauth`

### GET /authorize

OAuth2 授权端点。检查用户登录态（OAuth2 Session Cookie），已登录则直接签发授权码并重定向，未登录则跳转登录页。

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| response_type | string | ✅ | 固定值 `code` |
| client_id | string | ✅ | 应用 Client ID |
| redirect_uri | string | ✅ | 回调地址 |
| scope | string | ❌ | 授权范围，默认 `openid profile` |
| state | string | ❌ | 防 CSRF 随机值 |
| code_challenge | string | ❌ | PKCE 挑战码 |
| code_challenge_method | string | ❌ | PKCE 方法，`S256` 或 `plain` |
| nonce | string | ❌ | ID Token 防重放 |
| post_login_redirect_uri | string | ❌ | 登录后最终跳转地址 |

---

### POST /login-and-authorize

登录并授权（合并端点）。验证用户凭据，成功后签发授权码。

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| dry_run | string | ❌ | 值为 `1` 时为预检模式（不执行锁定计数，但会记录登录日志） |

**Body（form-urlencoded）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名/手机号/邮箱 |
| password | string | ✅ | 密码 |
| client_id | string | ✅ | 应用 Client ID |
| redirect_uri | string | ✅ | 回调地址 |
| scope | string | ❌ | 授权范围 |
| state | string | ❌ | 防 CSRF 随机值 |
| code_challenge | string | ❌ | PKCE 挑战码 |
| code_challenge_method | string | ❌ | PKCE 方法 |
| nonce | string | ❌ | ID Token 防重放 |
| post_login_redirect_uri | string | ❌ | 登录后跳转地址 |

**成功响应：** 302 重定向到 `redirect_uri?code=xxx&state=xxx`

**失败响应（dry_run=1）：**
```json
{ "error": "login_failed", "error_description": "用户名或密码错误" }
```

**MFA 拦截响应（dry_run=1）：**
```json
{ "mfa_required": true, "mfa_token": "xxx", "mfa_channel": "phone", "mfa_target_masked": "138****1234" }
```

---

### POST /mfa-verify

MFA 二次验证。

**Body（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mfa_token | string | ✅ | MFA 令牌 |
| code | string | ✅ | 验证码 |

---

### POST /mfa-resend

重新发送 MFA 验证码。

**Body（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mfa_token | string | ✅ | MFA 令牌 |

---

### GET /set-cookie-and-redirect

设置 OAuth2 Session Cookie 并重定向。内部使用，由登录成功后自动调用。

---

### POST /token

Token 端点。用授权码换取 Access Token。

**Body（form-urlencoded）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| grant_type | string | ✅ | `authorization_code` 或 `refresh_token` |
| code | string | 条件 | 授权码（grant_type=authorization_code 时必填） |
| redirect_uri | string | 条件 | 回调地址（grant_type=authorization_code 时必填） |
| client_id | string | ✅ | 应用 Client ID |
| client_secret | string | ❌ | 应用密钥（公开客户端可不传） |
| code_verifier | string | ❌ | PKCE 验证器 |
| refresh_token | string | 条件 | 刷新令牌（grant_type=refresh_token 时必填） |

**成功响应：**
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "xxx",
  "id_token": "eyJhbGciOi...",
  "scope": "openid profile"
}
```

---

### GET /userinfo

获取当前用户信息。需要 Bearer Token。

**Headers：** `Authorization: Bearer <access_token>`

**成功响应：**
```json
{
  "sub": "userId",
  "username": "user1",
  "email": "user@example.com",
  "phone": "13800001234"
}
```

---

### POST /register

用户自助注册。限流：15 分钟内最多 5 次。

**Body（form-urlencoded）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名 |
| password | string | ✅ | 密码 |
| phone | string | ❌ | 手机号 |
| email | string | ❌ | 邮箱 |
| verify_token | string | ❌ | 注册验证 Token |
| client_id | string | ✅ | 应用 Client ID |
| redirect_uri | string | ✅ | 回调地址 |

---

### GET /logout & POST /logout

登出端点。清除 OAuth2 Session Cookie，支持 `post_logout_redirect_uri` 跳转。

---

### POST /revoke

Token 吊销端点。

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | ✅ | 要吊销的 token |
| token_type_hint | string | ❌ | `access_token` 或 `refresh_token` |

---

## CAS 会话端点

基础路径：`/v1/cas`

### GET /session

检查 OAuth2 Session 是否有效。

**成功响应：**
```json
{ "logged_in": true, "user": { "id": "xxx", "username": "user1" } }
```

---

### GET /silent-authorize

静默授权。利用已有 OAuth2 Session 无交互签发授权码。

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| client_id | string | ✅ | 应用 Client ID |
| redirect_uri | string | ✅ | 回调地址 |
| scope | string | ❌ | 授权范围 |
| code_challenge | string | ❌ | PKCE 挑战码 |
| code_challenge_method | string | ❌ | PKCE 方法 |

---

## 公开接口

基础路径：`/v1/api/public`

### GET /clients/:clientId/verify

验证 Client ID 是否有效。

### GET /clients/:clientId/branding

获取应用品牌化配置（Logo、颜色、标题等）。

### GET /clients/:clientId/config

获取应用公开配置。

### GET /social-connections

获取公开的社会化身份源列表（登录页展示用）。

---

## 注册验证码

基础路径：`/v1/api/public/register-captcha`

### GET /image-captcha

获取图形验证码 SVG。

**成功响应：**
```json
{ "code": 0, "data": { "sessionId": "xxx", "svg": "<svg>...</svg>" } }
```

---

### POST /send-sms-code

发送短信验证码（需先通过图形验证码）。

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string | ✅ | 手机号 |
| imageCaptchaSessionId | string | ✅ | 图形验证码 Session ID |
| imageCaptchaText | string | ✅ | 图形验证码答案 |

---

### POST /verify-sms-code

校验短信验证码。

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string | ✅ | 手机号 |
| code | string | ✅ | 验证码 |

**成功响应：**
```json
{ "code": 0, "data": { "verified": true, "verifyToken": "xxx" } }
```

---

### POST /send-email-code

发送邮箱验证码。

**Body：** `{ "email": "user@example.com" }`

---

### POST /verify-email-code

校验邮箱验证码。

**Body：** `{ "email": "user@example.com", "code": "123456" }`

---

## 社会化身份源

### 控制台管理 API

基础路径：`/v1/api/console/social-connections`（需鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /types | 获取支持的身份源类型列表 |
| GET | / | 获取身份源列表 |
| GET | /:id | 获取身份源详情 |
| GET | /:id/secret | 获取身份源密钥 |
| POST | / | 创建身份源 |
| PUT | /:id | 更新身份源 |
| GET | /:id/linked-apps | 获取关联应用列表 |
| PUT | /:id/linked-apps/:appClientId | 切换应用关联状态 |
| DELETE | /:id | 删除身份源 |

### OAuth2 社会化登录回调

基础路径：`/v1/oauth/social`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /gitee/authorize | 发起 Gitee 授权 |
| GET | /gitee/callback | Gitee 回调处理 |

---

## 控制台管理 API

基础路径：`/v1/api/console`

> 除管理员认证接口外，所有接口均需 `Authorization: Bearer <console_token>` 头。

---

### 管理员认证

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | /admin/login | ❌ | 管理员账号密码登录 |
| GET | /admin/oauth2-config | ❌ | 获取 OAuth2 登录配置 |
| GET | /admin/oauth2-login | ❌ | 发起 OAuth2 管理员登录 |
| POST | /admin/oauth2-exchange | ❌ | OAuth2 授权码换取控制台 Token |
| GET | /admin/me | ✅ | 获取当前管理员信息 |
| GET | /admin/oauth2-apps | ✅ | 获取 OAuth2 可跳转应用列表 |

---

### 应用管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /apps | 获取应用列表 |
| GET | /apps/:clientId | 获取应用详情 |
| POST | /apps | 创建应用 |
| PUT | /apps/:clientId | 更新应用配置 |
| DELETE | /apps/:clientId | 删除应用 |
| POST | /apps/:clientId/refresh-secret | 重新生成 Client Secret |

---

### 应用分析

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /apps/:clientId/summary | 应用概览统计 |
| GET | /apps/:clientId/logged-in-users | 已登录用户列表 |
| GET | /apps/:clientId/login-trend | 登录趋势（按日聚合） |
| GET | /apps/:clientId/login-logs | 登录审计日志 |
| GET | /apps/:clientId/login-logs/export | 导出登录日志（Excel） |
| GET | /apps/:clientId/login-geo | 登录地域分布 |
| POST | /apps/:clientId/unlock-user | 解锁应用下被锁定的用户 |

#### POST /apps/:clientId/unlock-user

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | ✅ | 要解锁的用户 ID |

**成功响应：**
```json
{ "code": 0, "message": "账号已解锁" }
```

#### GET /apps/:clientId/login-logs

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | ❌ | 页码，默认 1 |
| pageSize | number | ❌ | 每页条数，默认 20 |
| status | string | ❌ | 筛选状态：`success` / `failure` |
| startDate | string | ❌ | 开始日期 |
| endDate | string | ❌ | 结束日期 |

---

### 应用访问控制

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /apps/:clientId/access-control | 获取访问控制列表 |
| POST | /apps/:clientId/access-control | 添加访问控制项 |
| PUT | /apps/:clientId/access-control/:itemId | 更新访问控制项 |
| DELETE | /apps/:clientId/access-control/:itemId | 删除访问控制项 |
| PUT | /apps/:clientId/default-permission | 更新默认权限策略 |

---

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /users | 获取用户列表 |
| GET | /users/:userId | 获取用户详情 |
| POST | /users | 创建用户 |
| PUT | /users/:userId | 更新用户信息 |
| DELETE | /users/:userId | 删除用户 |
| POST | /users/:userId/force-logout | 强制下线 |
| GET | /users/:userId/sessions | 获取用户会话列表 |
| POST | /users/:userId/lock | 锁定用户 |
| POST | /users/:userId/unlock | 解锁用户 |
| POST | /users/:userId/disable | 停用用户 |
| POST | /users/:userId/enable | 启用用户 |
| POST | /users/:userId/reset-password | 重置密码 |
| GET | /users/:userId/login-history | 获取登录历史 |
| GET | /users/:userId/login-apps | 获取登录过的应用列表 |
| GET | /users/sessions/batch | 批量查询用户会话状态 |
| GET | /users/export | 导出用户列表 |
| POST | /users/send-create-code | 发送创建用户验证码 |
| GET | /users/import-template | 下载用户导入模板 |
| POST | /users/import | 批量导入用户 |

#### GET /users

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | ❌ | 页码，默认 1 |
| pageSize | number | ❌ | 每页条数，默认 20 |
| keyword | string | ❌ | 搜索关键词（用户名/手机/邮箱） |
| status | string | ❌ | 筛选状态 |

#### POST /users

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名（字母开头，3-32位） |
| password | string | ✅ | 密码（6-64位） |
| phone | string | ❌ | 手机号 |
| email | string | ❌ | 邮箱 |
| nickname | string | ❌ | 昵称 |
| roles | string[] | ❌ | 角色列表 |

---

### MFA 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | /users/:userId/mfa | 更新 MFA 设置 |
| POST | /users/:userId/send-code | 发送验证码 |
| POST | /users/:userId/bind-phone | 绑定手机号 |
| POST | /users/:userId/bind-email | 绑定邮箱 |
| POST | /users/:userId/unbind-phone | 解绑手机号 |
| POST | /users/:userId/unbind-email | 解绑邮箱 |
| POST | /users/:userId/totp/setup | 初始化 TOTP |
| POST | /users/:userId/totp/confirm | 确认绑定 TOTP |
| POST | /users/:userId/totp/unbind | 解绑 TOTP |

---

### 用户组管理

基础路径：`/v1/api/console/groups`（需鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 获取用户组列表 |
| GET | /:groupId | 获取用户组详情 |
| POST | / | 创建用户组 |
| PUT | /:groupId | 更新用户组 |
| DELETE | /:groupId | 删除用户组 |
| POST | /:groupId/members | 添加成员 |
| DELETE | /:groupId/members | 移除成员 |
| GET | /:groupId/members | 获取成员列表 |
| POST | /:groupId/authorize | 授权应用 |
| DELETE | /:groupId/authorize | 取消授权 |

---

### 组织架构管理

基础路径：`/v1/api/console/orgs`（需鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /tree | 获取组织树 |
| GET | / | 获取组织列表 |
| POST | / | 创建组织节点 |
| PUT | /:orgId | 更新组织节点 |
| DELETE | /:orgId | 删除组织节点 |
| POST | /:orgId/members | 添加成员 |
| DELETE | /:orgId/members | 移除成员 |
| GET | /:orgId/members | 获取成员列表 |

---

### 白名单管理

基础路径：`/v1/api/console/whitelist`（需鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /config | 获取白名单配置（是否启用） |
| PUT | /config | 更新白名单配置 |
| GET | / | 获取白名单列表 |
| POST | / | 添加白名单项 |
| POST | /batch | 批量导入白名单 |
| DELETE | /:itemId | 删除白名单项 |
| POST | /batch-delete | 批量删除 |

---

### 系统配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /system-config | 获取系统配置 |
| PUT | /system-config | 更新系统配置 |

---

## Well-Known 端点

### GET /.well-known/openid-configuration

OpenID Connect 发现文档。

### GET /.well-known/jwks.json

JSON Web Key Set（公钥集），用于客户端验证 JWT 签名。

---

## 通用接口

基础路径：`/v1/api`

### GET /health

健康检查。

**成功响应：**
```json
{ "status": "ok" }
```

### GET /protected/data

受保护的测试端点（需 Bearer Token）。

---

## 概览接口

### GET /v1/api/console/overview

获取控制台首页概览数据。

**成功响应：**
```json
{
  "code": 0,
  "data": {
    "totalApps": 5,
    "totalUsers": 128,
    "activeUsers": 42
  }
}
```

---

## 通用响应格式

### 成功响应
```json
{
  "code": 0,
  "data": { ... },
  "message": "操作成功"
}
```

### 错误响应
```json
{
  "code": 400,
  "data": null,
  "message": "错误描述"
}
```

### OAuth2 标准错误
```json
{
  "error": "error_code",
  "error_description": "错误描述"
}
```

---

## 认证方式

### 控制台 API

所有 `/api/console` 下的端点（公开端点除外）需要在请求头携带：

```
Authorization: Bearer <console_token>
```

Token 通过 `/api/console/admin/login` 或 OAuth2 登录获取。

### OAuth2 资源端点

`/oauth/userinfo` 等资源端点需要携带：

```
Authorization: Bearer <access_token>
```

---

## 安全机制

### 登录失败锁定

- 按 **应用 + 用户 ID** 维度独立计数
- 连续失败达到阈值（默认 5 次）后锁定账号
- 锁定时长由应用 `loginPolicy.lockoutDurationMinutes` 配置（默认 30 分钟）
- Redis Key 格式：`oauth:login_fail:{clientId}:{userId}`、`oauth:login_lock:{clientId}:{userId}`
- 用户不存在时使用 `_unknown_:{username}` 作为兜底标识

### PKCE（Proof Key for Code Exchange）

公开客户端必须使用 PKCE，推荐 `S256` 方法。

### OAuth2 Session

登录成功后设置 `OAUTH2_SESSION` Cookie，有效期内其他应用可免登录（SSO）。
