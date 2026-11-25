FROM node:24-alpine

WORKDIR /app

COPY package.json vyro.config.json ./
COPY server ./server
COPY public ./public
COPY assets ./assets

ENV PORT=3847
ENV VYRO_DATA_DIR=/app/data

EXPOSE 3847

CMD ["node", "server/index.js"]
