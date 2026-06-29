/**
 * 路由动态注册器
 *
 * 自动扫描 router/ 目录下所有 v 开头的版本目录（v1、v2、v3...），
 * 加载其中的 *.routes.js 文件并注册到 Express app。
 * 新增版本目录后无需手动引入，自动注册。
 *
 * 路由文件导出约定：
 *   - 单路由：module.exports = { prefix: '/xxx', router }
 *   - 多路由：module.exports = [{ prefix: '/xxx', router }, { prefix: '/yyy', router }]
 */
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

function registerRoutes(app) {
  const routerDir = path.resolve(__dirname);
  const versionDirs = fs.readdirSync(routerDir).filter((item) => {
    return item.startsWith('v') && fs.statSync(path.join(routerDir, item)).isDirectory();
  });

  versionDirs.forEach((versionDir) => {
    const dirPath = path.join(routerDir, versionDir);
    const routeFiles = fs.readdirSync(dirPath).filter((file) => file.endsWith('.routes.js'));

    routeFiles.forEach((file) => {
      const routeModule = require(path.join(dirPath, file));

      // 支持数组（多前缀）和对象（单前缀）两种导出格式
      const entries = Array.isArray(routeModule) ? routeModule : [routeModule];

      entries.forEach(({ prefix, router }) => {
        if (!prefix || !router) {
          logger.warn(`⚠️ 路由文件 ${versionDir}/${file} 导出格式不正确，跳过`);
          return;
        }
        // .well-known 端点按 RFC 规范必须位于根路径，不加版本前缀
        const fullPrefix = prefix.startsWith('/.well-known') ? prefix : `/${versionDir}${prefix}`;
        app.use(fullPrefix, router);
        logger.info(`  📌 ${fullPrefix} ← ${versionDir}/${file}`);
      });
    });
  });
}

module.exports = { registerRoutes };
