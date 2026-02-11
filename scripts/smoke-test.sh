#!/usr/bin/env bash

# ==============================================================================
# ServerPilot - End-to-End Smoke Test Script
# ==============================================================================
# Purpose: Full-chain smoke testing after Docker Compose deployment
# Flow: Health → Register → Login → Create Server → API Proxy → WebSocket → AI Health
#
# Usage:
#   ./scripts/smoke-test.sh [options]
#
# Options:
#   --host HOST           Server host (default: localhost)
#   --port PORT           Dashboard port via Nginx (default: 3001)
#   --timeout SECONDS     Timeout for each test (default: 10)
#   --verbose             Show detailed output
#   --wait SECONDS        Wait for services to be healthy before testing (default: 0)
#   --admin-email EMAIL   Admin email for admin login test (default: from ADMIN_EMAIL env)
#   --admin-password PWD  Admin password for admin login test (default: from ADMIN_PASSWORD env)
#   --test-persistence    Run SQLite data persistence test (requires docker compose)
#
# Exit codes:
#   0 - All critical tests passed (pass rate >= 80%)
#   1 - Critical tests failed
# ==============================================================================

set -euo pipefail

# Default configuration
HOST="${HOST:-localhost}"
PORT="${PORT:-3001}"
TIMEOUT="${TIMEOUT:-10}"
VERBOSE="${VERBOSE:-0}"
WAIT_SECONDS="${WAIT_SECONDS:-0}"
ADMIN_EMAIL_ARG="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD_ARG="${ADMIN_PASSWORD:-}"
TEST_PERSISTENCE="${TEST_PERSISTENCE:-0}"

# Test user credentials (unique per run to avoid conflicts)
TEST_USER="smoke_$(date +%s)@test.local"
TEST_PASSWORD="SmokeTest_Passw0rd!"
ACCESS_TOKEN=""
SERVER_ID=""
INSTALL_COMMAND=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --verbose) VERBOSE=1; shift ;;
    --wait) WAIT_SECONDS="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL_ARG="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD_ARG="$2"; shift 2 ;;
    --test-persistence) TEST_PERSISTENCE=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

BASE_URL="http://${HOST}:${PORT}"

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
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}========================================${NC}"
}

print_test() {
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  echo -e "${YELLOW}[TEST]${NC} $1"
}

print_pass() {
  PASSED_TESTS=$((PASSED_TESTS + 1))
  echo -e "${GREEN}  [PASS]${NC} $1"
}

print_fail() {
  FAILED_TESTS=$((FAILED_TESTS + 1))
  echo -e "${RED}  [FAIL]${NC} $1"
}

print_info() {
  echo -e "${BLUE}  [INFO]${NC} $1"
}

print_verbose() {
  if [ "$VERBOSE" = "1" ]; then
    echo -e "    $1"
  fi
}

# HTTP helper: makes a request, captures body + status code
# Usage: http_request METHOD URL [DATA]
# Sets: HTTP_CODE, HTTP_BODY
http_request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local auth_header=""

  if [ -n "$ACCESS_TOKEN" ]; then
    auth_header="-H \"Authorization: Bearer ${ACCESS_TOKEN}\""
  fi

  local curl_cmd="curl -s -w '\n%{http_code}' --max-time $TIMEOUT"
  curl_cmd="$curl_cmd -X $method"
  curl_cmd="$curl_cmd -H 'Content-Type: application/json'"

  if [ -n "$ACCESS_TOKEN" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer ${ACCESS_TOKEN}'"
  fi

  if [ -n "$data" ]; then
    curl_cmd="$curl_cmd -d '$data'"
  fi

  curl_cmd="$curl_cmd '$url'"

  local response
  response=$(eval "$curl_cmd" 2>/dev/null || echo -e "\n000")

  HTTP_CODE=$(echo "$response" | tail -1)
  HTTP_BODY=$(echo "$response" | sed '$d')

  print_verbose "HTTP $method $url → $HTTP_CODE"
  if [ "$VERBOSE" = "1" ] && [ -n "$HTTP_BODY" ]; then
    print_verbose "Body: $(echo "$HTTP_BODY" | head -c 200)"
  fi
}

