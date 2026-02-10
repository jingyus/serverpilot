#!/bin/bash

###############################################################################
# AI Installer - Nginx Setup Script
#
# This script installs and configures Nginx as a reverse proxy for AI Installer
#
# Usage:
#   sudo bash scripts/setup-nginx.sh [--dev|--production]
#
# Options:
#   --dev         Setup for development (HTTP only, localhost)
#   --production  Setup for production (HTTPS with Let's Encrypt)
#
# Requirements:
#   - Ubuntu 20.04+ / Debian 10+
#   - Root or sudo access
#   - AI Installer server running on localhost:3000
###############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default mode
MODE="${1:-production}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VER=$VERSION_ID
    else
        log_error "Cannot detect operating system"
        exit 1
    fi

    log_info "Detected OS: $OS $VER"
}

# Install Nginx
install_nginx() {
    log_info "Installing Nginx..."

    if command -v nginx &> /dev/null; then
        log_warning "Nginx is already installed"
        nginx -v
        return
    fi

    apt-get update -y
    apt-get install -y nginx

    # Enable and start Nginx
    systemctl enable nginx
    systemctl start nginx

    log_success "Nginx installed successfully"
    nginx -v
}

# Setup development configuration
setup_dev() {
    log_info "Setting up Nginx for development..."

    # Copy configuration
    cp nginx/aiinstaller-dev.conf /etc/nginx/sites-available/aiinstaller

    # Create symlink
    ln -sf /etc/nginx/sites-available/aiinstaller /etc/nginx/sites-enabled/aiinstaller

    # Remove default site
    rm -f /etc/nginx/sites-enabled/default

    # Test configuration
    nginx -t

    # Reload Nginx
    systemctl reload nginx

    log_success "Nginx development configuration applied"
    log_info "Test WebSocket connection: ws://localhost/"
}

# Setup production configuration (without SSL initially)
setup_production_http() {
    log_info "Setting up Nginx for production (HTTP only, pending SSL)..."

    # Copy configuration
    cp nginx/aiinstaller.conf /etc/nginx/sites-available/aiinstaller

    # Temporarily modify config to remove SSL directives
    sed -i 's/listen 443 ssl http2;/listen 443;/g' /etc/nginx/sites-available/aiinstaller
    sed -i '/ssl_certificate/d' /etc/nginx/sites-available/aiinstaller
    sed -i '/ssl_/d' /etc/nginx/sites-available/aiinstaller

    # Create symlink
    ln -sf /etc/nginx/sites-available/aiinstaller /etc/nginx/sites-enabled/aiinstaller

    # Remove default site
    rm -f /etc/nginx/sites-enabled/default

    # Test configuration
    nginx -t

    # Reload Nginx
    systemctl reload nginx

    log_success "Nginx production configuration applied (HTTP only)"
    log_warning "SSL not configured yet. Run setup-ssl.sh to configure HTTPS"
}

# Setup production configuration with SSL
setup_production_ssl() {
    log_info "Setting up Nginx for production with SSL..."

    # Check if SSL certificates exist
    DOMAIN="api.aiinstaller.dev"
    CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

    if [ ! -f "$CERT_PATH" ]; then
        log_error "SSL certificates not found at $CERT_PATH"
        log_info "Please run setup-ssl.sh first to obtain certificates"
        exit 1
    fi

    # Copy full configuration with SSL
    cp nginx/aiinstaller.conf /etc/nginx/sites-available/aiinstaller

    # Create symlink
    ln -sf /etc/nginx/sites-available/aiinstaller /etc/nginx/sites-enabled/aiinstaller

    # Remove default site
    rm -f /etc/nginx/sites-enabled/default

    # Test configuration
    nginx -t

    # Reload Nginx
    systemctl reload nginx

    log_success "Nginx production configuration with SSL applied"
    log_info "Test WebSocket connection: wss://$DOMAIN/"
}

# Configure firewall
configure_firewall() {
    log_info "Configuring firewall..."

    if command -v ufw &> /dev/null; then
        # Allow HTTP and HTTPS
        ufw allow 'Nginx Full'
        log_success "Firewall rules added"
    else
        log_warning "UFW not installed, skipping firewall configuration"
    fi
}

# Verify installation
verify_installation() {
    log_info "Verifying installation..."

    # Check if Nginx is running
    if systemctl is-active --quiet nginx; then
        log_success "Nginx is running"
    else
        log_error "Nginx is not running"
        exit 1
    fi

    # Check if configuration is valid
    if nginx -t 2>&1 | grep -q "successful"; then
        log_success "Nginx configuration is valid"
    else
        log_error "Nginx configuration test failed"
        exit 1
    fi

    # Check if backend is accessible
    if curl -s http://localhost:3000 > /dev/null; then
        log_success "Backend server is accessible"
    else
        log_warning "Backend server not accessible on localhost:3000"
        log_warning "Make sure AI Installer server is running"
    fi
}

# Main function
main() {
    echo "===================================="
    echo "AI Installer - Nginx Setup"
    echo "===================================="
    echo ""

    check_root
    detect_os
    install_nginx

    case "$MODE" in
        --dev)
            setup_dev
            ;;
        --production)
            # Check if SSL should be configured
            if [ -f "/etc/letsencrypt/live/api.aiinstaller.dev/fullchain.pem" ]; then
                setup_production_ssl
            else
                setup_production_http
            fi
            configure_firewall
            ;;
        *)
            log_error "Invalid mode: $MODE"
            echo "Usage: $0 [--dev|--production]"
            exit 1
            ;;
    esac

    verify_installation

    echo ""
    echo "===================================="
    echo "Setup Complete!"
    echo "===================================="

    if [ "$MODE" = "--dev" ]; then
        echo "Development mode:"
        echo "  - WebSocket: ws://localhost/"
        echo "  - Logs: /var/log/nginx/aiinstaller_dev_*.log"
    else
        echo "Production mode:"
        if [ -f "/etc/letsencrypt/live/api.aiinstaller.dev/fullchain.pem" ]; then
            echo "  - WebSocket: wss://api.aiinstaller.dev/"
        else
            echo "  - WebSocket: ws://api.aiinstaller.dev/ (HTTP only)"
            echo "  - Run setup-ssl.sh to configure HTTPS"
        fi
        echo "  - Logs: /var/log/nginx/aiinstaller_*.log"
    fi
    echo ""
    echo "Useful commands:"
    echo "  - Check status: systemctl status nginx"
    echo "  - View logs: tail -f /var/log/nginx/aiinstaller_*.log"
    echo "  - Test config: nginx -t"
    echo "  - Reload: systemctl reload nginx"
    echo ""
}

main "$@"
