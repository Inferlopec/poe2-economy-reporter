FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG VERSION=0.3.0
LABEL org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.source="https://github.com/Inferlopec/poe2-economy-reporter"
ENV NODE_ENV=production DATA_DIR=/app/data CONFIG_PATH=/app/config.yaml
WORKDIR /app
RUN mkdir /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
VOLUME ["/app/data"]
ENTRYPOINT ["node", "dist/cli.js"]
