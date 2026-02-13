#!/usr/bin/env bash
# ==============================================================================
# ServerPilot - One-Click Initialization Script
# ==============================================================================
# Usage: ./init.sh [--skip-config] [--no-start]
#
# This script:
#   1. Checks prerequisites (Docker, Docker Compose)
#   2. Generates .env from .env.example if missing
#   3. Auto-generates JWT secret
#   4. Guides AI Provider configuration (interactive)
#   5. Configures admin account
#   6. Builds and starts Docker containers
#   7. Waits for health checks to pass
#   8. Prints access information
# ==============================================================================

set -euo pipefail

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"

# --------------------------------------------------------------------------
# Colors (respect NO_COLOR)
# --------------------------------------------------------------------------
if [[ -z "${NO_COLOR:-}" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' NC=''
fi

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
banner()  {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║                                                              ║${NC}"
  echo -e "${CYAN}║   ${BOLD}ServerPilot${NC}${CYAN} — AI-Driven Intelligent DevOps Platform       ║${NC}"
  echo -e "${CYAN}║                                                              ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# Parse CLI flags
SKIP_CONFIG=false
NO_START=false
for arg in "$@"; do
  case "$arg" in
    --skip-config) SKIP_CONFIG=true ;;
    --no-start)    NO_START=true ;;
    --help|-h)
      echo "Usage: ./init.sh [--skip-config] [--no-start]"
      echo ""
      echo "Options:"
      echo "  --skip-config  Skip interactive configuration (use defaults)"
      echo "  --no-start     Only generate config, don't start containers"
      echo "  --help, -h     Show this help message"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# --------------------------------------------------------------------------
# Step 1: Prerequisites
# --------------------------------------------------------------------------
check_prerequisites() {
  info "Checking prerequisites..."

  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Please install Docker first:"
    echo "  https://docs.docker.com/get-docker/"
    exit 1
  fi
  success "Docker found: $(docker --version)"

  if ! docker compose version &>/dev/null; then
    error "Docker Compose V2 is not available."
    echo "  Please upgrade Docker or install Docker Compose plugin."
    exit 1
  fi
  success "Docker Compose found: $(docker compose version --short)"

  if ! docker info &>/dev/null 2>&1; then
    error "Docker daemon is not running. Please start Docker first."
    exit 1
  fi
  success "Docker daemon is running"
}

# --------------------------------------------------------------------------
# Step 2: Generate .env file
# --------------------------------------------------------------------------
setup_env() {
  if [[ -f "$ENV_FILE" ]]; then
    info ".env file already exists"
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    error ".env.example not found. Are you in the project root?"
    exit 1
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  success ".env file created from template"
}

# --------------------------------------------------------------------------
# Step 3: Generate JWT secret
# --------------------------------------------------------------------------
setup_jwt_secret() {
  # Check if JWT_SECRET is already set to a real value
  local current
  current=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d'=' -f2- || true)

  if [[ -n "$current" && "$current" != "change_me_to_a_random_string_at_least_32_chars" && "$current" != "default_jwt_secret_change_in_production" ]]; then
    info "JWT secret already configured"
    return
  fi

  local secret
  secret=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)

  # Use portable sed (works on both macOS and Linux)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${secret}|" "$ENV_FILE"
  else
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${secret}|" "$ENV_FILE"
  fi

  success "JWT secret auto-generated"
}

