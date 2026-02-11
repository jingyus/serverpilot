#!/bin/bash
# ServerPilot Agent - Installation Script
#
# Downloads and installs the ServerPilot Agent as a systemd service.
#
# Usage:
#   curl -fsSL https://get.serverpilot.dev/install.sh | bash -s -- --server wss://example.com
#   # or
#   bash install.sh [OPTIONS]
#
# Options:
#   --server <url>     ServerPilot server WebSocket URL (required for install)
#   --uninstall        Remove the agent, service, and all related files
#   --dry-run          Preview mode, do not execute commands
#   --verbose, -v      Enable verbose output
#   --yes, -y          Auto-confirm all steps
#   --install-dir <d>  Custom install directory (default: /usr/local/bin)
#   --version          Show version and exit
#   --help, -h         Show this help message
#
# Environment variables:
#   SERVERPILOT_SERVER       Server URL (overridden by --server)
#   SERVERPILOT_DOWNLOAD_URL Binary download base URL
#   SERVERPILOT_TMPDIR       Temporary directory for downloads
#   SERVERPILOT_INSTALL_DIR  Custom install directory

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
fi

# ============================================================================
# Constants
# ============================================================================

readonly SP_VERSION="0.1.0"
readonly SP_BINARY_NAME="serverpilot-agent"
readonly SP_DOWNLOAD_BINARY_NAME="install-agent"
readonly SP_BASE_DOWNLOAD_URL="${SERVERPILOT_DOWNLOAD_URL:-${AIINSTALLER_DOWNLOAD_URL:-https://github.com/aiinstaller/aiinstaller/releases/latest/download}}"
readonly SP_DEFAULT_SERVER_URL="wss://api.serverpilot.dev"
readonly SP_CHECKSUM_URL="${SP_BASE_DOWNLOAD_URL}/checksums.txt"
readonly SP_DEFAULT_INSTALL_DIR="/usr/local/bin"
readonly SP_SERVICE_NAME="serverpilot-agent"
readonly SP_SERVICE_FILE="/etc/systemd/system/${SP_SERVICE_NAME}.service"
readonly SP_CONFIG_DIR="/etc/serverpilot"
readonly SP_CONFIG_FILE="${SP_CONFIG_DIR}/agent.conf"
readonly SP_LOG_DIR="/var/log/serverpilot"
readonly SP_DATA_DIR="/var/lib/serverpilot"

# ============================================================================
# Color helpers (respects NO_COLOR)
# ============================================================================

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  BOLD=''
  RESET=''
fi

# ============================================================================
# Logging
# ============================================================================

info()  { echo -e "${BLUE}ℹ${RESET} $*"; }
ok()    { echo -e "${GREEN}✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $*" >&2; }
error() { echo -e "${RED}✗${RESET} $*" >&2; }
fatal() { error "$@"; exit 1; }

step() {
  local num="$1"; shift
  echo -e "${BOLD}[${num}]${RESET} $*"
}

# ============================================================================
# Platform detection
# ============================================================================

detect_os() {
  local uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *)       echo "unsupported" ;;
  esac
}

detect_arch() {
  local uname_m
  uname_m="$(uname -m)"
  case "$uname_m" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             echo "unsupported" ;;
  esac
}

detect_distro() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    echo "${ID:-unknown}-${VERSION_ID:-unknown}"
  elif [[ -f /etc/redhat-release ]]; then
    echo "rhel-unknown"
  else
    echo "unknown"
  fi
}

get_binary_filename() {
  local os="$1"
  local arch="$2"
  echo "${SP_DOWNLOAD_BINARY_NAME}-${os}-${arch}"
}

# ============================================================================
# Dependency checks
# ============================================================================

check_command() {
  command -v "$1" >/dev/null 2>&1
}

get_download_tool() {
  if check_command curl; then
    echo "curl"
  elif check_command wget; then
    echo "wget"
  else
    echo "none"
  fi
}

get_checksum_tool() {
  if check_command sha256sum; then
    echo "sha256sum"
  elif check_command shasum; then
    echo "shasum"
  else
    echo "none"
  fi
}

check_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fatal "This script must be run as root. Try: sudo bash install.sh ..."
  fi
}

has_systemd() {
  check_command systemctl && [[ -d /run/systemd/system ]]
}

