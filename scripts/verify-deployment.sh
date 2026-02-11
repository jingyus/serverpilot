#!/usr/bin/env bash

# ==============================================================================
# ServerPilot - Docker Compose Deployment Verification Script
# ==============================================================================
# Verifies that Docker Compose deployment is properly configured and running.
#
# Usage:
#   ./scripts/verify-deployment.sh           # Full verification
#   ./scripts/verify-deployment.sh --static  # Static checks only (no running containers)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
# ==============================================================================

# Note: no `set -e` — the script tracks pass/fail internally and exits with
# code 1 when any check fails. Early-exit on error would prevent later checks
# from running and displaying a full report.

# --------------------------------------------------------------------------
# Colors (respect NO_COLOR)
# --------------------------------------------------------------------------
if [[ -z "${NO_COLOR:-}" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# --------------------------------------------------------------------------
# Counters
# --------------------------------------------------------------------------
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# --------------------------------------------------------------------------
# Print helpers
# --------------------------------------------------------------------------
print_header() {
  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}\n"
}

print_check() {
  echo -e "${YELLOW}[CHECK]${NC} $1"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

print_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

print_error() {
  echo -e "${RED}[FAIL]${NC} $1"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

print_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

# --------------------------------------------------------------------------
# Parse flags
# --------------------------------------------------------------------------
STATIC_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --static) STATIC_ONLY=true ;;
    --help|-h)
      echo "Usage: ./scripts/verify-deployment.sh [--static]"
      echo ""
      echo "Options:"
      echo "  --static   Run static checks only (no running containers required)"
      echo "  --help     Show this help"
      exit 0
      ;;
  esac
done

# --------------------------------------------------------------------------
# Get project root
# --------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

DASHBOARD_PORT="${DASHBOARD_PORT:-3001}"

# ==============================================================================
# Prerequisites Check
# ==============================================================================

print_header "Prerequisites"

DOCKER_AVAILABLE=false

print_check "Docker installed"
if command -v docker >/dev/null 2>&1; then
  DOCKER_VERSION=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  print_success "Docker $DOCKER_VERSION"

  print_check "Docker Compose available"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    print_success "Docker Compose $COMPOSE_VERSION"
  else
    print_error "Docker Compose not available"
  fi

  print_check "Docker daemon running"
  if docker info >/dev/null 2>&1; then
    print_success "Docker daemon is running"
    DOCKER_AVAILABLE=true
  else
    print_error "Docker daemon not running"
  fi
else
  print_error "Docker not installed (https://docs.docker.com/get-docker/)"
  print_info "Skipping Docker-dependent checks"
fi

# ==============================================================================
# File Structure Check
# ==============================================================================

print_header "File Structure"

REQUIRED_FILES=(
  "docker-compose.yml"
  ".env.example"
  "packages/server/Dockerfile"
  "packages/dashboard/Dockerfile"
  "packages/dashboard/nginx.conf"
  ".dockerignore"
  "init.sh"
  "pnpm-workspace.yaml"
  "pnpm-lock.yaml"
)

for file in "${REQUIRED_FILES[@]}"; do
  print_check "$file exists"
  if [ -f "$file" ]; then
    print_success "$file"
  else
    print_error "$file missing"
  fi
done

print_check "knowledge-base/ directory exists"
if [ -d "knowledge-base" ]; then
  KB_COUNT=$(find knowledge-base -name "*.md" | wc -l | tr -d ' ')
  print_success "knowledge-base/ ($KB_COUNT markdown files)"
else
  print_error "knowledge-base/ directory missing"
fi

# ==============================================================================
# Docker Compose Configuration Check
# ==============================================================================

print_header "Docker Compose Configuration"

if [ "$DOCKER_AVAILABLE" = "true" ]; then
  print_check "docker-compose.yml valid YAML"
  if docker compose config >/dev/null 2>&1; then
    print_success "YAML syntax valid"
  else
    print_error "YAML syntax errors"
    docker compose config 2>&1 | head -5
  fi

  print_check "Required services defined"
  SERVICES=$(docker compose config --services 2>/dev/null || echo "")
  if echo "$SERVICES" | grep -q "server" && echo "$SERVICES" | grep -q "dashboard"; then
    print_success "Services: server, dashboard"
  else
    print_error "Missing required services (found: $SERVICES)"
  fi

  print_check "Server health check configured"
  if docker compose config 2>/dev/null | grep -A 20 "server:" | grep -q "healthcheck:"; then
    print_success "Server health check present"
  else
    print_error "Server health check missing"
  fi

  print_check "Dashboard depends on server (service_healthy)"
  if docker compose config 2>/dev/null | grep -A 10 "dashboard:" | grep -q "service_healthy"; then
    print_success "Dashboard waits for healthy server"
  else
    print_error "Dashboard does not depend on server health"
  fi

  print_check "Server restart policy"
  SERVER_RESTART=$(docker compose config 2>/dev/null | grep -A 30 "serverpilot-server" | grep "restart:" | head -1 | awk '{print $2}' | tr -d '"')
  if [ "$SERVER_RESTART" = "unless-stopped" ]; then
    print_success "Server: restart unless-stopped"
  else
    print_error "Server restart policy: $SERVER_RESTART (expected: unless-stopped)"
  fi

  print_check "Custom network defined"
  if docker compose config 2>/dev/null | grep -q "serverpilot-network"; then
    print_success "Network: serverpilot-network"
  else
    print_error "Custom network not defined"
  fi

  print_check "SQLite data volume defined"
  if docker compose config 2>/dev/null | grep -q "server-data"; then
    print_success "Volume: server-data (SQLite persistence)"
  else
    print_error "server-data volume not defined"
  fi
else
  print_info "Skipping Docker Compose validation (Docker not available)"
  # Fall back to text-based checks
  print_check "docker-compose.yml contains server service"
  if grep -q "server:" docker-compose.yml; then
    print_success "Server service defined"
  else
    print_error "Server service missing"
  fi

  print_check "docker-compose.yml contains dashboard service"
  if grep -q "dashboard:" docker-compose.yml; then
    print_success "Dashboard service defined"
  else
    print_error "Dashboard service missing"
  fi

  print_check "Server health check configured"
  if grep -q "healthcheck:" docker-compose.yml; then
    print_success "Health check present"
  else
    print_error "Health check missing"
  fi

  print_check "Custom network defined"
  if grep -q "serverpilot-network" docker-compose.yml; then
    print_success "Network: serverpilot-network"
  else
    print_error "Custom network not defined"
  fi

  print_check "SQLite data volume defined"
  if grep -q "server-data" docker-compose.yml; then
    print_success "Volume: server-data"
  else
    print_error "server-data volume not defined"
  fi
fi

# ==============================================================================
# Dockerfile Checks
# ==============================================================================

print_header "Dockerfile Configuration"

print_check "Server Dockerfile: multi-stage build"
STAGE_COUNT=$(grep -c "^FROM" packages/server/Dockerfile)
if [ "$STAGE_COUNT" -ge 2 ]; then
  STAGES=$(grep "^FROM.*AS" packages/server/Dockerfile | awk '{print $NF}' | tr '\n' ', ' | sed 's/,$//')
  print_success "Server: multi-stage ($STAGES)"
else
  print_error "Server Dockerfile does not use multi-stage build"
fi

print_check "Server Dockerfile: non-root user"
if grep -q "^USER" packages/server/Dockerfile; then
  USER_NAME=$(grep "^USER" packages/server/Dockerfile | awk '{print $2}')
  print_success "Server runs as non-root user ($USER_NAME)"
else
  print_error "Server runs as root (security risk)"
fi

print_check "Server Dockerfile: health check"
if grep -q "HEALTHCHECK" packages/server/Dockerfile; then
  print_success "Server Dockerfile has HEALTHCHECK"
else
  print_info "Server Dockerfile has no HEALTHCHECK (defined in docker-compose.yml)"
fi

print_check "Dashboard Dockerfile: nginx runtime"
if grep -q "nginx:alpine" packages/dashboard/Dockerfile; then
  print_success "Dashboard uses nginx:alpine"
else
  print_error "Dashboard does not use nginx:alpine"
fi

print_check "Dashboard Dockerfile: curl for healthcheck"
if grep -q "curl" packages/dashboard/Dockerfile; then
  print_success "Dashboard has curl installed for healthcheck"
else
  print_error "Dashboard missing curl for healthcheck"
fi

# ==============================================================================
# Nginx Configuration
# ==============================================================================

print_header "Nginx Configuration"

print_check "API proxy configuration"
if grep -q "location /api/" packages/dashboard/nginx.conf; then
  print_success "API proxy: /api/ -> server:3000"
else
  print_error "API proxy not configured"
fi

print_check "WebSocket proxy configuration"
if grep -q 'location /ws' packages/dashboard/nginx.conf && grep -q 'Upgrade' packages/dashboard/nginx.conf; then
  print_success "WebSocket proxy: /ws -> server:3000 (with upgrade)"
else
  print_error "WebSocket proxy not properly configured"
fi

print_check "Health check proxy"
if grep -q "location /health" packages/dashboard/nginx.conf; then
  print_success "Health proxy: /health -> server:3000"
else
  print_error "Health check proxy not configured"
fi

print_check "SPA fallback"
if grep -q "try_files.*index.html" packages/dashboard/nginx.conf; then
  print_success "SPA fallback: try_files -> /index.html"
else
  print_error "SPA fallback not configured"
fi

print_check "Gzip compression"
if grep -q "gzip on" packages/dashboard/nginx.conf; then
  print_success "Gzip compression enabled"
else
  print_error "Gzip compression not enabled"
fi

print_check "Static asset caching"
if grep -q "location /assets/" packages/dashboard/nginx.conf; then
  print_success "Static asset caching configured"
else
  print_error "Static asset caching not configured"
fi

print_check "Security headers (X-Frame-Options)"
if grep -q "X-Frame-Options" packages/dashboard/nginx.conf; then
  print_success "X-Frame-Options header present"
else
  print_error "X-Frame-Options header missing"
fi

print_check "Security headers (X-Content-Type-Options)"
if grep -q "X-Content-Type-Options" packages/dashboard/nginx.conf; then
  print_success "X-Content-Type-Options header present"
else
  print_error "X-Content-Type-Options header missing"
fi

print_check "Request body size limit"
if grep -q "client_max_body_size" packages/dashboard/nginx.conf; then
  print_success "Request body size limit configured"
else
  print_error "No request body size limit (client_max_body_size)"
fi

# ==============================================================================
# Security Checks
# ==============================================================================

print_header "Security"

print_check "No hardcoded secrets in docker-compose.yml"
if grep -E "(password|secret|key).*[:=].*['\"]?[a-zA-Z0-9]{16,}" docker-compose.yml | grep -v "\${" | grep -v "#" | grep -qv "KNOWLEDGE_BASE"; then
  print_error "Potential hardcoded secrets found in docker-compose.yml"
else
  print_success "No hardcoded secrets in docker-compose.yml"
fi

print_check ".env excluded from Docker build context"
if grep -q "^\.env" .dockerignore; then
  print_success ".env files excluded in .dockerignore"
else
  print_error ".env files not excluded in .dockerignore"
fi

print_check "node_modules excluded from Docker build context"
if grep -q "node_modules" .dockerignore; then
  print_success "node_modules excluded in .dockerignore"
else
  print_error "node_modules not excluded in .dockerignore"
fi

# ==============================================================================
# Operational Checks
# ==============================================================================

print_header "Operational Configuration"

print_check "Logging driver configured"
if grep -q "json-file" docker-compose.yml && grep -q "max-size" docker-compose.yml; then
  print_success "JSON-file logging with rotation configured"
else
  print_error "Logging driver or rotation not configured"
fi

print_check "Graceful shutdown (stop_grace_period)"
if grep -q "stop_grace_period" docker-compose.yml; then
  print_success "stop_grace_period configured"
else
  print_error "stop_grace_period not configured"
fi

# ==============================================================================
# .env.example Check
# ==============================================================================

print_header "Environment Template"

REQUIRED_ENV_VARS=(
  "DASHBOARD_PORT"
  "JWT_SECRET"
  "ANTHROPIC_API_KEY"
  "AI_MODEL"
  "LOG_LEVEL"
  "ADMIN_EMAIL"
)

for var in "${REQUIRED_ENV_VARS[@]}"; do
  print_check "$var in .env.example"
  if grep -q "^$var" .env.example 2>/dev/null; then
    print_success "$var defined"
  else
    print_error "$var missing from .env.example"
  fi
done

# ==============================================================================
# Runtime Verification (if services are running)
# ==============================================================================

if [ "$STATIC_ONLY" = "true" ]; then
  print_info "Skipping runtime checks (--static mode)"
else
  print_header "Runtime Verification"

  RUNNING_CONTAINERS=$(docker compose ps --services --filter "status=running" 2>/dev/null || echo "")

  if [ -z "$RUNNING_CONTAINERS" ]; then
    print_info "No services running. Start with: docker compose up -d"
    print_info "Skipping runtime checks."
  else
    print_success "Docker Compose services detected"

    # Check server container
    print_check "Server container status"
    SERVER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' serverpilot-server 2>/dev/null || echo "not_found")
    if [ "$SERVER_HEALTH" = "healthy" ]; then
      print_success "Server container: healthy"
    else
      print_info "Server container: $SERVER_HEALTH (may need up to 30s)"
    fi

    # Check dashboard container
    print_check "Dashboard container status"
    DASHBOARD_STATUS=$(docker inspect --format='{{.State.Status}}' serverpilot-dashboard 2>/dev/null || echo "not_found")
    if [ "$DASHBOARD_STATUS" = "running" ]; then
      print_success "Dashboard container: running"
    else
      print_error "Dashboard container: $DASHBOARD_STATUS"
    fi

    # Test health endpoint via dashboard (nginx proxy)
    print_check "Health endpoint (http://localhost:${DASHBOARD_PORT}/health)"
    if curl -sf "http://localhost:${DASHBOARD_PORT}/health" >/dev/null 2>&1; then
      HEALTH_RESPONSE=$(curl -sf "http://localhost:${DASHBOARD_PORT}/health")
      print_success "Health: $HEALTH_RESPONSE"
    else
      print_error "Health endpoint not responding"
    fi

    # Test dashboard static files
    print_check "Dashboard (http://localhost:${DASHBOARD_PORT}/)"
    if curl -sf "http://localhost:${DASHBOARD_PORT}/" >/dev/null 2>&1; then
      print_success "Dashboard is accessible"
    else
      print_error "Dashboard not accessible"
    fi

    # Test API proxy
    print_check "API proxy (http://localhost:${DASHBOARD_PORT}/api/v1/auth/login)"
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${DASHBOARD_PORT}/api/v1/auth/login" -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
    if [ "$API_STATUS" != "000" ]; then
      print_success "API proxy responds (HTTP $API_STATUS)"
    else
      print_error "API proxy not responding"
    fi

    # Test WebSocket upgrade
    print_check "WebSocket endpoint (ws://localhost:${DASHBOARD_PORT}/ws)"
    WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Upgrade: websocket" -H "Connection: Upgrade" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" "http://localhost:${DASHBOARD_PORT}/ws" 2>/dev/null || echo "000")
    if [ "$WS_STATUS" = "101" ] || [ "$WS_STATUS" = "400" ] || [ "$WS_STATUS" = "426" ]; then
      print_success "WebSocket endpoint reachable (HTTP $WS_STATUS)"
    else
      print_error "WebSocket endpoint not responding (HTTP $WS_STATUS)"
    fi

    # Test data persistence (check SQLite volume)
    print_check "SQLite data persistence"
    DB_EXISTS=$(docker exec serverpilot-server test -f /data/serverpilot.db && echo "yes" || echo "no")
    if [ "$DB_EXISTS" = "yes" ]; then
      DB_SIZE=$(docker exec serverpilot-server ls -lh /data/serverpilot.db 2>/dev/null | awk '{print $5}')
      print_success "SQLite database exists ($DB_SIZE)"
    else
      print_error "SQLite database not found at /data/serverpilot.db"
    fi

    # Check for errors in container logs
    print_check "Container logs (recent errors)"
    ERROR_COUNT=$(docker compose logs --tail=50 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER\|error_handler\|onError\|logError" | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -eq 0 ]; then
      print_success "No errors in recent logs"
    else
      print_error "Found $ERROR_COUNT error(s) in recent logs"
      docker compose logs --tail=50 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER\|error_handler\|onError\|logError" | tail -3
    fi
  fi
fi

# ==============================================================================
# Summary
# ==============================================================================

print_header "Verification Summary"

echo ""
echo "Total Checks:  $TOTAL_CHECKS"
echo -e "${GREEN}Passed:        $PASSED_CHECKS${NC}"
if [ $FAILED_CHECKS -gt 0 ]; then
  echo -e "${RED}Failed:        $FAILED_CHECKS${NC}"
else
  echo "Failed:        $FAILED_CHECKS"
fi
echo ""

if [ $FAILED_CHECKS -eq 0 ]; then
  echo -e "${GREEN}All checks passed!${NC}"
  echo ""
  if [ -z "${RUNNING_CONTAINERS:-}" ] || [ "$STATIC_ONLY" = "true" ]; then
    echo "Next steps:"
    echo "  1. Start services:   docker compose up -d"
    echo "  2. Follow logs:      docker compose logs -f"
    echo "  3. Wait ~30s for health checks"
    echo "  4. Re-run this script for runtime checks"
    echo "  5. Open Dashboard:   http://localhost:${DASHBOARD_PORT}"
  else
    echo "Deployment is fully verified and running!"
    echo ""
    echo "Access points:"
    echo "  Dashboard:   http://localhost:${DASHBOARD_PORT}"
    echo "  API:         http://localhost:${DASHBOARD_PORT}/api/v1"
    echo "  Health:      http://localhost:${DASHBOARD_PORT}/health"
    echo "  API Docs:    http://localhost:${DASHBOARD_PORT}/api-docs"
    echo ""
    echo "Commands:"
    echo "  docker compose logs -f         # Follow logs"
    echo "  docker compose ps              # Service status"
    echo "  docker compose restart server  # Restart server"
    echo "  docker compose down            # Stop all"
  fi
  echo ""
  exit 0
else
  echo -e "${RED}Some checks failed. Please fix the issues above.${NC}"
  echo ""
  echo "Common solutions:"
  echo "  - Ensure all required files exist"
  echo "  - Validate docker-compose.yml: docker compose config"
  echo "  - Check .env file configuration"
  echo "  - View logs: docker compose logs"
  echo ""
  exit 1
fi
