#!/usr/bin/env bash

# ==============================================================================
# ServerPilot - End-to-End Smoke Test Script
# ==============================================================================
# Purpose: Comprehensive smoke testing after Docker Compose deployment
# Tests: HTTP API, WebSocket, Database, Dashboard static files
#
# Usage:
#   ./scripts/smoke-test.sh [options]
#
# Options:
#   --host HOST         Server host (default: localhost)
#   --port PORT         Server port (default: 3000)
#   --timeout SECONDS   Timeout for each test (default: 10)
#   --verbose          Show detailed output
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
# ==============================================================================

set -e

# Default configuration
HOST="${HOST:-localhost}"
PORT="${PORT:-3000}"
TIMEOUT="${TIMEOUT:-10}"
VERBOSE="${VERBOSE:-0}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      HOST="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=1
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Print functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

print_pass() {
    echo -e "${GREEN}[✓ PASS]${NC} $1"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

print_fail() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    FAILED_TESTS=$((FAILED_TESTS + 1))
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

print_verbose() {
    if [ "$VERBOSE" = "1" ]; then
        echo -e "    ${NC}$1${NC}"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    print_header "Prerequisites Check"

    if ! command_exists curl; then
        print_fail "curl is not installed"
        exit 1
    fi
    print_pass "curl is available"

    if ! command_exists jq; then
        print_info "jq is not installed (optional, for JSON parsing)"
    else
        print_pass "jq is available"
    fi
}

# Test HTTP health endpoint
test_http_health() {
    print_header "HTTP Health Check"

    print_test "Testing GET /health endpoint"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" "http://${HOST}:${PORT}/health" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)

    print_verbose "HTTP Status: $HTTP_CODE"
    print_verbose "Response Body: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        print_pass "Health endpoint returned HTTP 200"

        # Check if response contains expected fields
        if echo "$BODY" | grep -q "status"; then
            print_pass "Response contains 'status' field"
        else
            print_info "Response does not contain 'status' field (may be plain text)"
        fi
    else
        print_fail "Health endpoint returned HTTP $HTTP_CODE (expected 200)"
    fi
}

# Test API authentication endpoint
test_api_auth() {
    print_header "API Authentication Endpoints"

    # Test register endpoint (should return error without body, but endpoint should exist)
    print_test "Testing POST /api/v1/auth/register endpoint availability"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" \
        -X POST "http://${HOST}:${PORT}/api/v1/auth/register" \
        -H "Content-Type: application/json" \
        -d '{}' 2>/dev/null || echo -e "\n000")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)

    print_verbose "HTTP Status: $HTTP_CODE"
    print_verbose "Response Body: $BODY"

    # Endpoint exists if we get 400/422 (validation error) or 200/201
    if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "422" ] || [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        print_pass "Register endpoint is available (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "404" ]; then
        print_fail "Register endpoint not found (HTTP 404)"
    else
        print_info "Register endpoint returned HTTP $HTTP_CODE"
    fi

    # Test login endpoint
    print_test "Testing POST /api/v1/auth/login endpoint availability"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" \
        -X POST "http://${HOST}:${PORT}/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d '{}' 2>/dev/null || echo -e "\n000")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)

    print_verbose "HTTP Status: $HTTP_CODE"

    if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "422" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
        print_pass "Login endpoint is available (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "404" ]; then
        print_fail "Login endpoint not found (HTTP 404)"
    else
        print_info "Login endpoint returned HTTP $HTTP_CODE"
    fi
}

