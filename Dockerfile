# 历史帆船帆布联合排版工作台
# 单镜像两用：
#   web    常驻服务（默认 CMD），提供静态工作台与 /healthz
#   verify 一次性服务：node src/server/verify.js，跑完即退出，退出码即结论
FROM node:22-alpine

WORKDIR /app

# 先装依赖（含 esbuild，供 verify 的“构建”阶段与镜像内预构建使用）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝源码与前端
COPY scripts ./scripts
COPY src ./src
COPY web ./web
COPY test ./test

# 镜像构建期预构建前端，供 web 直接以 dist/ 提供服务
RUN node scripts/build.js

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# Web 健康检查（alpine 自带 busybox wget；shell 形式以展开 $PORT）
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=10 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "src/server/server.js"]