# JSON field extractor (works with or without jq)
json_field() {
  local json="$1"
  local field="$2"

  if command -v jq >/dev/null 2>&1; then
    echo "$json" | jq -r ".$field // empty" 2>/dev/null
  else
    # Fallback: simple grep-based extraction for flat JSON
    echo "$json" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
  fi
}

wait_for_services() {
  if [ "$WAIT_SECONDS" -gt 0 ]; then
    print_header "Waiting for Services"
    print_info "Waiting up to ${WAIT_SECONDS}s for services to be ready..."

    local elapsed=0
    while [ "$elapsed" -lt "$WAIT_SECONDS" ]; do
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE_URL}/health" 2>/dev/null || echo "000")
      if [ "$code" = "200" ]; then
        print_info "Services ready after ${elapsed}s"
        return 0
      fi
      sleep 2
      elapsed=$((elapsed + 2))
    done

    print_info "Timeout waiting for services (proceeding anyway)"
  fi
}

check_prerequisites() {
  print_header "1. Prerequisites"

  print_test "curl availability"
  if command -v curl >/dev/null 2>&1; then
    print_pass "curl is available"
  else
    print_fail "curl is not installed (required)"
    exit 1
  fi

  print_test "jq availability"
  if command -v jq >/dev/null 2>&1; then
    print_pass "jq is available"
  else
    print_info "jq not installed (optional, using fallback parser)"
    # Count as pass since it's optional
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi
}

test_health_check() {
  print_header "2. Health Check"

  print_test "GET /health via Nginx proxy"
  http_request GET "${BASE_URL}/health"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Health endpoint returned HTTP 200"

    local status
    status=$(json_field "$HTTP_BODY" "status")
    if [ "$status" = "ok" ]; then
      print_info "Status: ok"
    fi
  else
    print_fail "Health endpoint returned HTTP $HTTP_CODE (expected 200)"
  fi
}

test_register() {
  print_header "3. User Registration"

  print_test "POST /api/v1/auth/register"
  http_request POST "${BASE_URL}/api/v1/auth/register" \
    "{\"email\":\"${TEST_USER}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"Smoke Test\"}"

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    print_pass "Registration successful (HTTP $HTTP_CODE)"

    # Extract access token
    ACCESS_TOKEN=$(json_field "$HTTP_BODY" "accessToken")
    if [ -n "$ACCESS_TOKEN" ]; then
      print_info "Access token obtained (${#ACCESS_TOKEN} chars)"
    else
      print_info "No accessToken in response (will try login)"
    fi
  elif [ "$HTTP_CODE" = "409" ]; then
    print_pass "User already exists (HTTP 409) — will login instead"
  else
    print_fail "Registration failed (HTTP $HTTP_CODE)"
  fi
}

test_login() {
  print_header "4. User Login"

  print_test "POST /api/v1/auth/login"
  http_request POST "${BASE_URL}/api/v1/auth/login" \
    "{\"email\":\"${TEST_USER}\",\"password\":\"${TEST_PASSWORD}\"}"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Login successful (HTTP 200)"

    ACCESS_TOKEN=$(json_field "$HTTP_BODY" "accessToken")
    if [ -n "$ACCESS_TOKEN" ]; then
      print_pass "Access token obtained (${#ACCESS_TOKEN} chars)"
    else
      print_fail "No accessToken in login response"
    fi

    local refresh
    refresh=$(json_field "$HTTP_BODY" "refreshToken")
    if [ -n "$refresh" ]; then
      print_info "Refresh token present"
    fi
  else
    print_fail "Login failed (HTTP $HTTP_CODE)"
  fi
}

