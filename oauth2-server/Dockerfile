# ============================================================
# OAuth2 Server - 多阶段构建 Dockerfile
# ============================================================

# --- Stage 1: 依赖安装 ---
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

# --- Stage 2: 生产镜像 ---
FROM node:20-alpine AS runner

WORKDIR /app

# 安全：使用非 root 用户
RUN addgroup -S oauth2 && adduser -S oauth2 -G oauth2

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制源码
COPY src ./src
COPY package.json ./

# 密钥目录（首次启动自动生成 EC P-256 密钥，通过 volume 持久化）
RUN mkdir -p /app/src/keys && chown -R oauth2:oauth2 /app

USER oauth2

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/.well-known/openid-configuration || exit 1

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
