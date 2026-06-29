const { mongoose } = require('../db/mongo.db');

const clientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // ==================== K3：App Secret（OIDC 应用配置标准字段）====================
    // 自动生成（创建时由 clientService.createClient 用 crypto.randomBytes(32).toString('hex')）
    // select:false：默认查询不返回（避免列表接口意外泄漏），需要时显式 .select('+clientSecret')
    // 仅 clientType in ['web', 'service'] 的 Confidential Client 在 token 端点强制校验
    clientSecret: {
      type: String,
      default: '',
      select: false,
    },
    // 应用类型：决定 OAuth2 流程 + token 端点是否强制 secret 校验
    //   web      - 标准 Web 应用（Confidential Client，强制 secret）
    //   spa      - 单页 Web 应用（Public Client，PKCE）
    //   native   - 客户端 / 原生应用（Public Client，PKCE）
    //   service  - 后端服务（Confidential Client，强制 secret）
    //   miniapp  - 小程序（Public Client，PKCE）
    clientType: {
      type: String,
      enum: ['web', 'spa', 'native', 'service', 'miniapp'],
      default: 'web',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    origin: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // OAuth2 授权回调地址列表：授权码流程中的 redirect_uri 预注册配置，可支持多个
    redirectUris: {
      type: [String],
      default: [],
    },
    // 登录回调URL：用户登录成功后浏览器跳转的目标地址
    // SPA 应用选填（SDK 默认取 window.location.href）
    // native / service / miniapp 类型应用必填（无浏览器上下文）
    postLoginRedirectUri: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    scope: {
      type: [String],
      default: ['openid', 'profile'],
    },
    pkce: {
      type: Boolean,
      default: true,
    },

    // ==================== 登录控制（Login Policy） ====================
    loginPolicy: {
      enabled: { type: Boolean, default: true }, // 是否启用该应用（禁用后所有授权请求被拒绝）
      allowRegister: { type: Boolean, default: false }, // 是否允许在登录页注册新账号
      maxLoginFailures: { type: Number, default: 5, min: 1, max: 100 }, // 登录失败次数上限（超出后锁定）
      lockoutDurationMinutes: { type: Number, default: 30, min: 1 }, // 锁定时长（分钟）
      ssoEnabled: { type: Boolean, default: true }, // 是否启用 SSO 单点登录

      // ==================== K4：登录方式开关（参考 Authing 登录控制）====================
      // 仅持久化字段（Demo 演示用），oauth2-login 现有"密码 + 验证码" Tab 不变
      // 文档：https://docs.authing.cn/v2/guides/app-new/create-app/login-control.html
      enabledLoginMethods: {
        password: { type: Boolean, default: true }, // 账号密码登录
        verifyCode: { type: Boolean, default: true }, // 短信 / 邮箱 + 验证码登录
        qrcode: { type: Boolean, default: false }, // 移动端 APP 扫码登录
        social: { type: Boolean, default: false }, // 社会化身份源（微信、GitHub 等）
        enterprise: { type: Boolean, default: false }, // 企业身份源（钉钉、飞书、AD 等）
      },
    },

    // ==================== 社会化身份源关联 ====================
    // 该应用关联的社会化身份源 ID 列表（仅当 loginPolicy.enabledLoginMethods.social=true 时生效）
    socialConnectionIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection' }],
      default: [],
    },

    // ==================== 访问授权（Access Policy） ====================
    accessPolicy: {
      allowedRoles: { type: [String], default: [] }, // 允许登录的角色白名单（空数组表示不限制）
      requirePkce: { type: Boolean, default: true }, // 是否强制要求 PKCE
      tokenExpiresInSeconds: { type: Number, default: 7200, min: 60 }, // Access Token 有效期（秒）
      // 默认权限：allow=允许所有用户访问（默认），deny=拒绝所有用户访问
      defaultPermission: { type: String, enum: ['allow', 'deny'], default: 'allow' },
      // 应用访问控制列表（优先级高于 defaultPermission）
      accessControlList: {
        type: [
          {
            targetType: { type: String, enum: ['user', 'role', 'group'], required: true },
            targetId: { type: String, required: true },
            targetName: { type: String, default: '' },
            effect: { type: String, enum: ['allow', 'deny'], default: 'allow' },
            enabled: { type: Boolean, default: true },
            createdAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
    },

    // ==================== 品牌化（Branding） ====================
    branding: {
      logoUrl: { type: String, default: '' }, // 登录页 Logo URL
      primaryColor: { type: String, default: '#5b50e8' }, // 登录页主题色（按钮、链接）
      welcomeText: { type: String, default: '', trim: true }, // 登录页欢迎语
      copyright: { type: String, default: '', trim: true }, // 登录页底部版权文案
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    versionKey: false,
  },
);

// 查询结果序列化时将 _id 移除，使用 clientId 作为主键
clientSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret._id;
    return ret;
  },
});

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;
