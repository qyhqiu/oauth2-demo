const { mongoose } = require('../db/mongo.db');

/**
 * 用户分组模型
 *
 * 分组用于对用户进行批量管理和批量授权（如：VIP 用户组、内测用户组等）
 * 与「组织架构」的区别：分组是扁平的，不像组织是树形层级
 */
const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, default: '', trim: true, index: true },
    description: { type: String, default: '' },
    // 分组成员
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // 授权的应用 clientId 列表（批量授权）
    authorizedApps: [{ type: String }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

groupSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Group', groupSchema);
