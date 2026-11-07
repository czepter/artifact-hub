FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 HUB_DB=/data/hub.sqlite
COPY --from=build /app/.output ./.output
RUN mkdir /data && chown node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
