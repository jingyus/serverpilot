#!/bin/bash
# ServerPilot Agent - Installation Script (wrapper)
#
# This is a compatibility wrapper. The canonical install script lives at
# the project root: install.sh
#
# For direct usage:
#   curl -fsSL https://get.serverpilot.dev/install.sh | sudo bash -s -- --server wss://example.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

exec bash "$ROOT_DIR/install.sh" "$@"
