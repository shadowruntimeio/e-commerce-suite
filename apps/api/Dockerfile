FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @ems/db generate
RUN pnpm --filter @ems/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/node_modules/.pnpm @prisma ./node_modules/.pnpm

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