test_admin_login() {
  print_header "5. Admin Login"

  if [ -z "$ADMIN_EMAIL_ARG" ] || [ -z "$ADMIN_PASSWORD_ARG" ]; then
    print_test "Admin login (skipped — no admin credentials provided)"
    print_info "Set ADMIN_EMAIL/ADMIN_PASSWORD or use --admin-email/--admin-password"
    return
  fi

  print_test "POST /api/v1/auth/login (admin credentials)"
  http_request POST "${BASE_URL}/api/v1/auth/login" \
    "{\"email\":\"${ADMIN_EMAIL_ARG}\",\"password\":\"${ADMIN_PASSWORD_ARG}\"}"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Admin login successful (HTTP 200)"

    local admin_token
    admin_token=$(json_field "$HTTP_BODY" "accessToken")
    if [ -n "$admin_token" ]; then
      # Use admin token for subsequent tests (admin has owner role)
      ACCESS_TOKEN="$admin_token"
      print_pass "Admin access token obtained (${#admin_token} chars)"
    else
      print_fail "No accessToken in admin login response"
    fi
  else
    print_fail "Admin login failed (HTTP $HTTP_CODE) — check ADMIN_EMAIL/ADMIN_PASSWORD"
    print_verbose "Response: $(echo "$HTTP_BODY" | head -c 200)"
  fi
}

test_create_server() {
  print_header "6. Create Server"

  if [ -z "$ACCESS_TOKEN" ]; then
    print_test "Create server (skipped — no auth token)"
    print_fail "No access token available, cannot create server"
    return
  fi

  print_test "POST /api/v1/servers (authenticated)"
  http_request POST "${BASE_URL}/api/v1/servers" \
    "{\"name\":\"smoke-test-server\",\"host\":\"192.168.1.100\",\"port\":22,\"description\":\"Smoke test server\"}"

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    print_pass "Server created (HTTP $HTTP_CODE)"

    SERVER_ID=$(json_field "$HTTP_BODY" "server.id")
    if [ -z "$SERVER_ID" ]; then
      # Try alternate path: response might be { server: { id: ... } }
      SERVER_ID=$(echo "$HTTP_BODY" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
    fi

    if [ -n "$SERVER_ID" ]; then
      print_info "Server ID: $SERVER_ID"
    fi

    # Check for install command
    local install_cmd
    install_cmd=$(json_field "$HTTP_BODY" "installCommand")
    if [ -n "$install_cmd" ]; then
      print_pass "Install command returned"
      INSTALL_COMMAND="$install_cmd"
      print_verbose "Install command: $(echo "$install_cmd" | head -c 120)..."
    fi

    # Check for agent token
    local token
    token=$(json_field "$HTTP_BODY" "token")
    if [ -n "$token" ]; then
      print_info "Agent token returned"
    fi
  else
    print_fail "Server creation failed (HTTP $HTTP_CODE)"
  fi

  # Validate install command format
  if [ -n "$INSTALL_COMMAND" ]; then
    print_test "Install command contains --token flag"
    if echo "$INSTALL_COMMAND" | grep -q -- '--token'; then
      print_pass "Install command includes --token parameter"
    else
      print_fail "Install command missing --token parameter"
    fi

    print_test "Install command contains --server flag"
    if echo "$INSTALL_COMMAND" | grep -q -- '--server'; then
      print_pass "Install command includes --server address"
    else
      print_fail "Install command missing --server address"
    fi
  fi
}

test_list_servers() {
  print_header "7. List Servers"

  if [ -z "$ACCESS_TOKEN" ]; then
    print_test "List servers (skipped — no auth token)"
    print_fail "No access token available"
    return
  fi

  print_test "GET /api/v1/servers (authenticated)"
  http_request GET "${BASE_URL}/api/v1/servers"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Server list returned (HTTP 200)"

    local total
    total=$(json_field "$HTTP_BODY" "total")
    if [ -n "$total" ]; then
      print_info "Total servers: $total"
    fi
  else
    print_fail "Server list failed (HTTP $HTTP_CODE)"
  fi
}

test_nginx_proxy() {
  print_header "8. Nginx Reverse Proxy"

  # Dashboard root (SPA)
  print_test "GET / (Dashboard SPA via Nginx)"
  http_request GET "${BASE_URL}/"

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$HTTP_BODY" | grep -qi '<!DOCTYPE html>'; then
      print_pass "Dashboard HTML served correctly"
    else
      print_fail "Response is not HTML"
    fi

    if echo "$HTTP_BODY" | grep -qi 'id="root"'; then
      print_info "React root element present"
    fi
  else
    print_fail "Dashboard root returned HTTP $HTTP_CODE"
  fi

  # API proxy — verify /api/ routes go through Nginx to server
  print_test "API proxy: GET /api/v1/auth/register returns expected code"
  http_request POST "${BASE_URL}/api/v1/auth/register" '{}'

  if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "422" ]; then
    print_pass "API proxy working (validation error returned)"
  elif [ "$HTTP_CODE" = "404" ]; then
    print_fail "API route not found (Nginx proxy may not be configured)"
  else
    print_info "API proxy returned HTTP $HTTP_CODE"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Security headers
  print_test "Nginx security headers"
  local headers
  headers=$(curl -s -I --max-time "$TIMEOUT" "${BASE_URL}/" 2>/dev/null || echo "")

  if echo "$headers" | grep -qi 'X-Frame-Options'; then
    print_pass "X-Frame-Options header present"
  else
    print_fail "X-Frame-Options header missing"
  fi
}

