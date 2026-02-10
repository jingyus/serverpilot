# ==============================================================================
# ServerPilot Server - Production Dockerfile
# ==============================================================================
# Multi-stage build for minimal image size.
# Uses pnpm workspace with only the server and shared packages.
# SQLite database stored in /data volume for persistence.
# ==============================================================================

# --------------------------------------------------------------------------
# Stage 1: Install dependencies
# --------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# --------------------------------------------------------------------------
# Stage 2: Build TypeScript
# --------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Build shared first, then server (server depends on shared)
RUN pnpm --filter @aiinstaller/shared build && \
    pnpm --filter @aiinstaller/server build

# --------------------------------------------------------------------------
# Stage 3: Production runtime
# --------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# Add labels for image metadata
LABEL maintainer="ServerPilot Team"
LABEL description="ServerPilot Server - REST API + WebSocket with AI agent integration"
LABEL version="0.1.0"

# Create non-root user for security
RUN addgroup -g 1001 -S aiinstaller && \
    adduser -S aiinstaller -u 1001 -G aiinstaller

# Create data directory for SQLite persistence
RUN mkdir -p /data && chown aiinstaller:aiinstaller /data

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules

# Copy built output from build stage
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist

# Copy package.json files (needed for module resolution)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy knowledge-base if it exists (optional runtime data)
COPY knowledge-base/ ./knowledge-base/

# Set ownership
RUN chown -R aiinstaller:aiinstaller /app

# Switch to non-root user
USER aiinstaller

# Default environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV SERVER_HOST=0.0.0.0
ENV DATABASE_PATH=/data/serverpilot.db
ENV LOG_LEVEL=info

# Expose the server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

# Start the server
CMD ["node", "packages/server/dist/index.js"]
