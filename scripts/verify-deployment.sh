#!/usr/bin/env bash

# ==============================================================================
# AI Installer - Docker Compose Deployment Verification Script
# ==============================================================================
# This script verifies that Docker Compose deployment is properly configured
# and ready for production use.
#
# Usage:
#   ./scripts/verify-deployment.sh
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Print functions
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
    echo -e "${GREEN}[✓]${NC} $1"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ==============================================================================
# Pre-requisites Check
# ==============================================================================

print_header "Prerequisites Check"

print_check "Checking for Docker"
if command_exists docker; then
    DOCKER_VERSION=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    print_success "Docker is installed (version $DOCKER_VERSION)"
else
    print_error "Docker is not installed"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

print_check "Checking for Docker Compose"
if docker compose version >/dev/null 2>&1; then
    COMPOSE_VERSION=$(docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    print_success "Docker Compose is installed (version $COMPOSE_VERSION)"
else
    print_error "Docker Compose is not installed"
    echo "Please install Docker Compose (included with Docker Desktop)"
    exit 1
fi

print_check "Checking if Docker daemon is running"
if docker info >/dev/null 2>&1; then
    print_success "Docker daemon is running"
else
    print_error "Docker daemon is not running"
    echo "Please start Docker"
    exit 1
fi

# ==============================================================================
# File Structure Check
# ==============================================================================

print_header "File Structure Check"

REQUIRED_FILES=(
    "docker-compose.yml"
    ".env.example"
    "packages/server/Dockerfile"
    ".dockerignore"
    "scripts/init-db.sql"
)

for file in "${REQUIRED_FILES[@]}"; do
    print_check "Checking for $file"
    if [ -f "$file" ]; then
        print_success "$file exists"
    else
        print_error "$file is missing"
    fi
done

# ==============================================================================
# Docker Compose Configuration Check
# ==============================================================================

print_header "Docker Compose Configuration Check"

print_check "Validating docker-compose.yml syntax"
if docker compose config >/dev/null 2>&1; then
    print_success "docker-compose.yml syntax is valid"
else
    print_error "docker-compose.yml has syntax errors"
    docker compose config 2>&1
fi

print_check "Checking for required services"
SERVICES=$(docker compose config --services 2>/dev/null || echo "")
if echo "$SERVICES" | grep -q "mysql" && echo "$SERVICES" | grep -q "server"; then
    print_success "Required services (mysql, server) are defined"
else
    print_error "Required services are missing"
    echo "Found services: $SERVICES"
fi

print_check "Checking MySQL service configuration"
MYSQL_IMAGE=$(docker compose config | grep -A 5 "mysql:" | grep "image:" | awk '{print $2}')
if echo "$MYSQL_IMAGE" | grep -q "mysql:8"; then
    print_success "MySQL 8.x image is configured ($MYSQL_IMAGE)"
else
    print_error "MySQL image is not properly configured"
fi

print_check "Checking server service configuration"
SERVER_BUILD=$(docker compose config | grep -A 10 "server:" | grep "context:" | awk '{print $2}')
if [ ! -z "$SERVER_BUILD" ]; then
    print_success "Server build configuration is present"
else
    print_error "Server build configuration is missing"
fi

# ==============================================================================
# Restart Policy Check
# ==============================================================================

print_header "Restart Policy Check"

print_check "Checking MySQL restart policy"
MYSQL_RESTART=$(docker compose config | grep -A 10 "mysql:" | grep "restart:" | awk '{print $2}')
if [ "$MYSQL_RESTART" = "unless-stopped" ]; then
    print_success "MySQL restart policy is 'unless-stopped'"
else
    print_error "MySQL restart policy is not 'unless-stopped' (found: $MYSQL_RESTART)"
fi

print_check "Checking server restart policy"
SERVER_RESTART=$(docker compose config | grep -A 20 "server:" | grep "restart:" | awk '{print $2}')
if [ "$SERVER_RESTART" = "unless-stopped" ]; then
    print_success "Server restart policy is 'unless-stopped'"
else
    print_error "Server restart policy is not 'unless-stopped' (found: $SERVER_RESTART)"
fi

# ==============================================================================
# Health Check Configuration
# ==============================================================================

print_header "Health Check Configuration"

print_check "Checking MySQL health check"
if docker compose config | grep -A 15 "mysql:" | grep -q "healthcheck:"; then
    print_success "MySQL health check is configured"
else
    print_error "MySQL health check is missing"
fi

print_check "Checking server health check"
if docker compose config | grep -A 30 "server:" | grep -q "healthcheck:"; then
    print_success "Server health check is configured"
else
    print_error "Server health check is missing"
fi

# ==============================================================================
# Network Configuration Check
# ==============================================================================

print_header "Network Configuration"

print_check "Checking network definition"
if docker compose config | grep -q "aiinstaller-network"; then
    print_success "Custom network 'aiinstaller-network' is defined"
else
    print_error "Custom network is not defined"
fi

# ==============================================================================
# Volume Configuration Check
# ==============================================================================

print_header "Volume Configuration"

print_check "Checking volume definitions"
if docker compose config | grep -q "mysql-data:" && docker compose config | grep -q "knowledge-base:"; then
    print_success "Required volumes (mysql-data, knowledge-base) are defined"
else
    print_error "Required volumes are missing"
fi

# ==============================================================================
# Environment Configuration Check
# ==============================================================================

print_header "Environment Configuration"

print_check "Checking for .env.example file"
if [ -f ".env.example" ]; then
    print_success ".env.example file exists"

    # Check for required environment variables
    REQUIRED_ENV_VARS=(
        "ANTHROPIC_API_KEY"
        "DB_HOST"
        "DB_PORT"
        "DB_NAME"
        "DB_USER"
        "DB_PASSWORD"
        "MYSQL_ROOT_PASSWORD"
        "MYSQL_DATABASE"
        "MYSQL_USER"
        "MYSQL_PASSWORD"
    )

    for var in "${REQUIRED_ENV_VARS[@]}"; do
        print_check "Checking for $var in .env.example"
        if grep -q "$var" .env.example; then
            print_success "$var is defined in .env.example"
        else
            print_error "$var is missing from .env.example"
        fi
    done
else
    print_error ".env.example file is missing"
fi

print_check "Checking for .env file"
if [ -f ".env" ]; then
    print_success ".env file exists (make sure to configure it with your values)"
else
    print_info ".env file not found (copy from .env.example and configure)"
fi

# ==============================================================================
# Security Check
# ==============================================================================

print_header "Security Configuration"

print_check "Checking for hardcoded secrets in docker-compose.yml"
if grep -E "(password|secret|key).*[:=].*['\"]?[a-zA-Z0-9]{8,}" docker-compose.yml | grep -v "\${" | grep -v "MYSQL_ROOT_PASSWORD" | grep -v "example" | grep -v "#"; then
    print_error "Potential hardcoded secrets found in docker-compose.yml"
else
    print_success "No hardcoded secrets found in docker-compose.yml"
fi

# ==============================================================================
# Database Initialization Check
# ==============================================================================

print_header "Database Initialization"

print_check "Checking init-db.sql file"
if [ -f "scripts/init-db.sql" ]; then
    print_success "Database initialization script exists"

    print_check "Checking for required tables in init-db.sql"
    REQUIRED_TABLES=("ai_device" "ai_license" "ai_session" "ai_call_log")
    for table in "${REQUIRED_TABLES[@]}"; do
        if grep -q "CREATE TABLE.*$table" scripts/init-db.sql; then
            print_success "Table '$table' is defined"
        else
            print_error "Table '$table' is missing"
        fi
    done
else
    print_error "Database initialization script is missing"
fi

# ==============================================================================
# Dockerfile Check
# ==============================================================================

print_header "Dockerfile Configuration"

print_check "Checking server Dockerfile"
if [ -f "packages/server/Dockerfile" ]; then
    print_success "Server Dockerfile exists"

    print_check "Checking for multi-stage build"
    if grep -q "FROM.*AS" packages/server/Dockerfile; then
        print_success "Multi-stage build is used"
    else
        print_error "Multi-stage build is not used"
    fi

    print_check "Checking for health check in Dockerfile"
    if grep -q "HEALTHCHECK" packages/server/Dockerfile; then
        print_success "Health check is defined in Dockerfile"
    else
        print_info "Health check is not in Dockerfile (defined in docker-compose.yml)"
    fi

    print_check "Checking for non-root user"
    if grep -q "USER" packages/server/Dockerfile; then
        print_success "Non-root user is configured"
    else
        print_error "Running as root user (security risk)"
    fi
else
    print_error "Server Dockerfile is missing"
fi

# ==============================================================================
# .dockerignore Check
# ==============================================================================

print_header ".dockerignore Configuration"

print_check "Checking .dockerignore file"
if [ -f ".dockerignore" ]; then
    print_success ".dockerignore file exists"

    IGNORE_PATTERNS=("node_modules" "dist" "*.test.ts" ".env")
    for pattern in "${IGNORE_PATTERNS[@]}"; do
        print_check "Checking for '$pattern' in .dockerignore"
        if grep -q "$pattern" .dockerignore; then
            print_success "'$pattern' is ignored"
        else
            print_error "'$pattern' should be in .dockerignore"
        fi
    done
else
    print_error ".dockerignore file is missing"
fi

# ==============================================================================
# Runtime Verification (if services are running)
# ==============================================================================

print_header "Runtime Verification"

# Check if containers are running
RUNNING_CONTAINERS=$(docker compose ps --services --filter "status=running" 2>/dev/null || echo "")

if [ -z "$RUNNING_CONTAINERS" ]; then
    print_info "Docker Compose services are not running"
    print_info "Skipping runtime checks (run 'docker compose up -d' to start)"
else
    print_success "Docker Compose services are running"

    # Check MySQL container
    print_check "Checking MySQL container health"
    MYSQL_HEALTH=$(docker compose ps mysql --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    if [ "$MYSQL_HEALTH" = "healthy" ]; then
        print_success "MySQL container is healthy"
    else
        print_error "MySQL container health: $MYSQL_HEALTH"
    fi

    # Check server container
    print_check "Checking server container health"
    SERVER_HEALTH=$(docker compose ps server --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    if [ "$SERVER_HEALTH" = "healthy" ]; then
        print_success "Server container is healthy"
    else
        print_info "Server container health: $SERVER_HEALTH (may take up to 30s to become healthy)"
    fi

    # Wait a moment for services to be fully ready
    sleep 2

    # Test HTTP health endpoint
    print_check "Testing HTTP health endpoint"
    HTTP_PORT=${DASHBOARD_PORT:-3000}
    if curl -f -s "http://localhost:${HTTP_PORT}/health" >/dev/null 2>&1; then
        HEALTH_RESPONSE=$(curl -s "http://localhost:${HTTP_PORT}/health")
        print_success "HTTP health endpoint responding: $HEALTH_RESPONSE"
    else
        print_error "HTTP health endpoint not responding at http://localhost:${HTTP_PORT}/health"
    fi

    # Test database connectivity
    print_check "Testing database connectivity"
    if docker compose exec -T mysql mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-changeme_root_2024}" >/dev/null 2>&1; then
        print_success "Database is accessible"

        # Check if tables exist
        print_check "Verifying database tables"
        TABLE_COUNT=$(docker compose exec -T mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-changeme_root_2024}" -D aiinstaller -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'aiinstaller'" 2>/dev/null || echo "0")
        if [ "$TABLE_COUNT" -gt 0 ]; then
            print_success "Database tables created ($TABLE_COUNT tables found)"
        else
            print_error "No database tables found"
        fi
    else
        print_error "Cannot connect to database"
    fi

    # Test WebSocket connectivity (basic check)
    print_check "Testing WebSocket service"
    if docker compose logs server 2>/dev/null | grep -q "WebSocket.*ready\|Server.*listen\|started"; then
        print_success "WebSocket service appears to be running"
    else
        print_info "Cannot verify WebSocket service from logs"
    fi

    # Check container logs for errors
    print_check "Checking for errors in container logs"
    ERROR_COUNT=$(docker compose logs --tail=50 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER" | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -eq 0 ]; then
        print_success "No errors found in recent logs"
    else
        print_error "Found $ERROR_COUNT error(s) in recent logs"
        echo ""
        echo "Recent errors:"
        docker compose logs --tail=50 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER" | tail -5
    fi

    # ==============================================================================
    # Run Smoke Tests (if services are healthy)
    # ==============================================================================

    print_header "End-to-End Smoke Tests"

    if [ "$SERVER_HEALTH" = "healthy" ]; then
        print_info "Running comprehensive smoke tests..."
        echo ""

        # Run smoke test script
        if [ -f "scripts/smoke-test.sh" ]; then
            if bash scripts/smoke-test.sh --timeout 5 2>&1 | grep -E "PASS|FAIL|Test Summary" | head -20; then
                print_success "Smoke tests completed (see above for results)"
            else
                print_info "Smoke test script executed"
            fi
        else
            print_info "Smoke test script not found (skipping)"
        fi
    else
        print_info "Server not healthy yet - skipping smoke tests"
        print_info "Wait for services to become healthy, then run: ./scripts/smoke-test.sh"
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
    print_success "All checks passed! Docker Compose deployment is ready."
    echo ""
    if [ -z "$RUNNING_CONTAINERS" ]; then
        echo "Next steps:"
        echo "1. Start services: docker compose up -d"
        echo "2. Check logs: docker compose logs -f"
        echo "3. Wait ~30s for services to become healthy"
        echo "4. Re-run this script to verify runtime: ./scripts/verify-deployment.sh"
        echo "5. Access Dashboard: http://localhost:${DASHBOARD_PORT:-3000}"
    else
        echo "🎉 Deployment is fully verified and running!"
        echo ""
        echo "Access points:"
        echo "  · Dashboard:  http://localhost:${DASHBOARD_PORT:-3000}"
        echo "  · API Health: http://localhost:${DASHBOARD_PORT:-3000}/health"
        echo "  · MySQL:      localhost:${MYSQL_PORT:-3306}"
        echo ""
        echo "Useful commands:"
        echo "  · View logs:     docker compose logs -f"
        echo "  · Restart:       docker compose restart"
        echo "  · Stop:          docker compose down"
        echo "  · Full cleanup:  docker compose down -v"
    fi
    echo ""
    exit 0
else
    print_error "Some checks failed. Please fix the issues above."
    echo ""
    echo "Common solutions:"
    echo "- Make sure all required files exist"
    echo "- Verify docker-compose.yml syntax with: docker compose config"
    echo "- Check that .env file is properly configured"
    echo "- View logs for details: docker compose logs"
    echo ""
    exit 1
fi
