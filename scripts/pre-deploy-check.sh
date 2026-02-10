#!/usr/bin/env bash

# ==============================================================================
# ServerPilot - Pre-Deployment Configuration Check
# ==============================================================================
# Purpose: Verify deployment configuration BEFORE Docker installation
# This script checks that all configuration files are present and valid
# without requiring Docker to be installed.
#
# Usage:
#   ./scripts/pre-deploy-check.sh
#
# Exit codes:
#   0 - All checks passed, ready for deployment
#   1 - One or more checks failed
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_COUNT=0

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

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
    WARNING_COUNT=$((WARNING_COUNT + 1))
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ==============================================================================
# 1. File Structure Check
# ==============================================================================

print_header "File Structure Check"

REQUIRED_FILES=(
    "docker-compose.yml"
    ".env.example"
    ".env"
    ".dockerignore"
    "packages/server/Dockerfile"
    "packages/dashboard/Dockerfile"
    "packages/dashboard/nginx.conf"
    "scripts/init-db.sql"
    "scripts/verify-deployment.sh"
    "scripts/smoke-test.sh"
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
# 2. Environment Variables Check
# ==============================================================================

print_header "Environment Variables Check"

print_check "Checking .env file"
if [ ! -f ".env" ]; then
    print_error ".env file not found"
    print_info "Run: cp .env.example .env"
    exit 1
fi

# Load .env file
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

# Check required environment variables
REQUIRED_ENV_VARS=(
    "JWT_SECRET"
    "DB_HOST"
    "DB_PORT"
    "DB_NAME"
    "DB_USER"
    "DB_PASSWORD"
    "MYSQL_ROOT_PASSWORD"
    "MYSQL_DATABASE"
    "MYSQL_USER"
    "MYSQL_PASSWORD"
    "SERVER_PORT"
    "DASHBOARD_PORT"
)

for var in "${REQUIRED_ENV_VARS[@]}"; do
    print_check "Checking environment variable: $var"
    value="${!var}"
    if [ -z "$value" ]; then
        print_error "$var is not set or empty"
    else
        # Mask sensitive values in output
        if [[ "$var" == *"PASSWORD"* ]] || [[ "$var" == *"SECRET"* ]] || [[ "$var" == *"KEY"* ]]; then
            print_success "$var is set (value hidden)"
        else
            print_success "$var = $value"
        fi
    fi
done

# ==============================================================================
# 3. JWT Secret Validation
# ==============================================================================

print_header "Security Configuration Check"

print_check "Validating JWT_SECRET strength"
if [ -z "$JWT_SECRET" ]; then
    print_error "JWT_SECRET is not set"
elif [ ${#JWT_SECRET} -lt 32 ]; then
    print_error "JWT_SECRET is too short (minimum 32 characters required)"
elif [ "$JWT_SECRET" = "change_me_to_a_random_string_at_least_32_chars" ]; then
    print_error "JWT_SECRET is still using the default value - MUST change in production!"
else
    print_success "JWT_SECRET is properly configured (${#JWT_SECRET} characters)"
fi

# ==============================================================================
# 4. Password Security Check
# ==============================================================================

print_check "Checking database passwords"
if [ "$MYSQL_ROOT_PASSWORD" = "changeme_root_2024" ]; then
    print_warning "MYSQL_ROOT_PASSWORD is using default value (OK for dev, change for production)"
else
    print_success "MYSQL_ROOT_PASSWORD has been customized"
fi

if [ "$DB_PASSWORD" = "changeme_db_2024" ] || [ "$MYSQL_PASSWORD" = "changeme_db_2024" ]; then
    print_warning "Database passwords are using default values (OK for dev, change for production)"
else
    print_success "Database passwords have been customized"
fi

# ==============================================================================
# 5. Port Configuration Check
# ==============================================================================

print_header "Port Configuration Check"

print_check "Checking port configuration"
SERVER_PORT="${SERVER_PORT:-3000}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

print_success "Server port: $SERVER_PORT"
print_success "Dashboard port: $DASHBOARD_PORT"
print_success "MySQL port: $MYSQL_PORT"

if [ "$DASHBOARD_PORT" != "$SERVER_PORT" ]; then
    print_warning "Dashboard and Server are on different ports (Dashboard: $DASHBOARD_PORT, Server: $SERVER_PORT)"
    print_info "This is unusual - typically Dashboard reverse-proxies to Server"
fi

# ==============================================================================
# 6. Docker Compose Configuration Validation
# ==============================================================================

print_header "Docker Compose Configuration"

print_check "Validating docker-compose.yml syntax"
if grep -q "version:" docker-compose.yml 2>/dev/null; then
    print_warning "docker-compose.yml contains deprecated 'version:' field (not needed in Compose V2)"
fi

print_check "Checking for required services in docker-compose.yml"
REQUIRED_SERVICES=("mysql" "server" "dashboard")
for service in "${REQUIRED_SERVICES[@]}"; do
    if grep -q "^  $service:" docker-compose.yml; then
        print_success "Service '$service' is defined"
    else
        print_error "Service '$service' is missing"
    fi
done

print_check "Checking for health checks"
if grep -q "healthcheck:" docker-compose.yml; then
    print_success "Health checks are configured"
else
    print_warning "No health checks found in docker-compose.yml"
fi

print_check "Checking for restart policies"
if grep -q "restart:" docker-compose.yml; then
    print_success "Restart policies are configured"
else
    print_warning "No restart policies found"
fi

print_check "Checking for volume persistence"
if grep -q "volumes:" docker-compose.yml; then
    print_success "Data volumes are configured"
else
    print_error "No volumes found - data will be lost on container restart!"
fi

# ==============================================================================
# 7. Database Initialization Script Check
# ==============================================================================

print_header "Database Initialization Check"

print_check "Checking init-db.sql"
if [ ! -f "scripts/init-db.sql" ]; then
    print_error "scripts/init-db.sql not found"
else
    print_success "Database initialization script exists"

    # Check for required tables
    print_check "Checking for required table definitions"
    REQUIRED_TABLES=("ai_device" "ai_license" "ai_session" "ai_call_log")
    for table in "${REQUIRED_TABLES[@]}"; do
        if grep -q "CREATE TABLE.*$table" scripts/init-db.sql; then
            print_success "Table '$table' is defined in init-db.sql"
        else
            print_error "Table '$table' is missing from init-db.sql"
        fi
    done
fi

# ==============================================================================
# 8. Dockerfile Validation
# ==============================================================================

print_header "Dockerfile Configuration"

# Check Server Dockerfile
print_check "Validating packages/server/Dockerfile"
if [ -f "packages/server/Dockerfile" ]; then
    if grep -q "FROM.*AS" packages/server/Dockerfile; then
        print_success "Server Dockerfile uses multi-stage build"
    else
        print_warning "Server Dockerfile may not use multi-stage build"
    fi

    if grep -q "USER" packages/server/Dockerfile; then
        print_success "Server Dockerfile runs as non-root user"
    else
        print_error "Server Dockerfile runs as root (security risk)"
    fi

    if grep -q "HEALTHCHECK" packages/server/Dockerfile; then
        print_success "Server Dockerfile has health check"
    else
        print_info "Server health check defined in docker-compose.yml"
    fi
else
    print_error "packages/server/Dockerfile not found"
fi

# Check Dashboard Dockerfile
print_check "Validating packages/dashboard/Dockerfile"
if [ -f "packages/dashboard/Dockerfile" ]; then
    if grep -q "FROM.*AS" packages/dashboard/Dockerfile; then
        print_success "Dashboard Dockerfile uses multi-stage build"
    else
        print_warning "Dashboard Dockerfile may not use multi-stage build"
    fi

    if grep -q "nginx" packages/dashboard/Dockerfile; then
        print_success "Dashboard uses Nginx for serving"
    else
        print_warning "Dashboard may not use Nginx"
    fi
else
    print_error "packages/dashboard/Dockerfile not found"
fi

# ==============================================================================
# 9. AI Configuration Check
# ==============================================================================

print_header "AI Configuration (Optional)"

print_check "Checking AI Provider configuration"
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "your_anthropic_api_key_here" ]; then
    print_warning "ANTHROPIC_API_KEY is not configured (AI features will be disabled)"
    print_info "Get API key from: https://console.anthropic.com/settings/keys"
else
    print_success "ANTHROPIC_API_KEY is configured"
fi

AI_MODEL="${AI_MODEL:-claude-sonnet-4-20250514}"
print_success "AI Model: $AI_MODEL"

# ==============================================================================
# 10. Nginx Configuration Check
# ==============================================================================

print_header "Nginx Configuration Check"

print_check "Checking packages/dashboard/nginx.conf"
if [ -f "packages/dashboard/nginx.conf" ]; then
    print_success "Nginx configuration file exists"

    # Check for API proxy
    if grep -q "location /api/" packages/dashboard/nginx.conf; then
        print_success "API reverse proxy is configured"
    else
        print_error "API reverse proxy is missing"
    fi

    # Check for WebSocket proxy
    if grep -q "location /ws" packages/dashboard/nginx.conf; then
        print_success "WebSocket reverse proxy is configured"
    else
        print_error "WebSocket reverse proxy is missing"
    fi

    # Check for SPA fallback
    if grep -q "try_files.*index.html" packages/dashboard/nginx.conf; then
        print_success "SPA fallback route is configured"
    else
        print_warning "SPA fallback may not be configured"
    fi
else
    print_error "packages/dashboard/nginx.conf not found"
fi

# ==============================================================================
# 11. .dockerignore Check
# ==============================================================================

print_header ".dockerignore Configuration"

print_check "Checking .dockerignore"
if [ -f ".dockerignore" ]; then
    print_success ".dockerignore exists"

    IGNORE_PATTERNS=("node_modules" "dist" "*.test.ts" ".env")
    for pattern in "${IGNORE_PATTERNS[@]}"; do
        if grep -q "$pattern" .dockerignore; then
            print_success "'$pattern' is in .dockerignore"
        else
            print_warning "'$pattern' should be in .dockerignore"
        fi
    done
else
    print_error ".dockerignore is missing"
fi

# ==============================================================================
# Summary
# ==============================================================================

print_header "Pre-Deployment Check Summary"

echo ""
echo "Total Checks:  $TOTAL_CHECKS"
echo -e "${GREEN}Passed:        $PASSED_CHECKS${NC}"

if [ $FAILED_CHECKS -gt 0 ]; then
    echo -e "${RED}Failed:        $FAILED_CHECKS${NC}"
else
    echo "Failed:        $FAILED_CHECKS"
fi

if [ $WARNING_COUNT -gt 0 ]; then
    echo -e "${YELLOW}Warnings:      $WARNING_COUNT${NC}"
else
    echo "Warnings:      $WARNING_COUNT"
fi

echo ""

if [ $FAILED_CHECKS -eq 0 ]; then
    print_success "✅ All critical checks passed!"
    echo ""

    if [ $WARNING_COUNT -gt 0 ]; then
        print_info "You have $WARNING_COUNT warning(s). Review above for details."
        print_info "Warnings are OK for development, but should be addressed for production."
        echo ""
    fi

    print_success "Configuration is ready for deployment!"
    echo ""
    echo "Next steps:"
    echo "  1. Install Docker Desktop from: https://docs.docker.com/get-docker/"
    echo "  2. Start Docker"
    echo "  3. Run: docker compose up -d"
    echo "  4. Run: ./scripts/verify-deployment.sh"
    echo "  5. Run: ./scripts/smoke-test.sh"
    echo "  6. Open browser: http://localhost:${DASHBOARD_PORT}"
    echo ""
    exit 0
else
    print_error "❌ Some checks failed. Please fix the issues above."
    echo ""
    echo "Common fixes:"
    echo "  • Missing .env: cp .env.example .env"
    echo "  • Weak JWT_SECRET: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    echo "  • Missing files: Check git status and restore missing files"
    echo ""
    exit 1
fi
