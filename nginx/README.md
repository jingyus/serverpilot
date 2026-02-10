# Nginx Reverse Proxy Configuration

This directory contains Nginx configurations for AI Installer's WebSocket reverse proxy.

## 📁 Files

| File | Purpose |
|------|---------|
| `aiinstaller.conf` | Production configuration with HTTPS/WSS support |
| `aiinstaller-dev.conf` | Development configuration (HTTP/WS only) |

## 🚀 Quick Start

### Development Setup

```bash
# Install and configure Nginx for local development
sudo bash scripts/setup-nginx.sh --dev

# Test connection
curl http://localhost/
```

### Production Setup

```bash
# Step 1: Install Nginx with HTTP configuration
sudo bash scripts/setup-nginx.sh --production

# Step 2: Configure SSL (requires DNS pointing to server)
sudo bash scripts/setup-ssl.sh api.aiinstaller.dev admin@aiinstaller.dev

# Verify HTTPS
curl https://api.aiinstaller.dev/
```

## 📋 Configuration Features

### Production Configuration (`aiinstaller.conf`)

**Security:**
- ✅ TLS 1.2 and 1.3 only
- ✅ Strong cipher suites
- ✅ HSTS with preload
- ✅ OCSP Stapling
- ✅ Security headers (X-Frame-Options, CSP, etc.)
- ✅ Rate limiting (10 req/s, burst 20)
- ✅ Connection limiting (10 per IP)

**WebSocket Support:**
- ✅ HTTP/1.1 upgrade
- ✅ Proper upgrade headers
- ✅ Long timeouts (300s)
- ✅ Buffering disabled
- ✅ Keep-alive connections

**SSL/TLS:**
- ✅ Let's Encrypt certificates
- ✅ Automatic HTTP → HTTPS redirect
- ✅ ACME challenge support
- ✅ Certificate auto-renewal

**Logging:**
- ✅ Access logs: `/var/log/nginx/aiinstaller_access.log`
- ✅ Error logs: `/var/log/nginx/aiinstaller_error.log`

### Development Configuration (`aiinstaller-dev.conf`)

**Features:**
- HTTP only (no SSL overhead)
- Debug logging enabled
- Works with `localhost` and `api.aiinstaller.local`
- Same WebSocket support as production

## 🔧 Configuration Details

### Upstream Backend

```nginx
upstream aiinstaller_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}
```

The configuration expects the AI Installer server to be running on `localhost:3000`.

### Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
```

- **Rate limit**: 10 requests/second per IP, with burst up to 20
- **Connection limit**: 10 concurrent connections per IP

### WebSocket Configuration

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_buffering off;
proxy_read_timeout 300s;
```

Essential for maintaining long-lived WebSocket connections.

## 🛠️ Management Commands

### Check Configuration

```bash
# Test configuration syntax
sudo nginx -t

# View configuration
cat /etc/nginx/sites-enabled/aiinstaller
```

### Service Management

```bash
# Status
sudo systemctl status nginx

# Start/Stop/Restart
sudo systemctl start nginx
sudo systemctl stop nginx
sudo systemctl restart nginx

# Reload (zero downtime)
sudo systemctl reload nginx
```

### View Logs

```bash
# Access logs
sudo tail -f /var/log/nginx/aiinstaller_access.log

# Error logs
sudo tail -f /var/log/nginx/aiinstaller_error.log

# All Nginx logs
sudo tail -f /var/log/nginx/*.log
```

### SSL Certificate Management

```bash
# View certificates
sudo certbot certificates

# Test renewal (dry run)
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal

# Check auto-renewal timer
systemctl list-timers | grep certbot
```

## 📊 Monitoring

### Health Check

The configuration exposes a health check endpoint:

```bash
# HTTP
curl http://localhost/health

# HTTPS
curl https://api.aiinstaller.dev/health
```

### Connection Testing

```bash
# Test WebSocket connection (development)
wscat -c ws://localhost/

# Test WebSocket connection (production)
wscat -c wss://api.aiinstaller.dev/

# Test with AI Installer client
./install-agent-darwin-arm64 openclaw --server wss://api.aiinstaller.dev --dry-run
```

### Performance Metrics

```bash
# Active connections
sudo ss -an | grep :443 | wc -l

# Nginx status (requires stub_status module)
curl http://localhost/nginx_status
```

## 🔒 Security Considerations

### Firewall Configuration

The setup script automatically configures UFW:

```bash
sudo ufw allow 'Nginx Full'  # Allows ports 80 and 443
```

### SSL Best Practices

- ✅ Certificates auto-renew before expiration
- ✅ OCSP Stapling reduces client latency
- ✅ HSTS prevents protocol downgrade attacks
- ✅ Strong ciphers only (no SSLv3, TLSv1.0, TLSv1.1)

### Rate Limiting

Protects against:
- DoS attacks
- API abuse
- Resource exhaustion

Legitimate clients should never hit these limits.

## 🐛 Troubleshooting

### Nginx won't start

```bash
# Check configuration
sudo nginx -t

# Check if port is already in use
sudo lsof -i :80
sudo lsof -i :443

# View error logs
sudo journalctl -u nginx -n 50
```

### SSL certificate issues

```bash
# Verify certificate
sudo openssl x509 -in /etc/letsencrypt/live/api.aiinstaller.dev/fullchain.pem -text -noout

# Test SSL connection
openssl s_client -connect api.aiinstaller.dev:443 -servername api.aiinstaller.dev

# Check certificate expiration
sudo certbot certificates
```

### WebSocket connection fails

1. Check backend is running:
   ```bash
   curl http://localhost:3000
   ```

2. Check Nginx is proxying:
   ```bash
   sudo tail -f /var/log/nginx/aiinstaller_error.log
   ```

3. Verify upgrade headers:
   ```bash
   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost/
   ```

### Backend connection refused

```bash
# Ensure AI Installer server is running
docker compose ps
docker compose logs server

# Check if backend port is open
curl http://localhost:3000
```

## 📚 References

- [Nginx WebSocket Proxying](http://nginx.org/en/docs/http/websocket.html)
- [Nginx SSL/TLS Configuration](https://ssl-config.mozilla.org/#server=nginx)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Security Headers Best Practices](https://securityheaders.com/)

## 🧪 Testing

Run the comprehensive test suite:

```bash
# Run Nginx configuration tests
pnpm test tests/nginx-config.test.ts

# Expected: 65 tests pass
```

Tests cover:
- Configuration file validity
- Security settings
- WebSocket configuration
- SSL/TLS settings
- Rate limiting
- Script functionality

## 📝 Notes

- The configuration assumes the domain `api.aiinstaller.dev`. Update this in production if using a different domain.
- SSL certificates require valid DNS records pointing to your server.
- The setup scripts are designed for Ubuntu 20.04+ / Debian 10+.
- Development configuration uses debug logging for easier troubleshooting.

## 🤝 Contributing

When modifying configurations:

1. Test locally with `--dev` mode first
2. Run the test suite: `pnpm test tests/nginx-config.test.ts`
3. Verify configuration syntax: `nginx -t`
4. Update this README if adding new features

## 📄 License

Part of the AI Installer project.
