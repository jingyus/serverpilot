#!/bin/bash
# AI Installer - OpenClaw Installation Agent
#
# Downloads and runs the AI-powered installation agent for OpenClaw.
#
# Usage:
#   curl -fsSL https://get.aiinstaller.dev/install.sh | bash
#   # or
#   bash install.sh [OPTIONS]
#
# Options:
#   --server <url>   Specify the AI Installer server URL
#   --dry-run        Preview mode, do not execute commands
#   --verbose        Enable verbose output
#   --yes            Auto-confirm all steps
#   --version        Show version and exit
#   --help           Show this help message
#
# Environment variables:
#   AIINSTALLER_SERVER   Server URL (overridden by --server)
#   AIINSTALLER_TMPDIR   Temporary directory for downloads

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
fi

# ============================================================================
# Constants
# ============================================================================

readonly VERSION="0.1.0"
readonly BINARY_NAME="install-agent"
readonly BASE_DOWNLOAD_URL="${AIINSTALLER_DOWNLOAD_URL:-https://github.com/aiinstaller/aiinstaller/releases/latest/download}"
readonly DEFAULT_SERVER_URL="wss://api.aiinstaller.dev"
readonly CHECKSUM_URL="${BASE_DOWNLOAD_URL}/checksums.txt"

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

get_binary_filename() {
  local os="$1"
  local arch="$2"
  echo "${BINARY_NAME}-${os}-${arch}"
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
# CLI parsing
# ============================================================================

parse_args() {
  SERVER_URL="${AIINSTALLER_SERVER:-$DEFAULT_SERVER_URL}"
  DRY_RUN=false
  VERBOSE=false
  AUTO_YES=false
  SHOW_VERSION=false
  SHOW_HELP=false
  AGENT_ARGS=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --server)
        [[ $# -lt 2 ]] && fatal "--server requires a value"
        SERVER_URL="$2"
        shift 2
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
AI Installer v${VERSION} - OpenClaw Installation Agent

Usage:
  install.sh [OPTIONS]

Options:
  --server <url>   AI Installer server URL (default: ${DEFAULT_SERVER_URL})
  --dry-run        Preview mode, do not execute commands
  --verbose, -v    Enable verbose output
  --yes, -y        Auto-confirm all steps
  --version        Show version and exit
  --help, -h       Show this help message

Environment variables:
  AIINSTALLER_SERVER       Server URL
  AIINSTALLER_DOWNLOAD_URL Binary download base URL
  AIINSTALLER_TMPDIR       Temporary directory for downloads

Examples:
  # Standard install
  curl -fsSL https://get.aiinstaller.dev/install.sh | bash

  # With custom server
  bash install.sh --server wss://my-server.example.com

  # Preview mode
  bash install.sh --dry-run --verbose
EOF
}

# ============================================================================
# Main logic
# ============================================================================

main() {
  parse_args "$@"

  if [[ "$SHOW_VERSION" == true ]]; then
    echo "AI Installer v${VERSION}"
    exit 0
  fi

  if [[ "$SHOW_HELP" == true ]]; then
    show_help
    exit 0
  fi

  echo -e "${BOLD}AI Installer v${VERSION}${RESET}"
  echo ""

  # 1. Detect platform
  local os arch filename
  os="$(detect_os)"
  arch="$(detect_arch)"

  if [[ "$os" == "unsupported" ]]; then
    fatal "Unsupported operating system: $(uname -s). Only Linux and macOS are supported."
  fi

  if [[ "$arch" == "unsupported" ]]; then
    fatal "Unsupported architecture: $(uname -m). Only x86_64 and arm64 are supported."
  fi

  filename="$(get_binary_filename "$os" "$arch")"
  info "Detected platform: ${os}-${arch}"

  # 2. Check download tool
  local dl_tool
  dl_tool="$(get_download_tool)"
  if [[ "$dl_tool" == "none" ]]; then
    fatal "Neither curl nor wget found. Please install one of them."
  fi

  if [[ "$VERBOSE" == true ]]; then
    info "Download tool: $dl_tool"
    info "Server URL: $SERVER_URL"
  fi

  # 3. Create temp directory
  local tmpdir
  tmpdir="${AIINSTALLER_TMPDIR:-$(mktemp -d 2>/dev/null || mktemp -d -t 'aiinstaller')}"
  CLEANUP_DIRS+=("$tmpdir")

  if [[ "$VERBOSE" == true ]]; then
    info "Temp directory: $tmpdir"
  fi

  # 4. Download compressed binary
  local gz_filename="${filename}.gz"
  local download_url="${BASE_DOWNLOAD_URL}/${gz_filename}"
  local gz_path="${tmpdir}/${gz_filename}"
  local binary_path="${tmpdir}/${filename}"

  info "Downloading ${gz_filename}..."

  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] Would download: $download_url"
    info "[dry-run] Would decompress to: $binary_path"
    ok "Dry run complete. No changes were made."
    exit 0
  fi

  # Try compressed version first, fall back to uncompressed
  if download_file "$download_url" "$gz_path" 2>/dev/null; then
    ok "Downloaded ${gz_filename}"

    # 5. Verify checksum (best-effort) on compressed file
    local checksums_path="${tmpdir}/checksums.txt"
    if download_file "$CHECKSUM_URL" "$checksums_path" 2>/dev/null; then
      if verify_checksum "$gz_path" "$checksums_path"; then
        ok "Checksum verified"
      else
        fatal "Checksum verification failed. The download may be corrupted."
      fi
    else
      warn "Could not download checksums, skipping verification"
    fi

    # 5b. Decompress
    info "Decompressing..."
    gunzip -f "$gz_path"
    ok "Decompressed to ${filename}"
  else
    # Fallback: try uncompressed binary directly
    warn "Compressed binary not found, trying uncompressed..."
    download_url="${BASE_DOWNLOAD_URL}/${filename}"
    download_file "$download_url" "$binary_path"
    ok "Downloaded ${filename}"

    # Verify checksum
    local checksums_path="${tmpdir}/checksums.txt"
    if download_file "$CHECKSUM_URL" "$checksums_path" 2>/dev/null; then
      if verify_checksum "$binary_path" "$checksums_path"; then
        ok "Checksum verified"
      else
        fatal "Checksum verification failed. The download may be corrupted."
      fi
    else
      warn "Could not download checksums, skipping verification"
    fi
  fi

  # 6. Make executable
  chmod +x "$binary_path"

  # 7. Run the agent
  info "Starting AI Installer Agent..."
  echo ""

  exec "$binary_path" --server "$SERVER_URL" "${AGENT_ARGS[@]}"
}

# Only run main when executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
