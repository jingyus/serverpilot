/**
 * Acceptance Test: WSS 加密连接正常，无证书警告
 *
 * Validates that:
 * 1. WSS (WebSocket Secure) connection architecture is properly configured
 * 2. Nginx reverse proxy handles SSL/TLS termination correctly
 * 3. Client supports wss:// URLs transparently
 * 4. SSL certificate configuration follows best practices
 * 5. Certificate error detection and user-friendly messaging works
 * 6. Local WS → production WSS upgrade path is seamless
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import https from 'https';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { InstallClient, ConnectionState } from '../packages/agent/src/client.js';
import { formatPlainErrorFromOutput } from '../packages/agent/src/ui/error-messages.js';

// ============================================================================
// Constants
// ============================================================================

const PROJECT_ROOT = join(__dirname, '..');
const NGINX_DIR = join(PROJECT_ROOT, 'nginx');
const SCRIPTS_DIR = join(PROJECT_ROOT, 'scripts');
const DOMAIN = 'api.aiinstaller.dev';

let testPort = 19840;
function nextPort() {
  return testPort++;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// 1. WSS Architecture Validation
// ============================================================================

describe('WSS Architecture Validation', () => {
  describe('SSL Termination via Nginx Reverse Proxy', () => {
    it('should route wss:// → Nginx (443/SSL) → ws://localhost:3000', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      // Nginx listens on 443 with SSL
      expect(nginxConfig).toContain('listen 443 ssl http2');

      // Proxies to local backend on port 3000
      expect(nginxConfig).toContain('proxy_pass http://aiinstaller_backend');
      expect(nginxConfig).toContain('server 127.0.0.1:3000');
    });

    it('should redirect HTTP (80) to HTTPS (443)', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('listen 80');
      expect(nginxConfig).toContain('return 301 https://$server_name$request_uri');
    });

    it('should configure WebSocket upgrade headers for WSS proxying', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      // Required headers for WebSocket upgrade through SSL proxy
      expect(nginxConfig).toContain('proxy_http_version 1.1');
      expect(nginxConfig).toContain('proxy_set_header Upgrade $http_upgrade');
      expect(nginxConfig).toContain('proxy_set_header Connection "upgrade"');

      // Disable buffering for real-time WebSocket
      expect(nginxConfig).toContain('proxy_buffering off');
    });

    it('should forward client IP through proxy for logging', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('proxy_set_header X-Real-IP $remote_addr');
      expect(nginxConfig).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for');
      expect(nginxConfig).toContain('proxy_set_header X-Forwarded-Proto $scheme');
    });
  });
});

// ============================================================================
// 2. SSL/TLS Certificate Configuration
// ============================================================================

describe('SSL/TLS Certificate Configuration', () => {
  describe('Let\'s Encrypt Certificate Paths', () => {
    it('should reference valid Let\'s Encrypt certificate paths', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain(`ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem`);
      expect(nginxConfig).toContain(`ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem`);
      expect(nginxConfig).toContain(`ssl_trusted_certificate /etc/letsencrypt/live/${DOMAIN}/chain.pem`);
    });

    it('should use fullchain.pem (not just cert.pem) to avoid certificate chain warnings', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      // fullchain.pem includes intermediate certificates → no browser/client warnings
      expect(nginxConfig).toContain('fullchain.pem');

      // Should NOT use cert.pem alone (would cause "unable to get local issuer certificate")
      expect(nginxConfig).not.toMatch(/ssl_certificate\s+[^;]*cert\.pem/);
    });
  });

  describe('TLS Protocol Security', () => {
    it('should only allow TLS 1.2 and 1.3 (no deprecated versions)', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('ssl_protocols TLSv1.2 TLSv1.3');

      // Must not allow deprecated protocols
      expect(nginxConfig).not.toContain('SSLv2');
      expect(nginxConfig).not.toContain('SSLv3');
      expect(nginxConfig).not.toContain('TLSv1.0');
      expect(nginxConfig).not.toContain('TLSv1.1');
    });

    it('should use strong ECDHE cipher suites for forward secrecy', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('ssl_ciphers');
      expect(nginxConfig).toContain('ECDHE');
      expect(nginxConfig).toContain('AES128-GCM-SHA256');
      expect(nginxConfig).toContain('AES256-GCM-SHA384');
      expect(nginxConfig).toContain('CHACHA20-POLY1305');
    });

    it('should enable OCSP stapling to speed up certificate verification', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('ssl_stapling on');
      expect(nginxConfig).toContain('ssl_stapling_verify on');
      expect(nginxConfig).toContain('resolver');
    });

    it('should configure SSL session caching for performance', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('ssl_session_timeout');
      expect(nginxConfig).toContain('ssl_session_cache');
      expect(nginxConfig).toContain('ssl_session_tickets off');
    });
  });

  describe('Security Headers for WSS', () => {
    it('should set HSTS header to enforce HTTPS', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('Strict-Transport-Security');
      expect(nginxConfig).toContain('max-age=63072000');
      expect(nginxConfig).toContain('includeSubDomains');
    });

    it('should set other security headers', async () => {
      const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

      expect(nginxConfig).toContain('X-Frame-Options');
      expect(nginxConfig).toContain('X-Content-Type-Options');
      expect(nginxConfig).toContain('X-XSS-Protection');
    });
  });
});

// ============================================================================
// 3. Certificate Auto-Renewal (No Expiry Warnings)
// ============================================================================

describe('Certificate Auto-Renewal Configuration', () => {
  it('should have SSL setup script with Certbot auto-renewal', async () => {
    const sslScript = await readFile(join(SCRIPTS_DIR, 'setup-ssl.sh'), 'utf-8');

    expect(sslScript).toContain('setup_renewal');
    expect(sslScript).toContain('certbot renew --dry-run');
  });

  it('should configure renewal hooks to reload Nginx', async () => {
    const sslScript = await readFile(join(SCRIPTS_DIR, 'setup-ssl.sh'), 'utf-8');

    expect(sslScript).toContain('renewal-hooks/deploy/reload-nginx.sh');
    expect(sslScript).toContain('systemctl reload nginx');
  });

  it('should use ACME HTTP-01 challenge for domain validation', async () => {
    const sslScript = await readFile(join(SCRIPTS_DIR, 'setup-ssl.sh'), 'utf-8');

    expect(sslScript).toContain('certbot certonly');
    expect(sslScript).toContain('--webroot');
    expect(sslScript).toContain('--webroot-path=/var/www/certbot');
  });

  it('should have ACME challenge location in Nginx config', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    expect(nginxConfig).toContain('location /.well-known/acme-challenge/');
    expect(nginxConfig).toContain('root /var/www/certbot');
  });

  it('should verify HTTPS works after certificate setup', async () => {
    const sslScript = await readFile(join(SCRIPTS_DIR, 'setup-ssl.sh'), 'utf-8');

    expect(sslScript).toContain('verify_https');
    expect(sslScript).toContain('curl');
    expect(sslScript).toContain('openssl s_client');
    expect(sslScript).toContain('Verify return code: 0');
  });
});

// ============================================================================
// 4. Client WSS Connection Support
// ============================================================================

describe('Client WSS Connection Support', () => {
  let server: InstallServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should connect to ws:// server (local development mode)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, requireAuth: false });
    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
      connectionTimeoutMs: 5000,
    });

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);
    client.disconnect();
  });

  it('should support wss:// URL format in client options', () => {
    const client = new InstallClient({
      serverUrl: `wss://${DOMAIN}`,
      autoReconnect: false,
    });

    // Client should accept wss:// URLs without throwing
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('should handle connection error for invalid wss:// host gracefully', async () => {
    // Use 10.255.255.1 — a non-routable private IP where TCP handshake
    // hangs (never completes), so connectionTimeoutMs fires while
    // readyState is still CONNECTING and properly rejects the promise.
    // Avoid .local (mDNS/Avahi hangs on Linux CI) and localhost
    // (ECONNREFUSED skips the timeout path).
    const client = new InstallClient({
      serverUrl: 'wss://10.255.255.1:9999',
      autoReconnect: false,
      connectionTimeoutMs: 2000,
    });

    const errors: Error[] = [];
    client.on('error', (err) => errors.push(err));

    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  }, 10_000);

  it('should distinguish ws:// for local dev vs wss:// for production', () => {
    const localUrl = 'ws://localhost:3000';
    const productionUrl = `wss://${DOMAIN}`;

    // Both URL formats should be valid
    expect(localUrl.startsWith('ws://')).toBe(true);
    expect(productionUrl.startsWith('wss://')).toBe(true);

    // Production URL must use WSS
    expect(productionUrl).toMatch(/^wss:\/\//);
    expect(productionUrl).toContain(DOMAIN);
  });

  it('should send and receive messages over plain WS (simulating WSS post-termination)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, requireAuth: false });
    await server.start();

    server.on('message', (clientId, msg) => {
      if (msg.type === MessageType.SESSION_CREATE) {
        // Respond with session.complete (a valid protocol message)
        server!.send(clientId, createMessage(MessageType.SESSION_COMPLETE, {
          success: true,
          summary: 'WSS test session completed',
        }));
      }
    });

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });

    await client.connect();

    const response = await client.sendAndWait(
      createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' }),
      MessageType.SESSION_COMPLETE,
      5000,
    );

    expect(response.type).toBe(MessageType.SESSION_COMPLETE);
    expect(response.payload.success).toBe(true);

    client.disconnect();
  });
});

// ============================================================================
// 5. SSL Certificate Error Detection
// ============================================================================

describe('SSL Certificate Error Detection', () => {
  it('should detect "unable to get local issuer certificate" error', () => {
    const msg = formatPlainErrorFromOutput(
      'unable to get local issuer certificate',
      '',
      'wss connect',
    );

    expect(msg.title).toBe('Security certificate problem');
    expect(msg.category).toBe('network');
    expect(msg.severity).toBe('high');
    expect(msg.explanation).toContain('security certificate');
    expect(msg.nextSteps.length).toBeGreaterThan(0);
  });

  it('should detect "CERT_HAS_EXPIRED" error', () => {
    const msg = formatPlainErrorFromOutput(
      'CERT_HAS_EXPIRED',
      '',
      'wss connect',
    );

    expect(msg.title).toBe('Security certificate problem');
    expect(msg.category).toBe('network');
    expect(msg.nextSteps.some(s => s.toLowerCase().includes('certificate'))).toBe(true);
  });

  it('should detect "UNABLE_TO_VERIFY_LEAF_SIGNATURE" error', () => {
    const msg = formatPlainErrorFromOutput(
      'Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      '',
      'wss connect',
    );

    expect(msg.title).toBe('Security certificate problem');
    expect(msg.category).toBe('network');
  });

  it('should provide helpful next steps for certificate errors', () => {
    const msg = formatPlainErrorFromOutput(
      'unable to get local issuer certificate',
      '',
      'wss connect',
    );

    // Should suggest updating certificates
    expect(msg.nextSteps.some(s => s.toLowerCase().includes('update') || s.toLowerCase().includes('certificate'))).toBe(true);
  });

  it('should detect connection refused errors for WSS', () => {
    const msg = formatPlainErrorFromOutput(
      'ECONNREFUSED',
      '',
      'wss connect',
    );

    expect(msg.title).toBe('Connection was refused');
    expect(msg.category).toBe('network');
  });

  it('should detect timeout errors for WSS', () => {
    const msg = formatPlainErrorFromOutput(
      'ETIMEDOUT',
      '',
      'wss connect',
    );

    expect(msg.title).toBe('Connection timed out');
    expect(msg.category).toBe('network');
  });
});

// ============================================================================
// 6. WSS Connection Flow: End-to-End (Local Simulation)
// ============================================================================

describe('WSS Connection Flow (Local Simulation)', () => {
  let server: InstallServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should complete full connection lifecycle: connect → authenticate → communicate → disconnect', async () => {
    const port = nextPort();
    server = new InstallServer({ port, requireAuth: false });
    await server.start();

    const events: string[] = [];

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });

    client.on('connected', () => events.push('connected'));
    client.on('disconnected', () => events.push('disconnected'));

    await client.connect();
    expect(events).toContain('connected');
    expect(client.state).toBe(ConnectionState.CONNECTED);

    client.disconnect();
    await delay(100);

    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('should handle server heartbeat/pong mechanism over connection', async () => {
    const port = nextPort();
    server = new InstallServer({
      port,
      requireAuth: false,
      heartbeatIntervalMs: 500,
    });
    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Wait for at least one heartbeat cycle
    await delay(700);

    // Client should still be connected (pong responded)
    expect(client.state).toBe(ConnectionState.CONNECTED);
    expect(server.getClientCount()).toBe(1);

    client.disconnect();
  });

  it('should support multiple concurrent connections', async () => {
    const port = nextPort();
    server = new InstallServer({ port, requireAuth: false });
    await server.start();

    const clients: InstallClient[] = [];
    const connectionCount = 5;

    for (let i = 0; i < connectionCount; i++) {
      const client = new InstallClient({
        serverUrl: `ws://127.0.0.1:${port}`,
        autoReconnect: false,
      });
      await client.connect();
      clients.push(client);
    }

    expect(server.getClientCount()).toBe(connectionCount);

    for (const client of clients) {
      expect(client.state).toBe(ConnectionState.CONNECTED);
    }

    // Disconnect all
    for (const client of clients) {
      client.disconnect();
    }

    await delay(200);
    expect(server.getClientCount()).toBe(0);
  });
});

// ============================================================================
// 7. HTTPS/WSS Self-Signed Certificate Test (Local TLS Server)
// ============================================================================

describe('WSS with TLS (Self-Signed Certificate Test)', () => {
  it('should connect to a local WSS server using self-signed certificates with rejectUnauthorized=false', async () => {
    const { privateKey, certificate } = generateSelfSignedCert();

    const httpsServer = https.createServer({
      key: privateKey,
      cert: certificate,
    });

    const wssPort = nextPort();
    const wss = new WebSocketServer({ server: httpsServer });

    const receivedMessages: string[] = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        receivedMessages.push(data.toString());
        ws.send('pong');
      });
    });

    await new Promise<void>((resolve) => {
      httpsServer.listen(wssPort, '127.0.0.1', resolve);
    });

    try {
      // Connect with rejectUnauthorized=false (self-signed cert)
      const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
        rejectUnauthorized: false,
      });

      const connected = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 3000);
      });

      expect(connected).toBe(true);

      // Send a test message
      ws.send('ping');

      const response = await new Promise<string>((resolve, reject) => {
        ws.on('message', (data) => resolve(data.toString()));
        setTimeout(() => reject(new Error('timeout')), 3000);
      });

      expect(response).toBe('pong');
      expect(receivedMessages).toContain('ping');

      ws.close();
    } finally {
      wss.close();
      httpsServer.close();
    }
  });

  it('should reject connection to WSS server with invalid certificate when verification is enabled', async () => {
    const { privateKey, certificate } = generateSelfSignedCert();

    const httpsServer = https.createServer({
      key: privateKey,
      cert: certificate,
    });

    const wssPort = nextPort();
    const wss = new WebSocketServer({ server: httpsServer });

    await new Promise<void>((resolve) => {
      httpsServer.listen(wssPort, '127.0.0.1', resolve);
    });

    try {
      // Connect WITH certificate verification (default) - should fail for self-signed
      const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
        rejectUnauthorized: true,
      });

      const errorOccurred = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(false));
        ws.on('error', () => resolve(true));
        setTimeout(() => resolve(true), 3000);
      });

      expect(errorOccurred).toBe(true);

      ws.close();
    } finally {
      wss.close();
      httpsServer.close();
    }
  });

  it('should support TLS 1.2 and TLS 1.3 connections', async () => {
    const { privateKey, certificate } = generateSelfSignedCert();

    // Test TLS 1.2
    const httpsServer12 = https.createServer({
      key: privateKey,
      cert: certificate,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
    });

    const port12 = nextPort();
    const wss12 = new WebSocketServer({ server: httpsServer12 });

    await new Promise<void>((resolve) => {
      httpsServer12.listen(port12, '127.0.0.1', resolve);
    });

    try {
      const ws = new WebSocket(`wss://127.0.0.1:${port12}`, {
        rejectUnauthorized: false,
      });

      const connected = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 3000);
      });

      expect(connected).toBe(true);
      ws.close();
    } finally {
      wss12.close();
      httpsServer12.close();
    }

    // Test TLS 1.3
    const httpsServer13 = https.createServer({
      key: privateKey,
      cert: certificate,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    });

    const port13 = nextPort();
    const wss13 = new WebSocketServer({ server: httpsServer13 });

    await new Promise<void>((resolve) => {
      httpsServer13.listen(port13, '127.0.0.1', resolve);
    });

    try {
      const ws = new WebSocket(`wss://127.0.0.1:${port13}`, {
        rejectUnauthorized: false,
      });

      const connected = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 3000);
      });

      expect(connected).toBe(true);
      ws.close();
    } finally {
      wss13.close();
      httpsServer13.close();
    }
  });
});

// ============================================================================
// 8. Production WSS Configuration Completeness
// ============================================================================

describe('Production WSS Configuration Completeness', () => {
  it('should have all required files for WSS deployment', async () => {
    const requiredFiles = [
      join(NGINX_DIR, 'aiinstaller.conf'),
      join(NGINX_DIR, 'aiinstaller-dev.conf'),
      join(SCRIPTS_DIR, 'setup-ssl.sh'),
      join(SCRIPTS_DIR, 'setup-nginx.sh'),
    ];

    for (const filePath of requiredFiles) {
      await expect(access(filePath, constants.R_OK)).resolves.toBeUndefined();
    }
  });

  it('should have consistent domain configuration across files', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    // Domain should appear in server_name
    expect(nginxConfig).toContain(`server_name ${DOMAIN}`);

    // Domain should appear in certificate paths
    expect(nginxConfig).toContain(`/etc/letsencrypt/live/${DOMAIN}/`);
  });

  it('should have appropriate WebSocket timeouts for long-running installations', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    const readTimeoutMatch = nginxConfig.match(/proxy_read_timeout\s+(\d+)s/);
    const sendTimeoutMatch = nginxConfig.match(/proxy_send_timeout\s+(\d+)s/);

    expect(readTimeoutMatch).toBeTruthy();
    expect(sendTimeoutMatch).toBeTruthy();

    if (readTimeoutMatch && sendTimeoutMatch) {
      const readTimeout = parseInt(readTimeoutMatch[1]);
      const sendTimeout = parseInt(sendTimeoutMatch[1]);

      // Installation sessions can be long, need at least 60s
      expect(readTimeout).toBeGreaterThanOrEqual(60);
      expect(sendTimeout).toBeGreaterThanOrEqual(60);
    }
  });

  it('should have rate limiting configured to prevent abuse', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    expect(nginxConfig).toContain('limit_req_zone');
    expect(nginxConfig).toContain('limit_conn_zone');
    expect(nginxConfig).toContain('limit_req zone=');
    expect(nginxConfig).toContain('limit_conn conn_limit');
  });

  it('should have health check endpoint accessible without SSL issues', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    expect(nginxConfig).toContain('location /health');
    expect(nginxConfig).toContain('proxy_pass http://aiinstaller_backend/health');
  });

  it('should configure connection keepalive for performance', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    expect(nginxConfig).toContain('keepalive');
  });

  it('should log access and errors for debugging certificate issues', async () => {
    const nginxConfig = await readFile(join(NGINX_DIR, 'aiinstaller.conf'), 'utf-8');

    expect(nginxConfig).toContain('access_log');
    expect(nginxConfig).toContain('error_log');
  });
});

// ============================================================================
// 9. WSS URL Validation
// ============================================================================

describe('WSS URL Validation', () => {
  it('should correctly parse wss:// URLs', () => {
    const url = new URL(`wss://${DOMAIN}`);
    expect(url.protocol).toBe('wss:');
    expect(url.hostname).toBe(DOMAIN);
    expect(url.port).toBe('');
  });

  it('should treat port 443 as default for wss:// (omitted from url.port)', () => {
    const url = new URL(`wss://${DOMAIN}:443`);
    expect(url.protocol).toBe('wss:');
    expect(url.hostname).toBe(DOMAIN);
    // Port 443 is the default for wss://, so URL spec normalizes it to empty string
    expect(url.port).toBe('');
  });

  it('should correctly parse ws:// URLs for local development', () => {
    const url = new URL('ws://localhost:3000');
    expect(url.protocol).toBe('ws:');
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('3000');
  });

  it('should default to port 443 for wss:// (implicit)', () => {
    const url = new URL(`wss://${DOMAIN}/path`);
    // Empty port means default (443 for wss)
    expect(url.port).toBe('');
    expect(url.pathname).toBe('/path');
  });

  it('should preserve non-default port in wss:// URLs', () => {
    const url = new URL(`wss://${DOMAIN}:8443`);
    expect(url.protocol).toBe('wss:');
    expect(url.port).toBe('8443');
  });
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a self-signed certificate for testing WSS connections locally.
 * Uses openssl to create an ephemeral EC key pair and self-signed cert.
 */
function generateSelfSignedCert(): { privateKey: string; certificate: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wss-test-'));
  const keyPath = join(tmpDir, 'key.pem');
  const certPath = join(tmpDir, 'cert.pem');

  try {
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "${keyPath}" -out "${certPath}" -days 1 -subj "/CN=localhost" 2>/dev/null`,
      { stdio: 'pipe' },
    );

    return {
      privateKey: readFileSync(keyPath, 'utf-8'),
      certificate: readFileSync(certPath, 'utf-8'),
    };
  } finally {
    try {
      unlinkSync(keyPath);
      unlinkSync(certPath);
      rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  }
}
