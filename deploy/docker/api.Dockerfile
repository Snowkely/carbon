# syntax=docker/dockerfile:1.7
FROM node:22.20.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/teacher-web/package.json apps/teacher-web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/content-schema/package.json packages/content-schema/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-rules/package.json packages/game-rules/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
RUN --mount=type=cache,id=carbon-pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm --filter @carbon/api prisma:generate
RUN pnpm --filter @carbon/api... build
RUN pnpm --filter @carbon/api deploy --prod --legacy /opt/api
RUN cp -R /workspace/apps/api/prisma /opt/api/prisma \
    && cd /opt/api \
    && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
RUN rm -rf /opt/api/src /opt/api/test /opt/api/coverage /opt/api/tsconfig*.json

FROM node:22.20.0-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
RUN apk add --no-cache openssl \
    && chown node:node /app
COPY --from=build --chown=node:node /opt/api ./
COPY --from=build --chown=node:node /workspace/apps/api/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/api/prisma ./prisma
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node", "dist/src/main.js"]
