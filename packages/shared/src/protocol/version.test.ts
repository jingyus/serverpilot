// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for protocol version management.
 *
 * Tests parseSemVer, checkVersionCompatibility, and PROTOCOL_VERSION constant.
 */

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  parseSemVer,
  checkVersionCompatibility,
} from './version.js';

describe('protocol/version', () => {
  describe('PROTOCOL_VERSION', () => {
    it('should be a valid semver string', () => {
      expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be "1.0.0"', () => {
      expect(PROTOCOL_VERSION).toBe('1.0.0');
    });
  });

  describe('parseSemVer', () => {
    it('should parse valid semver string', () => {
      expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should parse "0.0.0"', () => {
      expect(parseSemVer('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    });

    it('should parse large version numbers', () => {
      expect(parseSemVer('99.88.77')).toEqual({ major: 99, minor: 88, patch: 77 });
    });

    it('should return null for invalid formats', () => {
      expect(parseSemVer('1.2')).toBeNull();
      expect(parseSemVer('1')).toBeNull();
      expect(parseSemVer('abc')).toBeNull();
      expect(parseSemVer('')).toBeNull();
      expect(parseSemVer('1.2.3.4')).toBeNull();
      expect(parseSemVer('v1.2.3')).toBeNull();
      expect(parseSemVer('1.2.3-beta')).toBeNull();
    });
  });

  describe('checkVersionCompatibility', () => {
    // --- Missing version (legacy agent) ---
    it('should warn for undefined agent version (legacy agent)', () => {
      const result = checkVersionCompatibility(undefined);
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('warn');
      expect(result.message).toContain('legacy agent');
    });

    // --- Exact match ---
    it('should return ok for exact version match', () => {
      const result = checkVersionCompatibility('1.0.0', '1.0.0');
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.message).toContain('match');
    });

    // --- Compatible (agent minor < server minor) ---
    it('should return ok when agent minor is less than server minor', () => {
      const result = checkVersionCompatibility('1.0.0', '1.2.0');
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.message).toContain('compatible');
    });

    // --- Compatible (different patches) ---
    it('should return ok for different patch versions', () => {
      const result = checkVersionCompatibility('1.0.1', '1.0.5');
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('ok');
    });

    // --- Incompatible: major version mismatch (agent older) ---
    it('should reject when agent major is older than server major', () => {
      const result = checkVersionCompatibility('0.5.0', '1.0.0');
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('older');
      expect(result.message).toContain('upgrade the agent');
    });

    // --- Incompatible: major version mismatch (agent newer) ---
    it('should reject when agent major is newer than server major', () => {
      const result = checkVersionCompatibility('2.0.0', '1.0.0');
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('newer');
      expect(result.message).toContain('upgrade the server');
    });

    // --- Incompatible: agent minor > server minor ---
    it('should reject when agent minor exceeds server minor', () => {
      const result = checkVersionCompatibility('1.3.0', '1.2.0');
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('not supported');
    });

    // --- Invalid format ---
    it('should warn for invalid agent version format', () => {
      const result = checkVersionCompatibility('not-a-version');
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('warn');
      expect(result.message).toContain('invalid');
    });

    it('should warn for invalid server version format', () => {
      const result = checkVersionCompatibility('1.0.0', 'bad');
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('warn');
      expect(result.message).toContain('server configuration error');
    });

    // --- Defaults to PROTOCOL_VERSION ---
    it('should use PROTOCOL_VERSION as default server version', () => {
      const result = checkVersionCompatibility(PROTOCOL_VERSION);
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('ok');
    });
  });
});
