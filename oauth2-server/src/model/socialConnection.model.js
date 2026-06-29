const { mongoose } = require('../db/mongo.db');

/**
 * 社会化身份源（Social Identity Provider）
 * 参考 Authing「连接身份源 → 社会化身份源」设计
 *
 * 每条记录代表一个已配置的第三方 OAuth2 登录（如 Gitee、GitHub、微信等）
 */
const socialConnectionSchema = new mongoose.Schema(
  {
    // 身份源类型标识（如 gitee / github / wechat）
    provider: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // 唯一标识（管理员自定义，用于 URL 路由）
    identifier: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    // 显示名称
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    // 第三方应用 Client ID
    clientId: {
      type: String,
      required: true,
      trim: true,
    },
    // 第三方应用 Client Secret（敏感字段，默认不返回）
    clientSecret: {
      type: String,
      required: true,
      select: false,
    },
    // 回调地址（可选，留空则使用默认 /oauth/social/:provider/callback）
    callbackUrl: {
      type: String,
      default: '',
      trim: true,
    },
    // 授权范围
    scopes: {
      type: [String],
      default: ['user_info'],
    },
    // 是否启用
    enabled: {
      type: Boolean,
      default: true,
    },
    // Logo URL（用于登录页展示图标）
    logoUrl: {
      type: String,
      default: '',
    },
    // 描述
    description: {
      type: String,
      default: '',
    },
    // 登录模式：normal=常规（自动创建或关联用户）；login_only=仅登录（不自动创建）
    loginMode: {
      type: String,
      enum: ['normal', 'login_only'],
      default: 'normal',
    },
    // 账号身份关联：是否允许通过邮箱等字段匹配已有用户
    accountLinking: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

const SocialConnection = mongoose.model('SocialConnection', socialConnectionSchema);

module.exports = SocialConnection;
