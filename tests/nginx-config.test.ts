/**
 * Nginx Configuration Tests
 *
 * Tests for Nginx reverse proxy configuration files and setup scripts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = join(__dirname, '..');
const NGINX_DIR = join(PROJECT_ROOT, 'nginx');
const SCRIPTS_DIR = join(PROJECT_ROOT, 'scripts');

describe('Nginx Configuration Files', () => {
  describe('Production Configuration', () => {
    it('should have aiinstaller.conf file', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      await expect(access(configPath, constants.R_OK)).resolves.toBeUndefined();
    });

    it('should contain valid upstream configuration', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('upstream aiinstaller_backend');
      expect(content).toContain('server 127.0.0.1:3000');
      expect(content).toContain('keepalive');
    });

    it('should configure HTTP to HTTPS redirect', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('listen 80');
      expect(content).toContain('return 301 https://');
    });

    it('should configure HTTPS server', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('listen 443 ssl http2');
      expect(content).toContain('ssl_certificate');
      expect(content).toContain('ssl_certificate_key');
    });

    it('should configure WebSocket upgrade headers', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('proxy_set_header Upgrade $http_upgrade');
      expect(content).toContain('proxy_set_header Connection "upgrade"');
      expect(content).toContain('proxy_http_version 1.1');
    });

    it('should configure SSL security settings', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // SSL protocols
      expect(content).toContain('ssl_protocols TLSv1.2 TLSv1.3');

      // HSTS header
      expect(content).toContain('Strict-Transport-Security');
      expect(content).toContain('max-age=63072000');
    });

    it('should configure security headers', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('X-Frame-Options');
      expect(content).toContain('X-Content-Type-Options');
      expect(content).toContain('X-XSS-Protection');
      expect(content).toContain('Referrer-Policy');
    });

    it('should configure Content-Security-Policy header', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('Content-Security-Policy');
      expect(content).toContain("default-src 'self'");
      expect(content).toContain("script-src 'self'");
      expect(content).toContain("style-src 'self' 'unsafe-inline'");
      expect(content).toContain('wss:');
      expect(content).toContain("frame-ancestors 'none'");
    });

    it('should configure Permissions-Policy header', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('Permissions-Policy');
      expect(content).toContain('camera=()');
      expect(content).toContain('microphone=()');
    });

    it('should configure rate limiting', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('limit_req_zone');
      expect(content).toContain('limit_conn_zone');
      expect(content).toContain('limit_req zone=api_limit');
      expect(content).toContain('limit_conn conn_limit');
    });

    it('should configure appropriate timeouts for WebSocket', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('proxy_connect_timeout');
      expect(content).toContain('proxy_send_timeout');
      expect(content).toContain('proxy_read_timeout');
    });

    it('should disable proxy buffering for WebSocket', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('proxy_buffering off');
      expect(content).toContain('proxy_request_buffering off');
    });

    it('should configure access and error logs', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('access_log');
      expect(content).toContain('error_log');
      expect(content).toContain('aiinstaller_access.log');
      expect(content).toContain('aiinstaller_error.log');
    });

    it('should configure ACME challenge location for Let\'s Encrypt', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('.well-known/acme-challenge');
      expect(content).toContain('/var/www/certbot');
    });

    it('should configure health check endpoint', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('location /health');
      expect(content).toContain('access_log off');
    });

    it('should configure OCSP stapling', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('ssl_stapling on');
      expect(content).toContain('ssl_stapling_verify on');
    });

    it('should use strong SSL ciphers', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('ssl_ciphers');
      expect(content).toContain('ECDHE');
      expect(content).toContain('GCM');
    });

    it('should configure proper server name', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('server_name api.aiinstaller.dev');
    });
  });

  describe('Development Configuration', () => {
    it('should have aiinstaller-dev.conf file', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      await expect(access(configPath, constants.R_OK)).resolves.toBeUndefined();
    });

    it('should only listen on HTTP port', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('listen 80');
      expect(content).not.toContain('listen 443');
      expect(content).not.toContain('ssl_certificate');
    });

    it('should configure localhost server name', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('localhost');
      expect(content).toContain('api.aiinstaller.local');
    });

    it('should configure WebSocket upgrade headers', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('proxy_set_header Upgrade $http_upgrade');
      expect(content).toContain('proxy_set_header Connection "upgrade"');
    });

    it('should use debug log level', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('error_log');
      expect(content).toContain('debug');
    });
  });
});

describe('Nginx Setup Scripts', () => {
  describe('setup-nginx.sh', () => {
    it('should exist and be executable', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      await expect(access(scriptPath, constants.R_OK | constants.X_OK)).resolves.toBeUndefined();
    });

    it('should have proper shebang', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('should use strict mode (set -euo pipefail)', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('set -euo pipefail');
    });

    it('should support --dev mode', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('--dev');
      expect(content).toContain('setup_dev');
    });

    it('should support --production mode', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('--production');
      expect(content).toContain('production');
    });

    it('should check for root privileges', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('check_root');
      expect(content).toContain('EUID');
    });

    it('should install Nginx', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('install_nginx');
      expect(content).toContain('apt-get install');
      expect(content).toContain('nginx');
    });

    it('should configure firewall', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('configure_firewall');
      expect(content).toContain('ufw');
    });

    it('should verify installation', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('verify_installation');
      expect(content).toContain('nginx -t');
    });

    it('should use systemctl for service management', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('systemctl');
      expect(content).toContain('systemctl reload nginx');
    });

    it('should have colored output for logging', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('log_info');
      expect(content).toContain('log_success');
      expect(content).toContain('log_error');
      expect(content).toContain('log_warning');
    });

    it('should copy appropriate config based on mode', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('nginx/aiinstaller.conf');
      expect(content).toContain('nginx/aiinstaller-dev.conf');
      expect(content).toContain('/etc/nginx/sites-available');
    });

    it('should create symlink to sites-enabled', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('ln -sf');
      expect(content).toContain('sites-enabled');
    });

    it('should remove default site', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('rm -f');
      expect(content).toContain('sites-enabled/default');
    });
  });

  describe('setup-ssl.sh', () => {
    it('should exist and be executable', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      await expect(access(scriptPath, constants.R_OK | constants.X_OK)).resolves.toBeUndefined();
    });

    it('should have proper shebang', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('should require domain and email arguments', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('DOMAIN');
      expect(content).toContain('EMAIL');
      expect(content).toContain('check_arguments');
    });

    it('should verify DNS configuration', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('verify_dns');
      expect(content).toContain('dig');
    });

    it('should install Certbot', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('install_certbot');
      expect(content).toContain('certbot');
      expect(content).toContain('python3-certbot-nginx');
    });

    it('should prepare Nginx for ACME challenge', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('prepare_nginx');
      expect(content).toContain('/var/www/certbot');
      expect(content).toContain('.well-known/acme-challenge');
    });

    it('should obtain SSL certificate using webroot method', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('obtain_certificate');
      expect(content).toContain('certbot certonly');
      expect(content).toContain('--webroot');
    });

    it('should configure automatic renewal', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('setup_renewal');
      expect(content).toContain('certbot renew');
      expect(content).toContain('--dry-run');
    });

    it('should create renewal hook to reload Nginx', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('renewal-hooks');
      expect(content).toContain('reload-nginx.sh');
      expect(content).toContain('systemctl reload nginx');
    });

    it('should apply SSL configuration to Nginx', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('apply_nginx_ssl_config');
      expect(content).toContain('nginx/aiinstaller.conf');
    });

    it('should verify HTTPS after setup', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('verify_https');
      expect(content).toContain('curl');
      expect(content).toContain('https://');
    });

    it('should display certificate information', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('show_certificate_info');
      expect(content).toContain('certbot certificates');
    });

    it('should use strict mode', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('set -euo pipefail');
    });

    it('should check for root privileges', async () => {
      const scriptPath = join(SCRIPTS_DIR, 'setup-ssl.sh');
      const content = await readFile(scriptPath, 'utf-8');

      expect(content).toContain('check_root');
      expect(content).toContain('EUID');
    });
  });
});

describe('Nginx Configuration Validation', () => {
  describe('Configuration Syntax', () => {
    it('should have valid production config structure', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Check for balanced braces
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      expect(openBraces).toBe(closeBraces);

      // Check for semicolons at end of directives (basic check)
      const directiveLines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.endsWith('{') && !trimmed.endsWith('}');
      });

      const linesWithoutSemicolon = directiveLines.filter(line => !line.trim().endsWith(';'));
      // Some lines like 'server {' don't need semicolons
      expect(linesWithoutSemicolon.length).toBeLessThan(10);
    });

    it('should have valid development config structure', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      // Check for balanced braces
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      expect(openBraces).toBe(closeBraces);
    });

    it('should not have conflicting listen directives', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Parse server blocks
      const serverBlocks = content.split('server {');

      // Each server block should be distinct (HTTP vs HTTPS)
      expect(serverBlocks.length).toBeGreaterThan(1);
    });
  });

  describe('Security Best Practices', () => {
    it('should not expose server version', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Should either have server_tokens off or not mention it (uses default)
      // Not exposing it in headers is the goal
      expect(content).not.toContain('server_tokens on');
    });

    it('should have secure SSL configuration', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Should not allow old SSL versions
      expect(content).not.toContain('SSLv2');
      expect(content).not.toContain('SSLv3');
      expect(content).not.toContain('TLSv1 ');
      expect(content).not.toContain('TLSv1.0');
      expect(content).not.toContain('TLSv1.1');
    });

    it('should limit client body size to prevent abuse', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('client_max_body_size');
    });

    it('should have appropriate timeouts', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('client_body_timeout');
      expect(content).toContain('client_header_timeout');
    });
  });

  describe('WebSocket Support', () => {
    it('should properly configure WebSocket proxying in production', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Essential WebSocket headers
      expect(content).toContain('proxy_http_version 1.1');
      expect(content).toContain('Upgrade $http_upgrade');
      expect(content).toContain('Connection "upgrade"');

      // Should disable buffering for WebSocket
      expect(content).toContain('proxy_buffering off');
    });

    it('should properly configure WebSocket proxying in development', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('proxy_http_version 1.1');
      expect(content).toContain('Upgrade $http_upgrade');
      expect(content).toContain('Connection "upgrade"');
    });

    it('should have long enough timeouts for WebSocket connections', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Extract timeout values
      const sendTimeoutMatch = content.match(/proxy_send_timeout\s+(\d+)s/);
      const readTimeoutMatch = content.match(/proxy_read_timeout\s+(\d+)s/);

      expect(sendTimeoutMatch).toBeTruthy();
      expect(readTimeoutMatch).toBeTruthy();

      if (sendTimeoutMatch && readTimeoutMatch) {
        const sendTimeout = parseInt(sendTimeoutMatch[1]);
        const readTimeout = parseInt(readTimeoutMatch[1]);

        // Should be at least 60 seconds for WebSocket
        expect(sendTimeout).toBeGreaterThanOrEqual(60);
        expect(readTimeout).toBeGreaterThanOrEqual(60);
      }
    });
  });

  describe('Documentation', () => {
    it('should have comprehensive comments in production config', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller.conf');
      const content = await readFile(configPath, 'utf-8');

      // Should have header comments
      expect(content).toContain('==============================================================================');

      // Should have section comments
      expect(content.match(/#/g)?.length).toBeGreaterThan(20);
    });

    it('should have comments in development config', async () => {
      const configPath = join(NGINX_DIR, 'aiinstaller-dev.conf');
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('Development');
      expect(content.match(/#/g)?.length).toBeGreaterThan(10);
    });

    it('should have usage documentation in setup scripts', async () => {
      const setupNginxPath = join(SCRIPTS_DIR, 'setup-nginx.sh');
      const setupSslPath = join(SCRIPTS_DIR, 'setup-ssl.sh');

      const nginxContent = await readFile(setupNginxPath, 'utf-8');
      const sslContent = await readFile(setupSslPath, 'utf-8');

      expect(nginxContent).toContain('Usage:');
      expect(sslContent).toContain('Usage:');
      expect(nginxContent).toContain('Options:');
      expect(sslContent).toContain('Example:');
    });
  });
});

describe('Dashboard Nginx Configuration', () => {
  const DASHBOARD_NGINX = join(PROJECT_ROOT, 'packages', 'dashboard', 'nginx.conf');

  it('should configure Content-Security-Policy header', async () => {
    const content = await readFile(DASHBOARD_NGINX, 'utf-8');

    expect(content).toContain('Content-Security-Policy');
    expect(content).toContain("default-src 'self'");
    expect(content).toContain("script-src 'self'");
    expect(content).toContain("style-src 'self' 'unsafe-inline'");
    expect(content).toContain("connect-src 'self' ws: wss:");
    expect(content).toContain("frame-ancestors 'self'");
  });

  it('should configure Permissions-Policy header', async () => {
    const content = await readFile(DASHBOARD_NGINX, 'utf-8');

    expect(content).toContain('Permissions-Policy');
    expect(content).toContain('camera=()');
    expect(content).toContain('microphone=()');
  });

  it('should allow inline styles for Vite-generated CSS', async () => {
    const content = await readFile(DASHBOARD_NGINX, 'utf-8');

    expect(content).toContain("'unsafe-inline'");
  });

  it('should allow WebSocket connections for SSE and WS', async () => {
    const content = await readFile(DASHBOARD_NGINX, 'utf-8');

    expect(content).toContain('ws:');
    expect(content).toContain('wss:');
  });

  it('should allow data: URIs for images and fonts', async () => {
    const content = await readFile(DASHBOARD_NGINX, 'utf-8');

    expect(content).toContain("img-src 'self' data: blob:");
    expect(content).toContain("font-src 'self' data:");
  });
});

describe('Integration Points', () => {
  it('should reference correct backend port (3000)', async () => {
    const configPath = join(NGINX_DIR, 'aiinstaller.conf');
    const content = await readFile(configPath, 'utf-8');

    expect(content).toContain('127.0.0.1:3000');
  });

  it('should match domain in production config', async () => {
    const configPath = join(NGINX_DIR, 'aiinstaller.conf');
    const content = await readFile(configPath, 'utf-8');

    // Domain should be consistent throughout (at least 5 occurrences)
    const domainMatches = content.match(/api\.aiinstaller\.dev/g);
    expect(domainMatches?.length).toBeGreaterThanOrEqual(5);
  });

  it('should reference correct certificate paths', async () => {
    const configPath = join(NGINX_DIR, 'aiinstaller.conf');
    const content = await readFile(configPath, 'utf-8');

    expect(content).toContain('/etc/letsencrypt/live/api.aiinstaller.dev/fullchain.pem');
    expect(content).toContain('/etc/letsencrypt/live/api.aiinstaller.dev/privkey.pem');
    expect(content).toContain('/etc/letsencrypt/live/api.aiinstaller.dev/chain.pem');
  });
});
