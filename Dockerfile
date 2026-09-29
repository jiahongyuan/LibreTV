FROM node:lts-alpine

LABEL maintainer="LibreTV Team"
LABEL description="LibreTV - 免费在线视频搜索与观看平台"

# 设置环境变量
ENV PORT=8080
ENV CORS_ORIGIN=*
ENV DEBUG=false
ENV REQUEST_TIMEOUT=5000
ENV MAX_RETRIES=2
ENV CACHE_MAX_AGE=1d

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装全部依赖：构建阶段需要 Tailwind / PostCSS / Babel 等 devDependencies
RUN npm ci && npm cache clean --force

# 复制应用文件
COPY . .

# 生成面向 iOS 13.1 / Safari 13.1 的构建产物，并剔除仅构建期依赖
RUN npm run build && npm prune --omit=dev

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 启动应用
CMD ["npm", "start"]
