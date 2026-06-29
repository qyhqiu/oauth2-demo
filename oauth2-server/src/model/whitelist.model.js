const { mongoose } = require('../db/mongo.db');

/**
 * 注册白名单模型
 *
 * 当全局开关 registrationEnabled=false 时，仅白名单内的手机号/邮箱/用户名可以自行注册。
 * 管理员通过控制台创建账号不受白名单限制。
 *
 * type 字段：
 *   - phone：手机号精确匹配
 *   - email：邮箱精确匹配 / 域名后缀匹配（如 @company.com）
 *   - username：用户名精确匹配
 */
const whitelistSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['phone', 'email', 'username'],
      required: true,
      index: true,
    },
    value: {
      type: String,
      required: true,
      trim: true,
    },
    remark: { type: String, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// 同类型同值不允许重复
whitelistSchema.index({ type: 1, value: 1 }, { unique: true });

whitelistSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Whitelist', whitelistSchema);