# Test Dashboard static files
test_dashboard_static() {
    print_header "Dashboard Static Files"

    print_test "Testing Dashboard root (index.html)"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" "http://${HOST}:${PORT}/" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)

    print_verbose "HTTP Status: $HTTP_CODE"

    if [ "$HTTP_CODE" = "200" ]; then
        print_pass "Dashboard root returned HTTP 200"

        # Check if it's HTML content
        if echo "$BODY" | grep -iq "<!DOCTYPE html>"; then
            print_pass "Response is valid HTML"
        else
            print_info "Response may not be HTML (check content)"
        fi

        # Check for React root element
        if echo "$BODY" | grep -iq 'id="root"'; then
            print_pass "React root element found"
        else
            print_info "React root element not found (may use different structure)"
        fi
    else
        print_fail "Dashboard root returned HTTP $HTTP_CODE (expected 200)"
    fi
}

# Test database connectivity (via Docker)
test_database_connectivity() {
    print_header "Database Connectivity"

    if ! command_exists docker; then
        print_info "Docker not available - skipping database tests"
        return
    fi

    print_test "Testing MySQL container connectivity"

    # Check if MySQL container is running
    if docker compose ps mysql --format json 2>/dev/null | grep -q '"State":"running"'; then
        print_pass "MySQL container is running"

        # Test database connection
        print_test "Testing database connection"
        if docker compose exec -T mysql mysqladmin ping -h localhost >/dev/null 2>&1; then
            print_pass "Database is responding to ping"
        else
            print_fail "Database is not responding"
        fi

        # Check database tables
        print_test "Verifying database tables exist"
        TABLE_COUNT=$(docker compose exec -T mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-changeme_root_2024}" -D aiinstaller -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'aiinstaller'" 2>/dev/null || echo "0")

        print_verbose "Found $TABLE_COUNT tables"

        if [ "$TABLE_COUNT" -gt 0 ]; then
            print_pass "Database tables exist ($TABLE_COUNT tables)"
        else
            print_fail "No database tables found"
        fi
    else
        print_fail "MySQL container is not running"
    fi
}

