# Build from the repo root so the shared @kin/types workspace is available:
#   docker build -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
# Manifests first so `npm ci` stays cached while source changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY packages/types packages/types
COPY server server
RUN npm run build -w @kin/types && npm run build -w @kin/server

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/types/package.json packages/types/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
COPY --from=build /app/packages/types/dist packages/types/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