# ============================================================================
# Download helpers
# ============================================================================

download_file() {
  local url="$1"
  local dest="$2"
  local tool
  tool="$(get_download_tool)"

  case "$tool" in
    curl) curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url" ;;
    wget) wget -q --tries=3 -O "$dest" "$url" ;;
    none) fatal "Neither curl nor wget found. Please install one of them." ;;
  esac
}

# ============================================================================
# Checksum verification
# ============================================================================

verify_checksum() {
  local file="$1"
  local checksums_file="$2"
  local filename
  filename="$(basename "$file")"

  local expected
  expected="$(grep "$filename" "$checksums_file" 2>/dev/null | awk '{print $1}')"

  if [[ -z "$expected" ]]; then
    warn "No checksum found for $filename, skipping verification"
    return 0
  fi

  local tool
  tool="$(get_checksum_tool)"
  local actual

  case "$tool" in
    sha256sum) actual="$(sha256sum "$file" | awk '{print $1}')" ;;
    shasum)    actual="$(shasum -a 256 "$file" | awk '{print $1}')" ;;
    none)
      warn "No checksum tool found, skipping verification"
      return 0
      ;;
  esac

  if [[ "$actual" != "$expected" ]]; then
    error "Checksum mismatch for $filename"
    error "  Expected: $expected"
    error "  Actual:   $actual"
    return 1
  fi

  return 0
}

# ============================================================================
# Rollback / cleanup
# ============================================================================

CLEANUP_DIRS=()

