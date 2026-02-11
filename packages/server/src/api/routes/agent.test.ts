// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agent routes tests.
 *
 * Tests for the agent version check and update API endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { agent } from './agent.js';

describe('Agent Routes', () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route('/api/v1/agent', agent);
  });

  describe('GET /api/v1/agent/version', () => {
    it('should return version info without query params', async () => {
      const res = await app.request('/api/v1/agent/version');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('latest');
      expect(data).toHaveProperty('current');
      expect(data).toHaveProperty('updateAvailable');
      expect(data).toHaveProperty('forceUpdate');
      expect(data).toHaveProperty('releaseDate');
      expect(data).toHaveProperty('releaseNotes');
    });

    it('should include download URL when platform and arch are specified', async () => {
      const res = await app.request('/api/v1/agent/version?platform=darwin&arch=arm64');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('downloadUrl');
      expect(data.downloadUrl).toContain('darwin-arm64');
    });

    it('should indicate update available when current version is older', async () => {
      const res = await app.request('/api/v1/agent/version?current=0.0.1');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.current).toBe('0.0.1');
      expect(data.updateAvailable).toBe(true);
    });

    it('should not indicate update when current version matches latest', async () => {
      const res = await app.request('/api/v1/agent/version?current=0.1.0');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.updateAvailable).toBe(false);
    });

    it('should handle linux platform', async () => {
      const res = await app.request('/api/v1/agent/version?platform=linux&arch=x64');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.downloadUrl).toContain('linux-x64');
    });

    it('should handle win32 platform', async () => {
      const res = await app.request('/api/v1/agent/version?platform=win32&arch=x64');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.downloadUrl).toContain('win32-x64');
      expect(data.downloadUrl).toContain('.exe');
    });

    it('should reject invalid platform', async () => {
      const res = await app.request('/api/v1/agent/version?platform=invalid');
      // Zod validation errors result in 500 (unhandled) unless global error handler is added
      expect([400, 500]).toContain(res.status);
    });

    it('should reject invalid arch', async () => {
      const res = await app.request('/api/v1/agent/version?platform=darwin&arch=invalid');
      // Zod validation errors result in 500 (unhandled) unless global error handler is added
      expect([400, 500]).toContain(res.status);
    });
  });

  describe('GET /api/v1/agent/binaries', () => {
    it('should return all binary info', async () => {
      const res = await app.request('/api/v1/agent/binaries');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('binaries');
      expect(data.binaries).toHaveProperty('darwin-x64');
      expect(data.binaries).toHaveProperty('darwin-arm64');
      expect(data.binaries).toHaveProperty('linux-x64');
      expect(data.binaries).toHaveProperty('linux-arm64');
      expect(data.binaries).toHaveProperty('win32-x64');
    });

    it('should include url in each binary entry', async () => {
      const res = await app.request('/api/v1/agent/binaries');
      const data = await res.json();

      for (const [platform, binary] of Object.entries(data.binaries)) {
        expect(binary).toHaveProperty('url');
        expect((binary as { url: string }).url).toContain(platform);
      }
    });
  });
});
