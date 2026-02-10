#!/bin/bash

###############################################################################
# AI Installer - SSL/TLS Certificate Setup Script
#
# This script obtains and configures Let's Encrypt SSL certificates for Nginx
#
# Usage:
#   sudo bash scripts/setup-ssl.sh <domain> <email>
#
# Example:
#   sudo bash scripts/setup-ssl.sh api.aiinstaller.dev admin@aiinstaller.dev
#
# Requirements:
#   - Ubuntu 20.04+ / Debian 10+
#   - Root or sudo access
#   - Nginx already installed
#   - Domain DNS pointing to this server
###############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Arguments
DOMAIN="${1:-}"
EMAIL="${2:-}"

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

# Check arguments
check_arguments() {
    if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
        log_error "Missing required arguments"
        echo "Usage: $0 <domain> <email>"
        echo "Example: $0 api.aiinstaller.dev admin@aiinstaller.dev"
        exit 1
    fi

    log_info "Domain: $DOMAIN"
    log_info "Email: $EMAIL"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# Verify DNS
verify_dns() {
    log_info "Verifying DNS configuration..."

    # Get server public IP
    SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "unknown")
    log_info "Server IP: $SERVER_IP"

    # Resolve domain
    DOMAIN_IP=$(dig +short "$DOMAIN" | tail -n1 || echo "unknown")
    log_info "Domain resolves to: $DOMAIN_IP"

    if [ "$SERVER_IP" = "unknown" ] || [ "$DOMAIN_IP" = "unknown" ]; then
        log_warning "Could not verify DNS, continuing anyway..."
        return
    fi

    if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
        log_error "DNS mismatch: $DOMAIN points to $DOMAIN_IP but server IP is $SERVER_IP"
        log_error "Please update DNS records and wait for propagation"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        log_success "DNS configured correctly"
    fi
}

# Install Certbot
install_certbot() {
    log_info "Installing Certbot..."

    if command -v certbot &> /dev/null; then
        log_warning "Certbot is already installed"
        certbot --version
        return
    fi

    apt-get update -y
    apt-get install -y certbot python3-certbot-nginx

    log_success "Certbot installed successfully"
}

# Configure Nginx for ACME challenge
prepare_nginx() {
    log_info "Preparing Nginx for certificate verification..."

    # Create webroot directory
    mkdir -p /var/www/certbot

    # Create temporary Nginx config for HTTP validation
    cat > /etc/nginx/sites-available/certbot-temp <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Server is ready for SSL setup';
        add_header Content-Type text/plain;
    }
}
EOF

    # Enable temporary config
    ln -sf /etc/nginx/sites-available/certbot-temp /etc/nginx/sites-enabled/certbot-temp

    # Test and reload
    nginx -t && systemctl reload nginx

    log_success "Nginx prepared for certificate verification"
}

# Obtain SSL certificate
obtain_certificate() {
    log_info "Obtaining SSL certificate from Let's Encrypt..."

    # Run Certbot
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --domain "$DOMAIN" \
        --non-interactive

    if [ $? -eq 0 ]; then
        log_success "Certificate obtained successfully"
    else
        log_error "Failed to obtain certificate"
        exit 1
    fi

    # Display certificate info
    log_info "Certificate location: /etc/letsencrypt/live/$DOMAIN/"
    ls -la "/etc/letsencrypt/live/$DOMAIN/"
}

# Configure auto-renewal
setup_renewal() {
    log_info "Setting up automatic certificate renewal..."

    # Test renewal
    certbot renew --dry-run

    # Create renewal hook
    cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<EOF
#!/bin/bash
systemctl reload nginx
EOF

    chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

    # Certbot timer is automatically enabled
    systemctl list-timers | grep certbot

    log_success "Auto-renewal configured"
    log_info "Certificates will auto-renew via systemd timer"
}

# Apply SSL configuration to Nginx
apply_nginx_ssl_config() {
    log_info "Applying SSL configuration to Nginx..."

    # Remove temporary config
    rm -f /etc/nginx/sites-enabled/certbot-temp

    # Copy production config with SSL
    cp nginx/aiinstaller.conf /etc/nginx/sites-available/aiinstaller

    # Update domain in config if different
    sed -i "s/api.aiinstaller.dev/$DOMAIN/g" /etc/nginx/sites-available/aiinstaller

    # Create symlink
    ln -sf /etc/nginx/sites-available/aiinstaller /etc/nginx/sites-enabled/aiinstaller

    # Test configuration
    nginx -t

    # Reload Nginx
    systemctl reload nginx

    log_success "SSL configuration applied"
}

# Verify HTTPS
verify_https() {
    log_info "Verifying HTTPS configuration..."

    sleep 2

    # Test HTTP redirect
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/" || echo "000")
    if [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "308" ]; then
        log_success "HTTP to HTTPS redirect working"
    else
        log_warning "HTTP redirect returned code: $HTTP_CODE"
    fi

    # Test HTTPS
    if curl -s --max-time 10 "https://$DOMAIN/" > /dev/null 2>&1; then
        log_success "HTTPS connection successful"
    else
        log_warning "Could not verify HTTPS connection"
    fi

    # Test SSL certificate
    if openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" </dev/null 2>/dev/null | grep -q "Verify return code: 0"; then
        log_success "SSL certificate is valid"
    else
        log_warning "SSL certificate verification failed"
    fi
}

# Display certificate info
show_certificate_info() {
    echo ""
    echo "===================================="
    echo "Certificate Information"
    echo "===================================="
    certbot certificates
}

# Main function
main() {
    echo "===================================="
    echo "AI Installer - SSL Setup"
    echo "===================================="
    echo ""

    check_arguments
    check_root
    verify_dns
    install_certbot
    prepare_nginx
    obtain_certificate
    setup_renewal
    apply_nginx_ssl_config
    verify_https
    show_certificate_info

    echo ""
    echo "===================================="
    echo "SSL Setup Complete!"
    echo "===================================="
    echo ""
    echo "Your server is now secured with HTTPS:"
    echo "  - Domain: $DOMAIN"
    echo "  - WebSocket: wss://$DOMAIN/"
    echo "  - Certificate: /etc/letsencrypt/live/$DOMAIN/"
    echo ""
    echo "Certificate will auto-renew before expiration."
    echo ""
    echo "Test connection:"
    echo "  curl https://$DOMAIN/"
    echo ""
    echo "View renewal timer:"
    echo "  systemctl list-timers | grep certbot"
    echo ""
}

main "$@"
