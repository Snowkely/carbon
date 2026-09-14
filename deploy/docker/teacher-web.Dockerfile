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
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_OUTPUT_STANDALONE=true
ENV NODE_ENV=production
COPY . .
RUN test -n "$NEXT_PUBLIC_API_URL"
RUN pnpm --filter @carbon/teacher-web... build

FROM node:22.20.0-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN chown node:node /app
COPY --from=build --chown=node:node /workspace/apps/teacher-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/teacher-web/.next/static ./apps/teacher-web/.next/static
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "apps/teacher-web/server.js"]
