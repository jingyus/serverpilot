# ==============================================================================
# ServerPilot Dashboard - Production Dockerfile
# ==============================================================================
# Multi-stage build: Node.js build -> Nginx static serving
# Nginx also acts as reverse proxy for API/WebSocket to the server container.
#
# Target image size: < 50MB
# ==============================================================================

# --------------------------------------------------------------------------
# Stage 1: Build the React application
# --------------------------------------------------------------------------
FROM node:22-alpine AS build

# Install pnpm globally
RUN npm install -g pnpm@10.13.1

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/server/package.json packages/server/package.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code (shared first, then dashboard)
COPY packages/shared/ packages/shared/
COPY packages/dashboard/ packages/dashboard/

# Build shared first, then dashboard
RUN pnpm --filter @aiinstaller/shared build && \
    pnpm --filter @aiinstaller/dashboard build

# --------------------------------------------------------------------------
# Stage 2: Nginx for static file serving + reverse proxy
# --------------------------------------------------------------------------
FROM nginx:alpine AS runtime

LABEL maintainer="ServerPilot Team"
LABEL description="ServerPilot Dashboard - React SPA with Nginx reverse proxy"
LABEL version="0.1.0"

# Install curl for health checks
RUN apk add --no-cache curl

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files from build stage
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html

EXPOSE 80

# Health check for nginx itself
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
