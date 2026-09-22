# syntax=docker/dockerfile:1.7
FROM node:22.20.0-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV CLASSROOM_WEB_BUILD=true
ENV EXPO_NO_DOTENV=1
RUN corepack enable
WORKDIR /workspace

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

COPY . .
RUN pnpm run build:mobile-deps
RUN pnpm --filter @carbon/mobile build:classroom-web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY deploy/local-classroom/student-web.nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/apps/mobile/dist /usr/share/nginx/html/student
EXPOSE 8080
STOPSIGNAL SIGQUIT
