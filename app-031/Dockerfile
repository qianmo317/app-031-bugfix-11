# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码并构建（.dockerignore 已排除 node_modules/dist 等）
COPY . .
RUN npm run build

# ---------- 运行阶段（slim 变体，镜像 <60MB，仍为 nginx 1.27 / alpine）----------
FROM nginx:1.27-alpine-slim

# 仓库根目录的 nginx.conf 是等效参考配置；
# 因 .dockerignore 约定不发送 nginx.conf 进构建上下文，这里内联同内容配置
RUN printf '%s\n' \
'server {' \
'    listen       80;' \
'    server_name  _;' \
'    root   /usr/share/nginx/html;' \
'    index  index.html;' \
'' \
'    gzip              on;' \
'    gzip_comp_level   6;' \
'    gzip_min_length   1024;' \
'    gzip_vary         on;' \
'    gzip_proxied      any;' \
'    gzip_types        text/plain text/css text/xml application/javascript' \
'                      application/json image/svg+xml application/font-woff2;' \
'' \
'    location = /healthz {' \
'        access_log off;' \
'        default_type text/plain;' \
'        return 200 "ok";' \
'    }' \
'' \
'    location /assets/ {' \
'        expires 1y;' \
'        add_header Cache-Control "public, max-age=31536000, immutable";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location = /index.html {' \
'        add_header Cache-Control "no-cache, no-store, must-revalidate";' \
'    }' \
'' \
'    location / {' \
'        try_files $uri $uri/ /index.html;' \
'    }' \
'}' \
> /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