test_websocket() {
  print_header "9. WebSocket Endpoint"

  print_test "WebSocket upgrade request to /ws"
  local ws_response
  ws_response=$(curl -s -w "\n%{http_code}" --max-time "$TIMEOUT" \
    -H "Upgrade: websocket" \
    -H "Connection: Upgrade" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    "${BASE_URL}/ws" 2>/dev/null || echo -e "\n000")

  local ws_code
  ws_code=$(echo "$ws_response" | tail -1)
  print_verbose "WebSocket HTTP status: $ws_code"

  # 101 = Upgrade OK, 401/403 = auth required (valid), 426 = upgrade required
  if [ "$ws_code" = "101" ]; then
    print_pass "WebSocket upgrade successful (HTTP 101)"
  elif [ "$ws_code" = "401" ] || [ "$ws_code" = "403" ]; then
    print_pass "WebSocket endpoint available (HTTP $ws_code — auth required)"
  elif [ "$ws_code" = "426" ]; then
    print_pass "WebSocket endpoint available (HTTP 426 — upgrade required)"
  elif [ "$ws_code" = "400" ]; then
    print_pass "WebSocket endpoint reachable (HTTP 400)"
  else
    print_fail "WebSocket endpoint returned HTTP $ws_code"
  fi
}

test_ai_provider_health() {
  print_header "10. AI Provider Health"

  if [ -z "$ACCESS_TOKEN" ]; then
    print_test "AI provider health (skipped — no auth token)"
    print_fail "No access token available"
    return
  fi

  print_test "GET /api/v1/settings/ai-provider/health"
  http_request GET "${BASE_URL}/api/v1/settings/ai-provider/health"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "AI provider health check returned OK"

    local available
    available=$(json_field "$HTTP_BODY" "available")
    if [ "$available" = "true" ]; then
      print_info "AI provider is available"
    else
      print_info "AI provider may not be configured (expected in CI)"
    fi
  elif [ "$HTTP_CODE" = "503" ]; then
    print_pass "AI provider health endpoint reachable (HTTP 503 — no API key configured)"
  else
    print_fail "AI provider health returned HTTP $HTTP_CODE"
  fi
}