cleanup() {
  if [[ ${#CLEANUP_DIRS[@]} -gt 0 ]]; then
    for dir in "${CLEANUP_DIRS[@]}"; do
      if [[ -d "$dir" ]]; then
        rm -rf "$dir"
      fi
    done
  fi
}

# Only set trap when running directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup EXIT
fi

# ============================================================================
# systemd service management
# ============================================================================

generate_service_file() {
  local binary_path="$1"
  local server_url="$2"

  cat <<SERVICEEOF
[Unit]
Description=ServerPilot Agent - AI-Driven DevOps Platform
Documentation=https://github.com/serverpilot/serverpilot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${binary_path} --server ${server_url}
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SP_SERVICE_NAME}
Environment=NODE_ENV=production
WorkingDirectory=${SP_DATA_DIR}

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${SP_LOG_DIR} ${SP_DATA_DIR} ${SP_CONFIG_DIR}
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
SERVICEEOF
}

install_systemd_service() {
  local binary_path="$1"
  local server_url="$2"

  if ! has_systemd; then
    warn "systemd not detected, skipping service installation"
    info "You can run the agent manually: ${binary_path} --server ${server_url}"
    return 1
  fi

  # Create required directories
  mkdir -p "$SP_CONFIG_DIR" "$SP_LOG_DIR" "$SP_DATA_DIR"

  # Write config file
  cat > "$SP_CONFIG_FILE" <<CONFEOF
# ServerPilot Agent Configuration
# Generated by install.sh v${SP_VERSION}
SERVER_URL=${server_url}
INSTALL_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
INSTALL_VERSION=${SP_VERSION}
CONFEOF

  # Generate and install service file
  generate_service_file "$binary_path" "$server_url" > "$SP_SERVICE_FILE"
  ok "Created systemd service file: ${SP_SERVICE_FILE}"

  # Reload systemd
  systemctl daemon-reload
  ok "Reloaded systemd daemon"

  # Enable service
  systemctl enable "$SP_SERVICE_NAME" >/dev/null 2>&1
  ok "Enabled ${SP_SERVICE_NAME} service (starts on boot)"

  # Start service
  systemctl start "$SP_SERVICE_NAME"
  ok "Started ${SP_SERVICE_NAME} service"

  return 0
}

# ============================================================================
# Connection verification
# ============================================================================

verify_connection() {
  local max_attempts=5
  local attempt=1
  local wait_sec=2

  info "Verifying agent connection..."

  while [[ $attempt -le $max_attempts ]]; do
    if systemctl is-active --quiet "$SP_SERVICE_NAME" 2>/dev/null; then
      ok "Agent is running (attempt ${attempt}/${max_attempts})"
      # Check logs for connection confirmation
      local logs
      logs="$(journalctl -u "$SP_SERVICE_NAME" --no-pager -n 20 2>/dev/null || true)"
      if echo "$logs" | grep -qi "connected\|authenticated\|ready"; then
        ok "Agent connected to server successfully"
        return 0
      fi
      if echo "$logs" | grep -qi "error\|failed\|refused"; then
        warn "Agent is running but may have connection issues"
        warn "Check logs: journalctl -u ${SP_SERVICE_NAME} -f"
        return 0
      fi
      # Service is running, give it time
      if [[ $attempt -lt $max_attempts ]]; then
        sleep "$wait_sec"
      fi
    else
      if [[ $attempt -ge $max_attempts ]]; then
        error "Agent service is not running after ${max_attempts} attempts"
        error "Check logs: journalctl -u ${SP_SERVICE_NAME} -f"
        return 1
      fi
      sleep "$wait_sec"
    fi
    attempt=$((attempt + 1))
  done

  # Service is running but no explicit connection log found
  ok "Agent service is running"
  info "Check connection status: journalctl -u ${SP_SERVICE_NAME} -f"
  return 0
}

# ============================================================================
# Uninstall
# ============================================================================

do_uninstall() {
  local install_dir="${INSTALL_DIR:-$SP_DEFAULT_INSTALL_DIR}"
  local binary_path="${install_dir}/${SP_BINARY_NAME}"

  echo -e "${BOLD}ServerPilot Agent - Uninstall${RESET}"
  echo ""

  if [[ "$(detect_os)" == "linux" ]]; then
    check_root
  fi

  # Stop and disable service
  if has_systemd && systemctl is-active --quiet "$SP_SERVICE_NAME" 2>/dev/null; then
    step 1 "Stopping ${SP_SERVICE_NAME} service..."
    systemctl stop "$SP_SERVICE_NAME" 2>/dev/null || true
    ok "Service stopped"
  else
    step 1 "Service not running, skipping stop"
  fi

  if has_systemd && [[ -f "$SP_SERVICE_FILE" ]]; then
    step 2 "Disabling and removing systemd service..."
    systemctl disable "$SP_SERVICE_NAME" 2>/dev/null || true
    rm -f "$SP_SERVICE_FILE"
    systemctl daemon-reload 2>/dev/null || true
    ok "Service removed"
  else
    step 2 "No systemd service found, skipping"
  fi

  # Remove binary
  if [[ -f "$binary_path" ]]; then
    step 3 "Removing binary: ${binary_path}"
    rm -f "$binary_path"
    ok "Binary removed"
  else
    step 3 "Binary not found at ${binary_path}, skipping"
  fi

  # Remove config
  if [[ -d "$SP_CONFIG_DIR" ]]; then
    step 4 "Removing config directory: ${SP_CONFIG_DIR}"
    rm -rf "$SP_CONFIG_DIR"
    ok "Config removed"
  else
    step 4 "Config directory not found, skipping"
  fi

  # Remove data directory
  if [[ -d "$SP_DATA_DIR" ]]; then
    step 5 "Removing data directory: ${SP_DATA_DIR}"
    rm -rf "$SP_DATA_DIR"
    ok "Data directory removed"
  else
    step 5 "Data directory not found, skipping"
  fi

  # Remove log directory
  if [[ -d "$SP_LOG_DIR" ]]; then
    step 6 "Removing log directory: ${SP_LOG_DIR}"
    rm -rf "$SP_LOG_DIR"
    ok "Logs removed"
  else
    step 6 "Log directory not found, skipping"
  fi

  echo ""
  ok "ServerPilot Agent has been completely uninstalled"
}

# ============================================================================
# CLI parsing
# ============================================================================

parse_args() {
  SERVER_URL="${SERVERPILOT_SERVER:-${AIINSTALLER_SERVER:-$SP_DEFAULT_SERVER_URL}}"
  INSTALL_DIR="${SERVERPILOT_INSTALL_DIR:-$SP_DEFAULT_INSTALL_DIR}"
  DRY_RUN=false
  VERBOSE=false
  AUTO_YES=false
  SHOW_VERSION=false
  SHOW_HELP=false
  DO_UNINSTALL=false
  AGENT_ARGS=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --server)
        [[ $# -lt 2 ]] && fatal "--server requires a value"
        SERVER_URL="$2"
        shift 2
        ;;
      --install-dir)
        [[ $# -lt 2 ]] && fatal "--install-dir requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --uninstall)
        DO_UNINSTALL=true
        shift
        ;;
      --dry-run)
        DRY_RUN=true
        AGENT_ARGS+=("--dry-run")
        shift
        ;;
      --verbose|-v)
        VERBOSE=true
        AGENT_ARGS+=("--verbose")
        shift
        ;;
      --yes|-y)
        AUTO_YES=true
        AGENT_ARGS+=("--yes")
        shift
        ;;
      --version)
        SHOW_VERSION=true
        shift
        ;;
      --help|-h)
        SHOW_HELP=true
        shift
        ;;
      *)
        warn "Unknown option: $1"
        shift
        ;;
    esac
  done
}

