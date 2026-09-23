FROM node:24.21.0-alpine AS base

# Install libc6-compat for compatibility with native modules on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Enable Corepack and activate specified pnpm version
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

# --- Dependencies Stage ---
FROM base AS deps
WORKDIR /app

# Copy dependency definition files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

# Install all dependencies with pnpm store cache mount
# target=/root/.local/share/pnpm/store: inside the alpine container, this is the
#   default location where `pnpm` reads and writes cached packages
# `id`: The actual cached data is stored in Docker BuildKit's internal cache storage
#   on the host machine (managed by Docker, not an arbitary folder on your host filesystem)
# The `id=pnpm` tell BuildKit to attach persistent cache pool with `id = pnpm` to the container `target`
#   during the build step
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Builder Stage ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build standalone Next.js application with compilation cache mount
RUN --mount=type=cache,id=sql-backups-nextjs,target=/app/.next/cache \
    pnpm build

# --- Runner Stage ---
FROM node:24.21.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create unprivileged user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy static assets and standalone build output
# currently this project does not have public directory, hence do not copy it for now
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
