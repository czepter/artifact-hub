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
# Optional headless browser so boards render as real pictures in /render (PNG/SVG/...): docker build --build-arg WITH_CHROMIUM=1 .
# Without an alias system-ui resolves to a monospace font here, so board pictures would look wrong.
# Without it boards render as text outlines. Debian's chromium exists for amd64 and arm64. HUB_CHROMIUM_NO_SANDBOX: see README, "Rendering".
ARG WITH_CHROMIUM=0
RUN if [ "$WITH_CHROMIUM" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && rm -rf /var/lib/apt/lists/* && printf '<fontconfig><alias binding="strong"><family>system-ui</family><prefer><family>Liberation Sans</family></prefer></alias><alias binding="strong"><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias></fontconfig>' > /etc/fonts/local.conf; fi
ENV HUB_CHROMIUM_NO_SANDBOX=$WITH_CHROMIUM
RUN mkdir /data && chown node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