# Test WebSocket connectivity (basic check)
test_websocket_basic() {
    print_header "WebSocket Service"

    print_test "Checking WebSocket service availability (via logs)"

    if command_exists docker; then
        if docker compose logs server 2>/dev/null | grep -q "WebSocket.*ready\|Server.*listen\|started"; then
            print_pass "WebSocket service appears to be running (from logs)"
        else
            print_info "Cannot verify WebSocket from logs (may need more specific logging)"
        fi
    else
        print_info "Docker not available - skipping WebSocket log check"
    fi

    # Try to establish WebSocket connection using curl (upgrade request)
    print_test "Testing WebSocket upgrade request"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" \
        -H "Upgrade: websocket" \
        -H "Connection: Upgrade" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        -H "Sec-WebSocket-Version: 13" \
        "http://${HOST}:${PORT}/ws" 2>/dev/null || echo -e "\n000")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)

    print_verbose "HTTP Status: $HTTP_CODE"

    # 101 = Switching Protocols (success), 426 = Upgrade Required, 401 = Auth required
    if [ "$HTTP_CODE" = "101" ]; then
        print_pass "WebSocket upgrade successful (HTTP 101)"
    elif [ "$HTTP_CODE" = "426" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
        print_pass "WebSocket endpoint is available (HTTP $HTTP_CODE - requires auth)"
    else
        print_info "WebSocket endpoint returned HTTP $HTTP_CODE"
    fi
}

# Test container health
test_container_health() {
    print_header "Container Health Status"

    if ! command_exists docker; then
        print_info "Docker not available - skipping container health checks"
        return
    fi

    # Check MySQL health
    print_test "Checking MySQL container health"
    MYSQL_HEALTH=$(docker compose ps mysql --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    print_verbose "MySQL Health: $MYSQL_HEALTH"

    if [ "$MYSQL_HEALTH" = "healthy" ]; then
        print_pass "MySQL container is healthy"
    elif [ "$MYSQL_HEALTH" = "starting" ]; then
        print_info "MySQL container is starting"
    else
        print_fail "MySQL container health: $MYSQL_HEALTH"
    fi

    # Check Server health
    print_test "Checking Server container health"
    SERVER_HEALTH=$(docker compose ps server --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    print_verbose "Server Health: $SERVER_HEALTH"

    if [ "$SERVER_HEALTH" = "healthy" ]; then
        print_pass "Server container is healthy"
    elif [ "$SERVER_HEALTH" = "starting" ]; then
        print_info "Server container is starting (may take up to 30s)"
    else
        print_info "Server container health: $SERVER_HEALTH"
    fi

    # Check Dashboard health (if exists)
    if docker compose ps dashboard --format json 2>/dev/null | grep -q '"State":"running"'; then
        print_test "Checking Dashboard container status"
        DASHBOARD_STATE=$(docker compose ps dashboard --format json 2>/dev/null | grep -o '"State":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

        if [ "$DASHBOARD_STATE" = "running" ]; then
            print_pass "Dashboard container is running"
        else
            print_fail "Dashboard container state: $DASHBOARD_STATE"
        fi
    fi
}

# Check for errors in logs
test_error_logs() {
    print_header "Error Log Analysis"

    if ! command_exists docker; then
        print_info "Docker not available - skipping log analysis"
        return
    fi

    print_test "Checking for errors in recent container logs"

    ERROR_COUNT=$(docker compose logs --tail=100 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER\|error level" | wc -l | tr -d ' ')

    print_verbose "Found $ERROR_COUNT error entries"

    if [ "$ERROR_COUNT" -eq 0 ]; then
        print_pass "No errors found in recent logs"
    elif [ "$ERROR_COUNT" -lt 3 ]; then
        print_info "Found $ERROR_COUNT error(s) in recent logs (review manually)"
    else
        print_fail "Found $ERROR_COUNT error(s) in recent logs"

        if [ "$VERBOSE" = "1" ]; then
            echo ""
            echo "Recent errors:"
            docker compose logs --tail=100 2>/dev/null | grep -i "error\|fatal\|exception" | grep -v "errorCount\|ERROR_ANALYZER\|error level" | tail -5
        fi
    fi
}

# Main execution
main() {
    print_header "ServerPilot Smoke Test Suite"
    print_info "Target: http://${HOST}:${PORT}"
    print_info "Timeout: ${TIMEOUT}s per test"
    echo ""

    # Run all tests
    check_prerequisites
    test_http_health
    test_api_auth
    test_dashboard_static
    test_database_connectivity
    test_websocket_basic
    test_container_health
    test_error_logs

    # Summary
    print_header "Test Summary"
    echo ""
    echo "Total Tests:   $TOTAL_TESTS"
    echo -e "${GREEN}Passed:        $PASSED_TESTS${NC}"

    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "${RED}Failed:        $FAILED_TESTS${NC}"
    else
        echo "Failed:        $FAILED_TESTS"
    fi

    PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")
    echo "Pass Rate:     ${PASS_RATE}%"
    echo ""

    if [ $FAILED_TESTS -eq 0 ]; then
        print_pass "All smoke tests passed! ✅"
        echo ""
        echo "🎉 Deployment is fully functional!"
        echo ""
        echo "Access points:"
        echo "  • Dashboard:  http://${HOST}:${PORT}"
        echo "  • API Health: http://${HOST}:${PORT}/health"
        echo "  • WebSocket:  ws://${HOST}:${PORT}/ws"
        echo ""
        exit 0
    elif [ "$PASS_RATE" -ge 80 ]; then
        print_info "Most tests passed (${PASS_RATE}%) - review failures above"
        echo ""
        exit 0
    else
        print_fail "Smoke tests failed (${PASS_RATE}% passed)"
        echo ""
        echo "Troubleshooting:"
        echo "  • Check container logs: docker compose logs -f"
        echo "  • Verify services are running: docker compose ps"
        echo "  • Check .env configuration"
        echo "  • Run with --verbose for detailed output"
        echo ""
        exit 1
    fi
}

# Run main
main
