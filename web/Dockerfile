# Build from the repo root so the shared @kin/types workspace is available:
#   docker build -f web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY packages/types packages/types
COPY web web
RUN npm run build -w @kin/types && npm run build -w @kin/web

# Serve the static build with nginx, which also proxies /api to the api service
# (same-origin in prod, mirroring the Vite dev proxy).
FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
