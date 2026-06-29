const { mongoose } = require('../db/mongo.db');

/**
 * 用户模型（参考 Authing user-profile 规范）
 * 字段分组：
 *  - 账号标识：username / phone / email （三选一即可登录，但每个都需全局唯一）
 *  - 鉴权：password / blocked / status
 *  - 个人资料：name / nickname / picture / gender / birthdate / address / company / website / profile / preferredUsername
 *  - 验证状态：emailVerified / phoneVerified
 *  - 系统审计：role / registerSource / loginsCount / lastLogin / lastIP / browser / device
 *  - 国际化：zoneinfo / locale
 *  - 自定义扩展：customData (Mixed)
 */
const userSchema = new mongoose.Schema(
  {
    // ============= 账号标识（三选一登录，全局唯一）=============
    username: {
      type: String,
      // 改为非必填：允许仅用 phone 或 email 创建账号
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      // 不设 default:'' — 否则 mongoose 会把 undefined 还原成空串，
      // 导致 sparse 唯一索引失效（多个用户 phone:'' 会冲突 E11000）
      // 不传 phone 字段时 mongoose 不会写入该字段，sparse 唯一索引才能正常工作
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      // 同 phone：不设 default:''，避免空串破坏 sparse 唯一索引
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    // ============= 鉴权 =============
    password: {
      type: String,
      required: true,
      select: false, // 默认查询不返回，需要时显式 .select('+password')
    },
    // 是否被锁定（管理员锁定 / 登录失败超阈值锁定）
    blocked: { type: Boolean, default: false },
    // 启用 / 停用（disabled 用户无法登录）
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
    },

    // ============= 登录失败计数（D2：MFA 失败 / 密码失败联动锁定）=============
    // 累计连续登录失败次数（成功登录后清零）
    // 当达到 client.loginPolicy.maxLoginFailures 时，blocked=true 且 lockedUntil 写入解锁时间
    failedLoginAttempts: { type: Number, default: 0 },
    // 锁定到期时间（null 表示未锁定 / 已过期）
    // 登录前检查：如果 lockedUntil > now → 拒绝登录；如果 lockedUntil <= now → 自动解锁清零
    lockedUntil: { type: Date, default: null },

    // ============= 风控审计（E3：MFA 失败时记录最近一次失败的 IP / 时间）=============
    // 用于管理员在用户详情页快速判断「这次锁定是否疑似攻击」
    // 与 LoginLog 的差异：LoginLog 是历史完整流水（可能很多）；这两个字段只保留最近一次，O(1) 查询
    lastFailedLoginIp: { type: String, default: '' },
    lastFailedLoginAt: { type: Date, default: null },

    // ============= 个人资料（OIDC StandardClaims §5.1）=============
    name: { type: String, required: true, trim: true }, // 姓名（必填，列表展示用，对应 OIDC name）
    // OIDC StandardClaims：拆分名（given_name / family_name / middle_name）
    // 用于支持西方姓名结构（First Middle Last），中文场景留空即可
    givenName: { type: String, default: '', trim: true }, // 名（first name）
    familyName: { type: String, default: '', trim: true }, // 姓（last name）
    middleName: { type: String, default: '', trim: true }, // 中间名
    nickname: { type: String, default: '', trim: true }, // 昵称（OIDC nickname）
    photo: { type: String, default: '' }, // 已废弃，请使用 picture 字段
    picture: { type: String, default: '' }, // 头像 URL（OIDC picture 标准字段）
    gender: { type: String, enum: ['M', 'F', 'U'], default: 'U' }, // M=男 F=女 U=未知
    birthdate: { type: Date, default: null }, // 生日（OIDC birthdate，YYYY-MM-DD）
    address: { type: String, default: '', trim: true }, // 地址（OIDC address.formatted）
    company: { type: String, default: '', trim: true }, // 公司
    website: { type: String, default: '', trim: true }, // 个人网站（OIDC website）
    profile: { type: String, default: '', trim: true }, // 个人简介（OIDC profile）
    preferredUsername: { type: String, default: '', trim: true }, // 首选展示名（OIDC preferred_username）

    // ============= 验证状态 =============
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    // ============= 系统审计 =============
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    // 注册来源：admin=管理员创建；self-register=用户自行注册；import=数据导入；social=社会化登录
    registerSource: {
      type: String,
      enum: ['admin', 'self-register', 'import', 'social'],
      default: 'self-register',
    },
    loginsCount: { type: Number, default: 0 }, // 累计登录次数
    lastLogin: { type: Date, default: null }, // 最后登录时间
    lastIP: { type: String, default: '' }, // 最后登录 IP
    browser: { type: String, default: '' }, // 注册时浏览器
    device: { type: String, default: '' }, // 注册时设备

    // ============= 多因素认证（MFA） =============
    // 通道：
    //   phone - 手机短信 OTP（基于 verifyCodeService）
    //   email - 邮箱 OTP（基于 verifyCodeService）
    //   totp  - 时间动态码（Google Authenticator / 1Password 等 TOTP App，RFC 6238）
    mfaEnabled: { type: Boolean, default: false },
    mfaChannel: { type: String, enum: ['phone', 'email', 'totp'], default: 'phone' },
    // TOTP 共享密钥（Base32 编码，与认证器 App 共享；仅在 mfaChannel=totp 时使用）
    // select:false：默认查询不返回，只有 .select('+totpSecret') 才能取出，避免泄漏
    totpSecret: { type: String, default: '', select: false },

    // ============= 国际化 =============
    zoneinfo: { type: String, default: 'Asia/Shanghai' },
    locale: { type: String, default: 'zh-CN' },

    // ============= 自定义扩展 =============
    customData: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    versionKey: false,
  },
);

// 至少需要一个标识字段（username / phone / email），用于支持三选一注册
// 使用同步函数（无 next 参数）以兼容 Mongoose 7+，抛出错误即视为校验失败
userSchema.pre('validate', function preValidate() {
  if (!this.username && !this.phone && !this.email) {
    throw new Error('用户名、手机号、邮箱至少需要填写一项');
  }
});

// 序列化时将 _id 转为 id，移除 password
userSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.password;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
