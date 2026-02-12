# ==============================================================================
# ServerPilot Agent - Production Dockerfile (Daemon Mode)
# ==============================================================================
# Multi-stage build for minimal image size.
# Reads token file from shared /data volume written by the server.
# ==============================================================================

# --------------------------------------------------------------------------
# Stage 1: Install dependencies and build TypeScript
# --------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/

# Build shared first, then agent
RUN pnpm --filter @aiinstaller/shared build && \
    pnpm --filter @aiinstaller/agent build

# Prune devDependencies
RUN pnpm prune --prod

# --------------------------------------------------------------------------
# Stage 2: Production runtime (minimal)
# --------------------------------------------------------------------------
FROM node:22-alpine AS runtime

LABEL maintainer="ServerPilot Team"
LABEL description="ServerPilot Agent - Daemon mode for co-located server management"
LABEL version="0.1.0"

# Create non-root user
RUN addgroup -g 1001 -S serverpilot && \
    adduser -S serverpilot -u 1001 -G serverpilot

WORKDIR /app

# Copy pruned production node_modules
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/agent/node_modules ./packages/agent/node_modules

# Copy built output
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/agent/dist ./packages/agent/dist

# Copy package.json files (needed for module resolution)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/agent/package.json ./packages/agent/package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Set ownership
RUN chown -R serverpilot:serverpilot /app

USER serverpilot

ENV NODE_ENV=production

# Start in daemon mode — reads token from /data/.local-agent-token
CMD ["node", "packages/agent/dist/index.js", "--daemon", "--server", "ws://server:3000"]