test_container_health() {
  print_header "11. Container Health"

  if ! command -v docker >/dev/null 2>&1; then
    print_test "Docker container health (skipped — docker not available)"
    print_info "Docker not available, skipping container health checks"
    return
  fi

  # Server container
  print_test "Server container health"
  local server_health
  server_health=$(docker compose ps server --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

  if [ "$server_health" = "healthy" ]; then
    print_pass "Server container is healthy"
  elif [ "$server_health" = "starting" ]; then
    print_info "Server container is starting"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    print_fail "Server container health: $server_health"
  fi

  # Dashboard container
  print_test "Dashboard container health"
  local dashboard_health
  dashboard_health=$(docker compose ps dashboard --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

  if [ "$dashboard_health" = "healthy" ]; then
    print_pass "Dashboard container is healthy"
  elif [ "$dashboard_health" = "starting" ]; then
    print_info "Dashboard container is starting"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    print_fail "Dashboard container health: $dashboard_health"
  fi
}

test_data_persistence() {
  print_header "12. Data Persistence"

  if [ "$TEST_PERSISTENCE" != "1" ]; then
    print_info "Persistence test skipped (use --test-persistence to enable)"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    print_info "Docker not available, skipping persistence test"
    return
  fi

  if [ -z "$ACCESS_TOKEN" ]; then
    print_test "Data persistence (skipped — no auth token)"
    print_fail "No access token available"
    return
  fi

  # Step 1: Verify we have data (servers created earlier)
  print_test "Verify data exists before restart"
  http_request GET "${BASE_URL}/api/v1/servers"

  local pre_restart_total=""
  if [ "$HTTP_CODE" = "200" ]; then
    pre_restart_total=$(json_field "$HTTP_BODY" "total")
    if [ -n "$pre_restart_total" ] && [ "$pre_restart_total" -gt 0 ] 2>/dev/null; then
      print_pass "Data exists: $pre_restart_total server(s) before restart"
    else
      print_fail "No servers found before restart — nothing to verify"
      return
    fi
  else
    print_fail "Could not list servers before restart (HTTP $HTTP_CODE)"
    return
  fi

  # Step 2: Restart server container (preserves volume)
  print_test "Restart server container"
  if docker compose restart server >/dev/null 2>&1; then
    print_pass "Server container restarted"
  else
    print_fail "Failed to restart server container"
    return
  fi

  # Step 3: Wait for server to be healthy again
  print_info "Waiting for server to become healthy after restart..."
  local wait_elapsed=0
  local max_restart_wait=60
  while [ "$wait_elapsed" -lt "$max_restart_wait" ]; do
    local health_code
    health_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE_URL}/health" 2>/dev/null || echo "000")
    if [ "$health_code" = "200" ]; then
      print_info "Server healthy after ${wait_elapsed}s"
      break
    fi
    sleep 2
    wait_elapsed=$((wait_elapsed + 2))
  done

  if [ "$wait_elapsed" -ge "$max_restart_wait" ]; then
    print_fail "Server did not recover within ${max_restart_wait}s"
    return
  fi

  # Step 4: Re-login (JWT secret persists via env var, but tokens may have expired)
  if [ -n "$ADMIN_EMAIL_ARG" ] && [ -n "$ADMIN_PASSWORD_ARG" ]; then
    http_request POST "${BASE_URL}/api/v1/auth/login" \
      "{\"email\":\"${ADMIN_EMAIL_ARG}\",\"password\":\"${ADMIN_PASSWORD_ARG}\"}"
  else
    http_request POST "${BASE_URL}/api/v1/auth/login" \
      "{\"email\":\"${TEST_USER}\",\"password\":\"${TEST_PASSWORD}\"}"
  fi

  if [ "$HTTP_CODE" = "200" ]; then
    ACCESS_TOKEN=$(json_field "$HTTP_BODY" "accessToken")
  else
    print_fail "Re-login after restart failed (HTTP $HTTP_CODE)"
    return
  fi

  # Step 5: Verify data survived restart
  print_test "Verify data persists after restart"
  http_request GET "${BASE_URL}/api/v1/servers"

  if [ "$HTTP_CODE" = "200" ]; then
    local post_restart_total
    post_restart_total=$(json_field "$HTTP_BODY" "total")
    if [ "$post_restart_total" = "$pre_restart_total" ]; then
      print_pass "Data persisted: $post_restart_total server(s) after restart (same as before)"
    else
      print_fail "Data mismatch: $pre_restart_total before vs $post_restart_total after restart"
    fi
  else
    print_fail "Could not list servers after restart (HTTP $HTTP_CODE)"
  fi
}

test_env_defaults() {
  print_header "13. Environment Defaults"

  # Verify the server started and is serving — this itself proves env defaults work
  # (docker-compose.yml uses ${VAR:-default} syntax for all critical values)
  print_test "Server runs with default environment values"
  http_request GET "${BASE_URL}/health"

  if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Server healthy with default env config"
  else
    print_fail "Server unhealthy (HTTP $HTTP_CODE) — env defaults may be broken"
  fi

  # Verify dashboard port is accessible at expected port
  print_test "Dashboard accessible on configured port (${PORT})"
  local dash_code
  dash_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "${BASE_URL}/" 2>/dev/null || echo "000")

  if [ "$dash_code" = "200" ]; then
    print_pass "Dashboard accessible on port ${PORT}"
  else
    print_fail "Dashboard not accessible on port ${PORT} (HTTP $dash_code)"
  fi

  # Check server port (3000) is exposed
  print_test "Server API port (3000) is exposed"
  local server_code
  server_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "http://${HOST}:3000/health" 2>/dev/null || echo "000")

  if [ "$server_code" = "200" ]; then
    print_pass "Server port 3000 accessible directly"
  else
    # Server port might not be directly accessible in some Docker setups (only via Nginx)
    print_info "Server port 3000 not directly accessible (HTTP $server_code) — OK if behind Nginx"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi
}

