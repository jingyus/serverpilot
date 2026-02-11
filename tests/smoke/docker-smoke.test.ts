/**
 * Docker Compose End-to-End Smoke Tests
 *
 * Programmatic smoke tests that verify the full deployment chain:
 * Health → Register → Login → Create Server → List Servers → AI Provider Health
 *
 * These tests run against a live Docker Compose deployment.
 * Set SMOKE_TEST_URL environment variable to target a running instance.
 * When SMOKE_TEST_URL is not set, tests are skipped (CI uses the shell script).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SMOKE_TEST_URL || '';
const TIMEOUT_MS = 10_000;

// Skip all tests if no target URL is configured
const describeSmoke = BASE_URL ? describe : describe.skip;

/** HTTP helper for making requests */
async function request(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    let data: unknown;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    return { status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

describeSmoke('Docker Compose Smoke Tests', () => {
  const testUser = `smoke_${Date.now()}@test.local`;
  const testPassword = 'SmokeTest_Passw0rd!';
  let accessToken = '';

  describe('Health Check', () => {
    it('should return 200 with status ok', async () => {
      const { status, data } = await request('GET', '/health');
      expect(status).toBe(200);
      expect(data).toHaveProperty('status', 'ok');
    });
  });

  describe('User Registration', () => {
    it('should register a new user', async () => {
      const { status, data } = await request('POST', '/api/v1/auth/register', {
        body: { email: testUser, password: testPassword, name: 'Smoke Test' },
      });

      // 200/201 = success, 409 = already exists (acceptable)
      expect([200, 201, 409]).toContain(status);

      if (status === 200 || status === 201) {
        const result = data as Record<string, unknown>;
        expect(result).toHaveProperty('accessToken');
        accessToken = result.accessToken as string;
      }
    });
  });

  describe('User Login', () => {
    it('should login and return tokens', async () => {
      const { status, data } = await request('POST', '/api/v1/auth/login', {
        body: { email: testUser, password: testPassword },
      });

      expect(status).toBe(200);
      const result = data as Record<string, unknown>;
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');

      accessToken = result.accessToken as string;
      expect(accessToken.length).toBeGreaterThan(0);
    });
  });

  describe('Server Management', () => {
    it('should create a server with install command', async () => {
      expect(accessToken).not.toBe('');

      const { status, data } = await request('POST', '/api/v1/servers', {
        token: accessToken,
        body: {
          name: 'smoke-test-server',
          host: '192.168.1.100',
          port: 22,
          description: 'Smoke test server',
        },
      });

      expect([200, 201]).toContain(status);
      const result = data as Record<string, unknown>;
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('installCommand');
    });

    it('should list servers', async () => {
      expect(accessToken).not.toBe('');

      const { status, data } = await request('GET', '/api/v1/servers', {
        token: accessToken,
      });

      expect(status).toBe(200);
      const result = data as Record<string, unknown>;
      expect(result).toHaveProperty('servers');
      expect(result).toHaveProperty('total');
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Nginx Reverse Proxy', () => {
    it('should serve Dashboard SPA at root', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${BASE_URL}/`, { signal: controller.signal });
        expect(res.status).toBe(200);

        const html = await res.text();
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('id="root"');
      } finally {
        clearTimeout(timeout);
      }
    });

    it('should proxy API requests through Nginx', async () => {
      // Sending empty body to register should return validation error
      const { status } = await request('POST', '/api/v1/auth/register', {
        body: {},
      });

      // 400 or 422 = validation error (proves API proxy works)
      expect([400, 422]).toContain(status);
    });

    it('should include security headers', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${BASE_URL}/`, { signal: controller.signal });
        const xfo = res.headers.get('x-frame-options');
        expect(xfo).toBeTruthy();
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  describe('WebSocket Endpoint', () => {
    it('should respond to WebSocket upgrade request', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${BASE_URL}/ws`, {
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': '13',
          },
          signal: controller.signal,
        });

        // 101 = upgrade OK, 401/403 = auth required, 426 = upgrade required, 400 = bad request
        // All indicate the WebSocket endpoint is reachable
        expect([101, 400, 401, 403, 426]).toContain(res.status);
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  describe('AI Provider Health', () => {
    it('should check AI provider availability', async () => {
      expect(accessToken).not.toBe('');

      const { status, data } = await request(
        'GET',
        '/api/v1/settings/ai-provider/health',
        { token: accessToken },
      );

      // 200 = provider configured, 503 = no API key (both valid)
      expect([200, 503]).toContain(status);

      if (status === 200) {
        const result = data as Record<string, unknown>;
        expect(result).toHaveProperty('available');
      }
    });
  });

  describe('Smoke Test Script', () => {
    it('should have executable smoke-test.sh', async () => {
      const { existsSync, statSync } = await import('node:fs');
      const { resolve } = await import('node:path');

      const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
      expect(existsSync(scriptPath)).toBe(true);

      const stats = statSync(scriptPath);
      // Check executable bit (owner execute = 0o100)
      expect(stats.mode & 0o100).toBeTruthy();
    });
  });
});

describe('Docker Smoke Test Configuration', () => {
  beforeAll(() => {
    // These tests always run — they validate the test infrastructure itself
  });

  it('should validate smoke test script exists', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('should validate smoke test script contains required test sections', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    // Verify all critical test sections exist
    expect(content).toContain('test_health_check');
    expect(content).toContain('test_register');
    expect(content).toContain('test_login');
    expect(content).toContain('test_create_server');
    expect(content).toContain('test_list_servers');
    expect(content).toContain('test_nginx_proxy');
    expect(content).toContain('test_websocket');
    expect(content).toContain('test_ai_provider_health');
    expect(content).toContain('test_container_health');
    expect(content).toContain('test_error_logs');
  });

  it('should validate smoke test script has proper exit codes', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('exit 0');
    expect(content).toContain('exit 1');
  });

  it('should validate smoke test targets Dashboard port (3001) by default', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    // Default port should be 3001 (Nginx/Dashboard), not 3000 (internal server)
    expect(content).toContain('PORT="${PORT:-3001}"');
  });

  it('should validate smoke test supports --wait flag for CI', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('--wait');
    expect(content).toContain('wait_for_services');
  });

  it('should validate smoke test uses authentication flow', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const scriptPath = resolve(__dirname, '../../scripts/smoke-test.sh');
    const content = readFileSync(scriptPath, 'utf-8');

    // Must use Bearer token auth
    expect(content).toContain('Authorization: Bearer');
    // Must extract accessToken
    expect(content).toContain('accessToken');
  });
});
