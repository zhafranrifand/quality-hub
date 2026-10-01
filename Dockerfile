FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/quality-hub-entrypoint
RUN chmod +x /usr/local/bin/quality-hub-entrypoint
RUN mkdir /data && chown node:node /data
EXPOSE 3000
ENTRYPOINT ["quality-hub-entrypoint"]
CMD ["node", "dist/server/index.js"]