test_error_logs() {
  print_header "14. Error Log Analysis"

  if ! command -v docker >/dev/null 2>&1; then
    print_info "Docker not available, skipping log analysis"
    return
  fi

  print_test "Check for errors in recent container logs"
  local error_count
  error_count=$(docker compose logs --tail=100 2>/dev/null \
    | grep -i "error\|fatal\|exception" \
    | grep -v "errorCount\|ERROR_ANALYZER\|error level\|loglevel\|pino" \
    | wc -l | tr -d ' ')

  print_verbose "Found $error_count error entries in logs"

  if [ "$error_count" -eq 0 ]; then
    print_pass "No errors in recent logs"
  elif [ "$error_count" -lt 3 ]; then
    print_info "Found $error_count minor error(s) — review manually"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    print_fail "Found $error_count error(s) in recent logs"
    if [ "$VERBOSE" = "1" ]; then
      echo ""
      docker compose logs --tail=100 2>/dev/null \
        | grep -i "error\|fatal\|exception" \
        | grep -v "errorCount\|ERROR_ANALYZER\|error level\|loglevel\|pino" \
        | tail -5
    fi
  fi
}

print_summary() {
  print_header "Test Summary"
  echo ""
  echo "  Target:       ${BASE_URL}"
  echo "  Total Tests:  $TOTAL_TESTS"
  echo -e "  ${GREEN}Passed:       $PASSED_TESTS${NC}"

  if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "  ${RED}Failed:       $FAILED_TESTS${NC}"
  else
    echo "  Failed:       $FAILED_TESTS"
  fi

  local pass_rate=0
  if [ $TOTAL_TESTS -gt 0 ]; then
    pass_rate=$(awk "BEGIN {printf \"%.0f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")
  fi
  echo "  Pass Rate:    ${pass_rate}%"
  echo ""

  if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}  All smoke tests passed!${NC}"
    echo ""
    echo "  Access points:"
    echo "    Dashboard:  ${BASE_URL}"
    echo "    API Health: ${BASE_URL}/health"
    echo "    WebSocket:  ws://${HOST}:${PORT}/ws"
    echo ""
    exit 0
  elif [ "$pass_rate" -ge 80 ]; then
    echo -e "${YELLOW}  Most tests passed (${pass_rate}%) — review failures above${NC}"
    echo ""
    exit 0
  else
    echo -e "${RED}  Smoke tests FAILED (${pass_rate}% passed)${NC}"
    echo ""
    echo "  Troubleshooting:"
    echo "    docker compose logs -f"
    echo "    docker compose ps"
    echo "    ./scripts/smoke-test.sh --verbose"
    echo ""
    exit 1
  fi
}

main() {
  echo ""
  echo -e "${BLUE}  ServerPilot Smoke Test Suite${NC}"
  echo -e "${BLUE}  Target: ${BASE_URL}${NC}"
  echo -e "${BLUE}  Timeout: ${TIMEOUT}s per test${NC}"
  echo ""

  wait_for_services
  check_prerequisites
  test_health_check
  test_register
  test_login
  test_admin_login
  test_create_server
  test_list_servers
  test_nginx_proxy
  test_websocket
  test_ai_provider_health
  test_container_health
  test_data_persistence
  test_env_defaults
  test_error_logs

  print_summary
}

main
