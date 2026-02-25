# ==============================================================================
# ServerPilot Server - Production Dockerfile
# ==============================================================================
# Multi-stage build for minimal image size.
# Uses pnpm workspace with only the server and shared packages.
# SQLite database stored in /data volume for persistence.
#
# Target image size: < 250MB (with all dependencies)
# ==============================================================================

# --------------------------------------------------------------------------
# Stage 1: Install all dependencies and build TypeScript
# --------------------------------------------------------------------------
FROM node:22-alpine AS build

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Build shared first, then server (server depends on shared)
RUN pnpm --filter @aiinstaller/shared build && \
    pnpm --filter @aiinstaller/server build

# --------------------------------------------------------------------------
# Stage 2: Production runtime (minimal)
# --------------------------------------------------------------------------
FROM node:22-alpine AS runtime

LABEL maintainer="ServerPilot Team"
LABEL description="ServerPilot Server - REST API + WebSocket with AI agent integration"
LABEL version="0.1.0"

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# Create non-root user for security
RUN addgroup -g 1001 -S serverpilot && \
    adduser -S serverpilot -u 1001 -G serverpilot

# Create data directory for SQLite persistence
RUN mkdir -p /data && chown serverpilot:serverpilot /data

WORKDIR /app

# Copy workspace config and package.json files
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/server/package.json ./packages/server/package.json

# Install production dependencies and rebuild native modules for Alpine Linux
RUN pnpm install --frozen-lockfile --prod && \
    pnpm rebuild better-sqlite3

# Copy built TypeScript output
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist

# Copy knowledge-base (built-in documentation for AI agent)
COPY knowledge-base/ ./knowledge-base/

# Set ownership
RUN chown -R serverpilot:serverpilot /app

# Switch to non-root user
USER serverpilot

# Default environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV SERVER_HOST=0.0.0.0
ENV DATABASE_PATH=/data/serverpilot.db
ENV LOG_LEVEL=info

# Expose the server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

# Start the server
CMD ["node", "packages/server/dist/index.js"]
