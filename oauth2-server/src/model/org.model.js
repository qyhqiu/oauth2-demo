const { mongoose } = require('../db/mongo.db');

/**
 * 组织架构节点（树形结构，用邻接表 parentId 实现）
 *
 * 层级示例：
 *   总公司 (root, parentId=null)
 *   ├── 技术部 (parentId=root._id)
 *   │   ├── 前端组
 *   │   └── 后端组
 *   └── 产品部
 */
const orgSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true, index: true },
    description: { type: String, default: '' },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      default: null,
      index: true,
    },
    order: { type: Number, default: 0 },
    // 关联的成员 userId 列表（冗余存储，方便查询）
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

orgSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Org', orgSchema);