show_help() {
  cat <<EOF
ServerPilot Agent v${SP_VERSION} - AI-Driven DevOps Platform

Usage:
  install.sh [OPTIONS]

Install Options:
  --server <url>      ServerPilot server URL (default: ${SP_DEFAULT_SERVER_URL})
  --install-dir <dir> Installation directory (default: ${SP_DEFAULT_INSTALL_DIR})
  --yes, -y           Auto-confirm all steps
  --dry-run           Preview mode, do not execute commands
  --verbose, -v       Enable verbose output

Uninstall:
  --uninstall         Remove agent, service, and all related files

Info:
  --version           Show version and exit
  --help, -h          Show this help message

Environment variables:
  SERVERPILOT_SERVER       Server URL
  SERVERPILOT_DOWNLOAD_URL Binary download base URL
  SERVERPILOT_INSTALL_DIR  Custom install directory

Examples:
  # One-line install
  curl -fsSL https://get.serverpilot.dev/install.sh | sudo bash -s -- --server wss://example.com

  # Install with custom server
  sudo bash install.sh --server wss://my-server.example.com

  # Preview mode
  bash install.sh --dry-run --verbose --server wss://example.com

  # Uninstall
  sudo bash install.sh --uninstall
EOF
}

# ============================================================================
# Main install logic
# ============================================================================

