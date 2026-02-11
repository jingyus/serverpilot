// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agent updater module tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compareVersions, satisfiesMinVersion } from './index.js';

describe('Updater', () => {
  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
      expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    });

    it('should return positive when first version is greater', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    });

    it('should return negative when first version is less', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
      expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
      expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0);
    });

    it('should handle different version lengths', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.0')).toBe(0);
      expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    });

    it('should handle multi-digit version numbers', () => {
      expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    });
  });

  describe('satisfiesMinVersion', () => {
    it('should return true when current version equals minimum', () => {
      expect(satisfiesMinVersion('1.0.0', '1.0.0')).toBe(true);
    });

    it('should return true when current version exceeds minimum', () => {
      expect(satisfiesMinVersion('1.1.0', '1.0.0')).toBe(true);
      expect(satisfiesMinVersion('2.0.0', '1.0.0')).toBe(true);
    });

    it('should return false when current version is below minimum', () => {
      expect(satisfiesMinVersion('0.9.0', '1.0.0')).toBe(false);
      expect(satisfiesMinVersion('1.0.0', '1.0.1')).toBe(false);
    });
  });

  describe('checkForUpdates', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should make a GET request to the version endpoint', async () => {
      const mockResponse = {
        latest: '0.2.0',
        current: '0.1.0',
        updateAvailable: true,
        forceUpdate: false,
        releaseDate: '2025-01-15T00:00:00Z',
        releaseNotes: 'Test release',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Import dynamically to pick up the mocked fetch
      const { checkForUpdates } = await import('./index.js');
      const result = await checkForUpdates('ws://localhost:3000');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/agent/version'),
      );
      expect(result.updateAvailable).toBe(true);
      expect(result.latest).toBe('0.2.0');
    });

    it('should throw on non-OK response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { checkForUpdates } = await import('./index.js');

      await expect(checkForUpdates('ws://localhost:3000')).rejects.toThrow(
        'Failed to check for updates',
      );
    });

    it('should convert ws:// to http://', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ updateAvailable: false }),
      });

      const { checkForUpdates } = await import('./index.js');
      await checkForUpdates('ws://localhost:3000');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3000'),
      );
    });

    it('should convert wss:// to https://', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ updateAvailable: false }),
      });

      const { checkForUpdates } = await import('./index.js');
      await checkForUpdates('wss://example.com:3000');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com:3000'),
      );
    });
  });
});
