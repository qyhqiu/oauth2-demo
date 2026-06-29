const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/oauth2-server-db';

async function connectMongoDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info('✅ MongoDB 连接成功:', MONGODB_URI);
  } catch (err) {
    logger.error('❌ MongoDB 连接失败:', err.message);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️  MongoDB 连接断开，正在重连...');
});

mongoose.connection.on('error', (err) => {
  logger.error('❌ MongoDB 错误:', err.message);
});

module.exports = { connectMongoDB, mongoose };
