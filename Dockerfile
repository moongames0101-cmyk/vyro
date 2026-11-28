# The online VYRO server (Render builds this).
# Litestream comes from its official image; it backs the database up to
# Backblaze B2 so accounts and messages survive restarts. See deploy/start.sh.
FROM litestream/litestream:0.5.14 AS litestream

FROM node:24-alpine
RUN apk add --no-cache ca-certificates
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

WORKDIR /app
COPY package.json vyro.config.json ./
COPY server ./server
COPY public ./public
COPY assets ./assets
COPY deploy ./deploy

ENV NODE_ENV=production
ENV PORT=3847
ENV VYRO_DATA_DIR=/app/data
EXPOSE 3847
CMD ["sh", "deploy/start.sh"]
