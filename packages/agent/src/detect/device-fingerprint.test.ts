/**
 * Tests for device fingerprint generation module.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDeviceFingerprint,
  generateDeviceFingerprint,
  getOrCreateDeviceFingerprint,
  isDeviceFingerprintStable,
  loadDeviceFingerprint,
  saveDeviceFingerprint,
  updateDeviceToken,
  type DeviceAuthInfo,
  type DeviceFingerprint,
} from './device-fingerprint';

describe('Device Fingerprint Generation', () => {
  // Test config directory
  const testConfigDir = path.join(os.tmpdir(), 'aiinstaller-test-device-fingerprint');
  const testConfig = { configDir: testConfigDir, filename: 'device.json' };

  beforeEach(() => {
    // Clean up test directory before each test
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('generateDeviceFingerprint', () => {
    it('should generate a device fingerprint with all required fields', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(fingerprint).toHaveProperty('deviceId');
      expect(fingerprint).toHaveProperty('hostname');
      expect(fingerprint).toHaveProperty('platform');
      expect(fingerprint).toHaveProperty('arch');
      expect(fingerprint).toHaveProperty('macAddressHash');
      expect(fingerprint).toHaveProperty('username');
      expect(fingerprint).toHaveProperty('createdAt');
      expect(fingerprint).toHaveProperty('lastVerifiedAt');
    });

    it('should generate a 64-character hex deviceId', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(fingerprint.deviceId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate a 16-character hex macAddressHash', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(fingerprint.macAddressHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should include current system information', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(fingerprint.hostname).toBe(os.hostname());
      expect(fingerprint.platform).toBe(os.platform());
      expect(fingerprint.arch).toBe(os.arch());
      expect(fingerprint.username).toBe(os.userInfo().username);
    });

    it('should generate the same deviceId for the same system', () => {
      const fp1 = generateDeviceFingerprint();
      const fp2 = generateDeviceFingerprint();

      expect(fp1.deviceId).toBe(fp2.deviceId);
    });

    it('should have valid ISO timestamps', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(() => new Date(fingerprint.createdAt)).not.toThrow();
      expect(() => new Date(fingerprint.lastVerifiedAt)).not.toThrow();

      const createdDate = new Date(fingerprint.createdAt);
      expect(createdDate.getTime()).toBeGreaterThan(0);
    });
  });

  describe('saveDeviceFingerprint', () => {
    it('should create config directory if it does not exist', () => {
      const fingerprint = generateDeviceFingerprint();

      expect(existsSync(testConfigDir)).toBe(false);

      saveDeviceFingerprint(fingerprint, testConfig);

      expect(existsSync(testConfigDir)).toBe(true);
    });

    it('should save fingerprint to device.json file', () => {
      const fingerprint = generateDeviceFingerprint();
      const filePath = path.join(testConfigDir, 'device.json');

      saveDeviceFingerprint(fingerprint, testConfig);

      expect(existsSync(filePath)).toBe(true);
    });

    it('should save fingerprint as valid JSON', () => {
      const fingerprint = generateDeviceFingerprint();
      const filePath = path.join(testConfigDir, 'device.json');

      saveDeviceFingerprint(fingerprint, testConfig);

      const content = readFileSync(filePath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should save fingerprint with all fields', () => {
      const fingerprint = generateDeviceFingerprint();
      const filePath = path.join(testConfigDir, 'device.json');

      saveDeviceFingerprint(fingerprint, testConfig);

      const content = readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(content) as DeviceFingerprint;

      expect(loaded.deviceId).toBe(fingerprint.deviceId);
      expect(loaded.hostname).toBe(fingerprint.hostname);
      expect(loaded.platform).toBe(fingerprint.platform);
      expect(loaded.arch).toBe(fingerprint.arch);
      expect(loaded.macAddressHash).toBe(fingerprint.macAddressHash);
      expect(loaded.username).toBe(fingerprint.username);
      expect(loaded.createdAt).toBe(fingerprint.createdAt);
      expect(loaded.lastVerifiedAt).toBe(fingerprint.lastVerifiedAt);
    });

    it('should save device token if present', () => {
      const fingerprint: DeviceAuthInfo = {
        ...generateDeviceFingerprint(),
        deviceToken: 'test-token-12345',
      };
      const filePath = path.join(testConfigDir, 'device.json');

      saveDeviceFingerprint(fingerprint, testConfig);

      const content = readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(content) as DeviceAuthInfo;

      expect(loaded.deviceToken).toBe('test-token-12345');
    });

    it('should overwrite existing fingerprint', () => {
      const fp1 = generateDeviceFingerprint();
      const fp2: DeviceAuthInfo = {
        ...generateDeviceFingerprint(),
        deviceToken: 'new-token',
      };

      saveDeviceFingerprint(fp1, testConfig);
      saveDeviceFingerprint(fp2, testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceToken).toBe('new-token');
    });
  });

  describe('loadDeviceFingerprint', () => {
    it('should return undefined if file does not exist', () => {
      const loaded = loadDeviceFingerprint(testConfig);

      expect(loaded).toBeUndefined();
    });

    it('should load saved fingerprint', () => {
      const fingerprint = generateDeviceFingerprint();
      saveDeviceFingerprint(fingerprint, testConfig);

      const loaded = loadDeviceFingerprint(testConfig);

      expect(loaded).toBeDefined();
      expect(loaded?.deviceId).toBe(fingerprint.deviceId);
    });

    it('should return undefined for invalid JSON', () => {
      mkdirSync(testConfigDir, { recursive: true });
      const filePath = path.join(testConfigDir, 'device.json');
      writeFileSync(filePath, 'invalid json{', 'utf-8');

      const loaded = loadDeviceFingerprint(testConfig);

      expect(loaded).toBeUndefined();
    });

    it('should return undefined for missing required fields', () => {
      mkdirSync(testConfigDir, { recursive: true });
      const filePath = path.join(testConfigDir, 'device.json');
      writeFileSync(filePath, JSON.stringify({ hostname: 'test' }), 'utf-8');

      const loaded = loadDeviceFingerprint(testConfig);

      expect(loaded).toBeUndefined();
    });

    it('should load fingerprint with device token', () => {
      const fingerprint: DeviceAuthInfo = {
        ...generateDeviceFingerprint(),
        deviceToken: 'test-token-abc',
      };
      saveDeviceFingerprint(fingerprint, testConfig);

      const loaded = loadDeviceFingerprint(testConfig);

      expect(loaded?.deviceToken).toBe('test-token-abc');
    });
  });

  describe('getOrCreateDeviceFingerprint', () => {
    it('should create new fingerprint if none exists', () => {
      const device = getOrCreateDeviceFingerprint(testConfig);

      expect(device).toBeDefined();
      expect(device.deviceId).toBeDefined();
    });

    it('should save fingerprint to file when creating new one', () => {
      getOrCreateDeviceFingerprint(testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded).toBeDefined();
    });

    it('should load existing fingerprint if available', () => {
      const first = getOrCreateDeviceFingerprint(testConfig);
      const second = getOrCreateDeviceFingerprint(testConfig);

      expect(second.deviceId).toBe(first.deviceId);
      expect(second.createdAt).toBe(first.createdAt);
    });

    it('should update lastVerifiedAt when loading existing fingerprint', () => {
      const first = getOrCreateDeviceFingerprint(testConfig);

      // Wait a bit to ensure timestamp changes
      const originalTime = new Date(first.lastVerifiedAt).getTime();

      // Simulate time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      const second = getOrCreateDeviceFingerprint(testConfig);
      vi.useRealTimers();

      const newTime = new Date(second.lastVerifiedAt).getTime();
      expect(newTime).toBeGreaterThan(originalTime);
    });

    it('should preserve device token when loading existing fingerprint', () => {
      const first = getOrCreateDeviceFingerprint(testConfig);
      first.deviceToken = 'preserved-token';
      saveDeviceFingerprint(first, testConfig);

      const second = getOrCreateDeviceFingerprint(testConfig);

      expect(second.deviceToken).toBe('preserved-token');
    });

    it('should generate same deviceId across multiple calls', () => {
      const device1 = getOrCreateDeviceFingerprint(testConfig);
      const device2 = getOrCreateDeviceFingerprint(testConfig);
      const device3 = getOrCreateDeviceFingerprint(testConfig);

      expect(device1.deviceId).toBe(device2.deviceId);
      expect(device2.deviceId).toBe(device3.deviceId);
    });
  });

  describe('updateDeviceToken', () => {
    it('should update token for existing fingerprint', () => {
      getOrCreateDeviceFingerprint(testConfig);

      updateDeviceToken('new-auth-token', testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceToken).toBe('new-auth-token');
    });

    it('should create fingerprint if none exists', () => {
      updateDeviceToken('first-token', testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceToken).toBe('first-token');
    });

    it('should preserve other fingerprint fields when updating token', () => {
      const original = getOrCreateDeviceFingerprint(testConfig);

      updateDeviceToken('updated-token', testConfig);

      const updated = loadDeviceFingerprint(testConfig);
      expect(updated?.deviceId).toBe(original.deviceId);
      expect(updated?.hostname).toBe(original.hostname);
      expect(updated?.createdAt).toBe(original.createdAt);
    });
  });

  describe('clearDeviceFingerprint', () => {
    it('should return false if no fingerprint exists', () => {
      const result = clearDeviceFingerprint(testConfig);

      expect(result).toBe(false);
    });

    it('should return true if fingerprint was deleted', () => {
      getOrCreateDeviceFingerprint(testConfig);

      const result = clearDeviceFingerprint(testConfig);

      expect(result).toBe(true);
    });

    it('should remove fingerprint file', () => {
      getOrCreateDeviceFingerprint(testConfig);
      const filePath = path.join(testConfigDir, 'device.json');

      expect(existsSync(filePath)).toBe(true);

      clearDeviceFingerprint(testConfig);

      expect(existsSync(filePath)).toBe(false);
    });

    it('should allow creating new fingerprint after clearing', () => {
      const first = getOrCreateDeviceFingerprint(testConfig);
      const firstCreatedAt = first.createdAt;

      clearDeviceFingerprint(testConfig);

      // Wait a bit to ensure timestamp is different
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      const second = getOrCreateDeviceFingerprint(testConfig);

      vi.useRealTimers();

      // Should be same deviceId (same system)
      expect(second.deviceId).toBe(first.deviceId);

      // New timestamps should be later than original
      const secondCreatedAt = new Date(second.createdAt).getTime();
      const firstCreatedAtTime = new Date(firstCreatedAt).getTime();
      expect(secondCreatedAt).toBeGreaterThan(firstCreatedAtTime);
    });
  });

  describe('isDeviceFingerprintStable', () => {
    it('should return false if no fingerprint exists', () => {
      const stable = isDeviceFingerprintStable(testConfig);

      expect(stable).toBe(false);
    });

    it('should return true for stable fingerprint', () => {
      getOrCreateDeviceFingerprint(testConfig);

      const stable = isDeviceFingerprintStable(testConfig);

      expect(stable).toBe(true);
    });

    it('should return true after multiple verifications', () => {
      getOrCreateDeviceFingerprint(testConfig);

      expect(isDeviceFingerprintStable(testConfig)).toBe(true);
      expect(isDeviceFingerprintStable(testConfig)).toBe(true);
      expect(isDeviceFingerprintStable(testConfig)).toBe(true);
    });

    it('should return false if device changed', () => {
      // Create fingerprint
      const original = generateDeviceFingerprint();
      saveDeviceFingerprint(original, testConfig);

      // Manually modify deviceId to simulate device change
      const modified: DeviceAuthInfo = {
        ...original,
        deviceId: 'different-device-id-12345678901234567890123456789012345678901234',
      };
      saveDeviceFingerprint(modified, testConfig);

      const stable = isDeviceFingerprintStable(testConfig);

      expect(stable).toBe(false);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete device registration flow', () => {
      // 1. First time: Generate and save fingerprint
      const device1 = getOrCreateDeviceFingerprint(testConfig);
      expect(device1.deviceToken).toBeUndefined();

      // 2. Register with server and get token
      updateDeviceToken('server-issued-token-123', testConfig);

      // 3. Load on next run
      const device2 = getOrCreateDeviceFingerprint(testConfig);
      expect(device2.deviceToken).toBe('server-issued-token-123');
      expect(device2.deviceId).toBe(device1.deviceId);

      // 4. Verify stability
      expect(isDeviceFingerprintStable(testConfig)).toBe(true);
    });

    it('should handle device reset flow', () => {
      // Create and register device
      const original = getOrCreateDeviceFingerprint(testConfig);
      updateDeviceToken('original-token', testConfig);

      // Clear device (user reset)
      clearDeviceFingerprint(testConfig);

      // Create new registration
      const newDevice = getOrCreateDeviceFingerprint(testConfig);

      // Should have same deviceId but no token
      expect(newDevice.deviceId).toBe(original.deviceId);
      expect(newDevice.deviceToken).toBeUndefined();
    });

    it('should handle token refresh flow', () => {
      const device = getOrCreateDeviceFingerprint(testConfig);
      const originalDeviceId = device.deviceId;

      // Initial token
      updateDeviceToken('token-v1', testConfig);

      // Token refresh
      updateDeviceToken('token-v2', testConfig);
      updateDeviceToken('token-v3', testConfig);

      // Verify device ID unchanged
      const current = loadDeviceFingerprint(testConfig);
      expect(current?.deviceId).toBe(originalDeviceId);
      expect(current?.deviceToken).toBe('token-v3');
    });

    it('should handle concurrent access safely', () => {
      // Simulate multiple processes accessing device fingerprint
      const device1 = getOrCreateDeviceFingerprint(testConfig);
      const device2 = getOrCreateDeviceFingerprint(testConfig);
      const device3 = getOrCreateDeviceFingerprint(testConfig);

      // All should have same deviceId
      expect(device1.deviceId).toBe(device2.deviceId);
      expect(device2.deviceId).toBe(device3.deviceId);

      // Verify file is consistent
      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceId).toBe(device1.deviceId);
    });
  });

  describe('Edge cases', () => {
    it('should handle very long device tokens', () => {
      const longToken = 'a'.repeat(1000);
      updateDeviceToken(longToken, testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceToken).toBe(longToken);
    });

    it('should handle special characters in device token', () => {
      const specialToken = 'token-with-特殊字符-and-émojis-🎉';
      updateDeviceToken(specialToken, testConfig);

      const loaded = loadDeviceFingerprint(testConfig);
      expect(loaded?.deviceToken).toBe(specialToken);
    });

    it('should create nested config directory if needed', () => {
      const nestedConfig = {
        configDir: path.join(testConfigDir, 'level1', 'level2', 'level3'),
        filename: 'device.json',
      };

      getOrCreateDeviceFingerprint(nestedConfig);

      const loaded = loadDeviceFingerprint(nestedConfig);
      expect(loaded).toBeDefined();
    });

    it('should handle custom filename', () => {
      const customConfig = {
        configDir: testConfigDir,
        filename: 'custom-device.json',
      };

      getOrCreateDeviceFingerprint(customConfig);

      const customPath = path.join(testConfigDir, 'custom-device.json');
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should generate fingerprint quickly', () => {
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        generateDeviceFingerprint();
      }

      const duration = Date.now() - startTime;
      // Should generate 100 fingerprints in under 1 second
      expect(duration).toBeLessThan(1000);
    });

    it('should load fingerprint quickly', () => {
      getOrCreateDeviceFingerprint(testConfig);

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        loadDeviceFingerprint(testConfig);
      }

      const duration = Date.now() - startTime;
      // Should load 100 times in under 1 second
      expect(duration).toBeLessThan(1000);
    });
  });
});
