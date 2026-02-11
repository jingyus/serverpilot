#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0
# ServerPilot development environment setup script
# Usage: ./scripts/dev-setup.sh
#
# Checks prerequisites, creates .env.local, and prepares the dev environment.
# Designed to run on macOS and Ubuntu.

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors (ANSI escape codes, disabled when not a TTY)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Compare two semver strings: returns 0 if $1 >= $2
semver_gte() {
  local IFS=.
  local i a=($1) b=($2)
  for ((i = 0; i < ${#b[@]}; i++)); do
    local va=${a[$i]:-0}
    local vb=${b[$i]:-0}
    if ((va > vb)); then return 0; fi
    if ((va < vb)); then return 1; fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# Step 1: Check Node.js
# ---------------------------------------------------------------------------
check_node() {
  local required="22.0.0"
  info "Checking Node.js version (>= ${required})..."

  if ! command -v node &>/dev/null; then
    fail "Node.js is not installed."
    echo "  Install Node.js >= ${required} from https://nodejs.org/"
    echo "  Or use a version manager: nvm, fnm, volta, mise"
    return 1
  fi

  local version
  version=$(node -v | sed 's/^v//')
  if semver_gte "$version" "$required"; then
    ok "Node.js v${version}"
  else
    fail "Node.js v${version} is too old (need >= ${required})"
    echo "  Upgrade with your version manager or from https://nodejs.org/"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 2: Check pnpm
# ---------------------------------------------------------------------------
check_pnpm() {
  local required="9.0.0"
  info "Checking pnpm version (>= ${required})..."

  if ! command -v pnpm &>/dev/null; then
    fail "pnpm is not installed."
    echo "  Install: corepack enable && corepack prepare pnpm@latest --activate"
    echo "  Or: npm install -g pnpm"
    return 1
  fi

  local version
  version=$(pnpm -v)
  if semver_gte "$version" "$required"; then
    ok "pnpm v${version}"
  else
    fail "pnpm v${version} is too old (need >= ${required})"
    echo "  Upgrade: corepack prepare pnpm@latest --activate"
    echo "  Or: npm install -g pnpm@latest"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 3: Check Git
# ---------------------------------------------------------------------------
check_git() {
  info "Checking Git..."
  if ! command -v git &>/dev/null; then
    fail "Git is not installed."
    echo "  macOS: xcode-select --install"
    echo "  Ubuntu: sudo apt install git"
    return 1
  fi
  ok "Git $(git --version | sed 's/git version //')"
}

# ---------------------------------------------------------------------------
# Step 4: Create .env.local from .env.example
# ---------------------------------------------------------------------------
setup_env() {
  local project_root
  project_root="$(cd "$(dirname "$0")/.." && pwd)"
  local env_file="${project_root}/.env.local"
  local example_file="${project_root}/.env.example"

  info "Setting up environment file..."

  if [ -f "$env_file" ]; then
    ok ".env.local already exists (skipping)"
    return 0
  fi

  if [ ! -f "$example_file" ]; then
    warn ".env.example not found, creating minimal .env.local"
    cat > "$env_file" << 'ENVEOF'
# ServerPilot Local Development Configuration
NODE_ENV=development
DATABASE_PATH=./data/serverpilot.db
LOG_LEVEL=debug

# AI Provider (claude | openai | ollama | deepseek)
AI_PROVIDER=claude
# ANTHROPIC_API_KEY=your_key_here
# OPENAI_API_KEY=your_key_here
# DEEPSEEK_API_KEY=your_key_here
ENVEOF
  else
    # Copy from example and override dev-specific values
    cp "$example_file" "$env_file"
    # Patch development defaults
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' 's/^NODE_ENV=.*/NODE_ENV=development/' "$env_file"
      sed -i '' 's|^DATABASE_PATH=.*|DATABASE_PATH=./data/serverpilot.db|' "$env_file"
      sed -i '' 's/^LOG_LEVEL=.*/LOG_LEVEL=debug/' "$env_file"
    else
      sed -i 's/^NODE_ENV=.*/NODE_ENV=development/' "$env_file"
      sed -i 's|^DATABASE_PATH=.*|DATABASE_PATH=./data/serverpilot.db|' "$env_file"
      sed -i 's/^LOG_LEVEL=.*/LOG_LEVEL=debug/' "$env_file"
    fi
  fi

  ok "Created .env.local"
  echo ""
  echo -e "  ${BOLD}Configure your AI provider:${NC}"
  echo "  Edit ${env_file} and set one of:"
  echo "    - ANTHROPIC_API_KEY  (for AI_PROVIDER=claude)"
  echo "    - OPENAI_API_KEY     (for AI_PROVIDER=openai)"
  echo "    - DEEPSEEK_API_KEY   (for AI_PROVIDER=deepseek)"
  echo ""
  echo "  AI features are optional - the platform works without an API key."
}

# ---------------------------------------------------------------------------
# Step 5: Create data directory
# ---------------------------------------------------------------------------
setup_data_dir() {
  local project_root
  project_root="$(cd "$(dirname "$0")/.." && pwd)"
  local data_dir="${project_root}/data"

  info "Setting up data directory..."
  if [ ! -d "$data_dir" ]; then
    mkdir -p "$data_dir"
    ok "Created data/ directory"
  else
    ok "data/ directory already exists"
  fi
}

# ---------------------------------------------------------------------------
# Step 6: Install dependencies
# ---------------------------------------------------------------------------
install_deps() {
  info "Installing dependencies with pnpm..."
  local project_root
  project_root="$(cd "$(dirname "$0")/.." && pwd)"
  (cd "$project_root" && pnpm install)
  ok "Dependencies installed"
}

# ---------------------------------------------------------------------------
# Step 7: Build shared package
# ---------------------------------------------------------------------------
build_shared() {
  info "Building shared package..."
  local project_root
  project_root="$(cd "$(dirname "$0")/.." && pwd)"
  (cd "$project_root" && pnpm --filter @aiinstaller/shared build)
  ok "Shared package built"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo -e "${BOLD}ServerPilot Development Environment Setup${NC}"
  echo "==========================================="
  echo ""

  local errors=0

  check_node  || ((errors++))
  check_pnpm  || ((errors++))
  check_git   || ((errors++))

  if [ "$errors" -gt 0 ]; then
    echo ""
    fail "Prerequisites check failed (${errors} error(s)). Fix the issues above and re-run."
    exit 1
  fi

  echo ""
  setup_env
  setup_data_dir
  install_deps
  build_shared

  echo ""
  echo -e "${GREEN}${BOLD}Setup complete!${NC}"
  echo ""
  echo "  Next steps:"
  echo "    1. Edit .env.local to configure your AI provider (optional)"
  echo "    2. Run: pnpm dev"
  echo ""
  echo "  Services:"
  echo "    - Dashboard: http://localhost:5173"
  echo "    - Server API: http://localhost:3000"
  echo ""
}

main "$@"
