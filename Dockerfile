# ── сборка ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/ocr-bench/package.json tools/ocr-bench/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

RUN pnpm --filter @fc/contracts run build \
 && pnpm --filter @fc/web run build \
 && pnpm --filter @fc/api run build

# продакшен-зависимости отдельным слоем, без devDependencies
RUN pnpm --filter @fc/api --prod --legacy deploy /out \
 && cp -r apps/api/dist /out/dist

# ── исполнение ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# sharp и onnxruntime тянут нативные библиотеки
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out ./apps/api
COPY --from=build /app/apps/web/.output/public ./apps/web/.output/public

# веса PP-OCRv5 скачиваются при первом распознавании и кэшируются здесь;
# каталог вынесен томом, чтобы не качать заново при каждом обновлении образа
ENV XDG_CACHE_HOME=/cache
RUN mkdir -p /cache /app/storage/screenshots

WORKDIR /app/apps/api
EXPOSE 4080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