main() {
  parse_args "$@"

  if [[ "$SHOW_VERSION" == true ]]; then
    echo "ServerPilot Agent v${SP_VERSION}"
    exit 0
  fi

  if [[ "$SHOW_HELP" == true ]]; then
    show_help
    exit 0
  fi

  if [[ "$DO_UNINSTALL" == true ]]; then
    do_uninstall
    exit 0
  fi

  echo -e "${BOLD}ServerPilot Agent v${SP_VERSION} - Installation${RESET}"
  echo ""

  # 1. Detect platform
  local os arch filename distro
  os="$(detect_os)"
  arch="$(detect_arch)"
  distro="$(detect_distro)"

  if [[ "$os" == "unsupported" ]]; then
    fatal "Unsupported operating system: $(uname -s). Only Linux and macOS are supported."
  fi

  if [[ "$arch" == "unsupported" ]]; then
    fatal "Unsupported architecture: $(uname -m). Only x86_64 and arm64 are supported."
  fi

  filename="$(get_binary_filename "$os" "$arch")"
  step 1 "Platform detection"
  info "  OS: ${os} (${distro})"
  info "  Architecture: ${arch}"

  # 2. Check prerequisites
  step 2 "Checking prerequisites"
  local dl_tool
  dl_tool="$(get_download_tool)"
  if [[ "$dl_tool" == "none" ]]; then
    fatal "Neither curl nor wget found. Please install one of them."
  fi
  ok "Download tool: ${dl_tool}"

  if [[ "$os" == "linux" ]] && has_systemd; then
    ok "systemd detected"
  elif [[ "$os" == "linux" ]]; then
    warn "systemd not detected - agent will not be installed as a service"
  fi

  if [[ "$VERBOSE" == true ]]; then
    info "  Server URL: $SERVER_URL"
    info "  Install dir: $INSTALL_DIR"
  fi

  # 3. Root check (Linux only, skip for dry-run)
  if [[ "$os" == "linux" ]] && [[ "$DRY_RUN" != true ]]; then
    check_root
  fi

  # 4. Create temp directory
  local tmpdir
  tmpdir="${SERVERPILOT_TMPDIR:-${AIINSTALLER_TMPDIR:-$(mktemp -d 2>/dev/null || mktemp -d -t 'serverpilot')}}"
  CLEANUP_DIRS+=("$tmpdir")

  if [[ "$VERBOSE" == true ]]; then
    info "  Temp directory: $tmpdir"
  fi

  # 5. Download binary
  local gz_filename="${filename}.gz"
  local download_url="${SP_BASE_DOWNLOAD_URL}/${gz_filename}"
  local gz_path="${tmpdir}/${gz_filename}"
  local binary_path="${tmpdir}/${filename}"
  local install_path="${INSTALL_DIR}/${SP_BINARY_NAME}"

  step 3 "Downloading agent binary"

  if [[ "$DRY_RUN" == true ]]; then
    info "  [dry-run] Would download: $download_url"
    info "  [dry-run] Would install to: $install_path"
    info "  [dry-run] Would create systemd service: $SP_SERVICE_FILE"
    info "  [dry-run] Would configure server URL: $SERVER_URL"
    echo ""
    ok "Dry run complete. No changes were made."
    exit 0
  fi

  # Try compressed version first, fall back to uncompressed
  if download_file "$download_url" "$gz_path" 2>/dev/null; then
    ok "Downloaded ${gz_filename}"

    # Verify checksum (best-effort) on compressed file
    local checksums_path="${tmpdir}/checksums.txt"
    if download_file "$SP_CHECKSUM_URL" "$checksums_path" 2>/dev/null; then
      if verify_checksum "$gz_path" "$checksums_path"; then
        ok "Checksum verified"
      else
        fatal "Checksum verification failed. The download may be corrupted."
      fi
    else
      warn "Could not download checksums, skipping verification"
    fi

    # Decompress
    info "  Decompressing..."
    gunzip -f "$gz_path"
    ok "Decompressed to ${filename}"
  else
    # Fallback: try uncompressed binary directly
    warn "Compressed binary not found, trying uncompressed..."
    download_url="${SP_BASE_DOWNLOAD_URL}/${filename}"
    download_file "$download_url" "$binary_path"
    ok "Downloaded ${filename}"

    # Verify checksum
    local checksums_path="${tmpdir}/checksums.txt"
    if download_file "$SP_CHECKSUM_URL" "$checksums_path" 2>/dev/null; then
      if verify_checksum "$binary_path" "$checksums_path"; then
        ok "Checksum verified"
      else
        fatal "Checksum verification failed. The download may be corrupted."
      fi
    else
      warn "Could not download checksums, skipping verification"
    fi
  fi

  # 6. Install binary
  step 4 "Installing binary"
  mkdir -p "$INSTALL_DIR"
  chmod +x "$binary_path"
  mv "$binary_path" "$install_path"
  ok "Installed to ${install_path}"

  # 7. Install systemd service (Linux only)
  if [[ "$os" == "linux" ]]; then
    step 5 "Configuring systemd service"
    if install_systemd_service "$install_path" "$SERVER_URL"; then
      # 8. Verify connection
      step 6 "Verifying agent connection"
      verify_connection
    fi
  else
    step 5 "Skipping systemd (macOS)"
    info "  Run manually: ${install_path} --server ${SERVER_URL}"
  fi

  # 9. Print summary
  echo ""
  echo -e "${BOLD}Installation complete!${RESET}"
  echo ""
  info "Binary:  ${install_path}"
  if [[ "$os" == "linux" ]] && has_systemd; then
    info "Service: ${SP_SERVICE_NAME}"
    info "Config:  ${SP_CONFIG_FILE}"
    echo ""
    info "Useful commands:"
    info "  Status:   systemctl status ${SP_SERVICE_NAME}"
    info "  Logs:     journalctl -u ${SP_SERVICE_NAME} -f"
    info "  Restart:  systemctl restart ${SP_SERVICE_NAME}"
    info "  Stop:     systemctl stop ${SP_SERVICE_NAME}"
    info "  Uninstall: curl -fsSL https://get.serverpilot.dev/install.sh | sudo bash -s -- --uninstall"
  else
    info "Server:  ${SERVER_URL}"
    echo ""
    info "Start the agent:"
    info "  ${install_path} --server ${SERVER_URL}"
  fi
}

# Only run main when executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