# --------------------------------------------------------------------------
# Step 4: Configure AI Provider (interactive)
# --------------------------------------------------------------------------
setup_ai_provider() {
  if [[ "$SKIP_CONFIG" == "true" ]]; then
    info "Skipping AI configuration (--skip-config)"
    return
  fi

  local current_key
  current_key=$(grep -E '^ANTHROPIC_API_KEY=' "$ENV_FILE" | cut -d'=' -f2- || true)

  if [[ -n "$current_key" && "$current_key" != "your_anthropic_api_key_here" ]]; then
    info "Anthropic API key already configured"
    return
  fi

  echo ""
  echo -e "${BOLD}AI Provider Configuration${NC}"
  echo -e "ServerPilot uses Claude AI for intelligent server management."
  echo -e "Get your API key at: ${CYAN}https://console.anthropic.com/${NC}"
  echo ""
  echo -e "  ${YELLOW}Note: AI features are optional. The system works without an API key,"
  echo -e "  but AI-powered chat and automated operations won't be available.${NC}"
  echo ""

  read -rp "Enter Anthropic API key (press Enter to skip): " api_key

  if [[ -n "$api_key" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${api_key}|" "$ENV_FILE"
    else
      sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${api_key}|" "$ENV_FILE"
    fi
    success "Anthropic API key configured"
  else
    warn "AI features skipped. You can configure later in .env file."
  fi
}

# --------------------------------------------------------------------------
# Step 5: Configure admin account
# --------------------------------------------------------------------------
setup_admin_account() {
  if [[ "$SKIP_CONFIG" == "true" ]]; then
    info "Skipping admin config (--skip-config, will auto-generate)"
    return
  fi

  local current_email
  current_email=$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d'=' -f2- || true)

  if [[ -n "$current_email" && "$current_email" != "" ]]; then
    info "Admin account already configured"
    return
  fi

  echo ""
  echo -e "${BOLD}Admin Account Configuration${NC}"
  echo -e "Set up the default admin account for first login."
  echo -e "  ${YELLOW}Note: If skipped, a random password will be generated and shown in logs.${NC}"
  echo ""

  read -rp "Admin email [admin@serverpilot.local]: " admin_email
  admin_email="${admin_email:-admin@serverpilot.local}"

  read -rsp "Admin password (min 8 chars, Enter to auto-generate): " admin_password
  echo ""

  # Add ADMIN_EMAIL and ADMIN_PASSWORD to .env if not present
  if ! grep -q '^ADMIN_EMAIL=' "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# Admin account (first startup only)" >> "$ENV_FILE"
    echo "ADMIN_EMAIL=${admin_email}" >> "$ENV_FILE"
    echo "ADMIN_PASSWORD=${admin_password}" >> "$ENV_FILE"
  else
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${admin_email}|" "$ENV_FILE"
      sed -i '' "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${admin_password}|" "$ENV_FILE"
    else
      sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${admin_email}|" "$ENV_FILE"
      sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${admin_password}|" "$ENV_FILE"
    fi
  fi

  if [[ -n "$admin_password" ]]; then
    success "Admin account configured: ${admin_email}"
  else
    success "Admin email set: ${admin_email} (password will be auto-generated)"
  fi
}

# --------------------------------------------------------------------------
# Step 6: Configure dashboard port
# --------------------------------------------------------------------------
setup_port() {
  if [[ "$SKIP_CONFIG" == "true" ]]; then
    return
  fi

  local current_port
  current_port=$(grep -E '^DASHBOARD_PORT=' "$ENV_FILE" | cut -d'=' -f2- || true)

  echo ""
  read -rp "Dashboard port [${current_port:-3001}]: " port
  port="${port:-${current_port:-3001}}"

  if grep -q '^DASHBOARD_PORT=' "$ENV_FILE"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^DASHBOARD_PORT=.*|DASHBOARD_PORT=${port}|" "$ENV_FILE"
    else
      sed -i "s|^DASHBOARD_PORT=.*|DASHBOARD_PORT=${port}|" "$ENV_FILE"
    fi
  fi

  success "Dashboard will be accessible at http://localhost:${port}"
}

# --------------------------------------------------------------------------
# Step 7: Build and start
# --------------------------------------------------------------------------
build_and_start() {
  if [[ "$NO_START" == "true" ]]; then
    info "Configuration complete (--no-start, skipping container startup)"
    return
  fi

  echo ""
  info "Building Docker images from source..."
  docker compose -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.build.yml" build

  echo ""
  info "Starting containers..."
  docker compose -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.build.yml" up -d

  echo ""
  info "Waiting for services to become healthy..."
  wait_for_healthy
}

# --------------------------------------------------------------------------
# Step 8: Wait for health
# --------------------------------------------------------------------------
wait_for_healthy() {
  local max_wait=120
  local elapsed=0
  local interval=3

  while [[ $elapsed -lt $max_wait ]]; do
    local server_health
    server_health=$(docker inspect --format='{{.State.Health.Status}}' serverpilot-server 2>/dev/null || echo "not_found")

    if [[ "$server_health" == "healthy" ]]; then
      success "Server is healthy"

      # Check dashboard
      local dashboard_status
      dashboard_status=$(docker inspect --format='{{.State.Status}}' serverpilot-dashboard 2>/dev/null || echo "not_found")
      if [[ "$dashboard_status" == "running" ]]; then
        success "Dashboard is running"
        return 0
      fi
    fi

    printf "."
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  echo ""
  warn "Services did not become healthy within ${max_wait}s"
  warn "Check logs with: docker compose logs"
  return 1
}

# --------------------------------------------------------------------------
# Step 9: Print summary
# --------------------------------------------------------------------------
print_summary() {
  local port
  port=$(grep -E '^DASHBOARD_PORT=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || echo "3001")
  port="${port:-3001}"

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                                                              ║${NC}"
  echo -e "${GREEN}║   ServerPilot is ready!                                      ║${NC}"
  echo -e "${GREEN}║                                                              ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Dashboard:  ${CYAN}http://localhost:${port}${NC}"
  echo -e "  API:        ${CYAN}http://localhost:${port}/api/v1${NC}"
  echo ""
  echo -e "  ${BOLD}Useful commands:${NC}"
  echo -e "    docker compose logs -f         # Follow logs"
  echo -e "    docker compose ps              # Check service status"
  echo -e "    docker compose restart server  # Restart server"
  echo -e "    docker compose down            # Stop all services"
  echo ""

  # Show auto-generated admin password from server logs if applicable
  local admin_password
  admin_password=$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || true)
  if [[ -z "$admin_password" ]]; then
    echo -e "  ${YELLOW}Admin credentials were auto-generated. Check server logs:${NC}"
    echo -e "    docker compose logs server | grep -A 5 'ADMIN ACCOUNT'"
    echo ""
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  banner
  check_prerequisites
  setup_env
  setup_jwt_secret
  setup_ai_provider
  setup_admin_account
  setup_port
  build_and_start
  if [[ "$NO_START" != "true" ]]; then
    print_summary
  else
    echo ""
    success "Configuration complete! Run 'docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build' to build & start from source."
  fi
}

main "$@"
