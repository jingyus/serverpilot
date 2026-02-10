/**
 * Tests for password hashing utilities.
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  // ==========================================================================
  // hashPassword
  // ==========================================================================

  describe('hashPassword', () => {
    it('should produce a scrypt-prefixed hash string', async () => {
      const hash = await hashPassword('testpassword');
      expect(hash).toMatch(/^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
    });

    it('should produce different hashes for the same password (unique salt)', async () => {
      const hash1 = await hashPassword('samepassword');
      const hash2 = await hashPassword('samepassword');
      expect(hash1).not.toBe(hash2);
    });

    it('should include correct scrypt parameters', async () => {
      const hash = await hashPassword('testpassword');
      const parts = hash.split(':');
      expect(parts[0]).toBe('scrypt');
      expect(parts[1]).toBe('16384'); // N
      expect(parts[2]).toBe('8');     // r
      expect(parts[3]).toBe('1');     // p
    });

    it('should produce a 64-byte (128 hex char) derived key', async () => {
      const hash = await hashPassword('testpassword');
      const parts = hash.split(':');
      expect(parts[5]!.length).toBe(128); // 64 bytes = 128 hex chars
    });

    it('should produce a 32-byte (64 hex char) salt', async () => {
      const hash = await hashPassword('testpassword');
      const parts = hash.split(':');
      expect(parts[4]!.length).toBe(64); // 32 bytes = 64 hex chars
    });
  });

  // ==========================================================================
  // verifyPassword
  // ==========================================================================

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      const hash = await hashPassword('correcthorse');
      const result = await verifyPassword('correcthorse', hash);
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const hash = await hashPassword('correcthorse');
      const result = await verifyPassword('wronghorse', hash);
      expect(result).toBe(false);
    });

    it('should return false for invalid hash format', async () => {
      const result = await verifyPassword('password', 'not-a-valid-hash');
      expect(result).toBe(false);
    });

    it('should return false for empty hash', async () => {
      const result = await verifyPassword('password', '');
      expect(result).toBe(false);
    });

    it('should return false for hash with wrong prefix', async () => {
      const result = await verifyPassword('password', 'bcrypt:some:stuff:here:salt:hash');
      expect(result).toBe(false);
    });

    it('should handle empty password', async () => {
      const hash = await hashPassword('');
      const result = await verifyPassword('', hash);
      expect(result).toBe(true);
    });

    it('should handle unicode passwords', async () => {
      const hash = await hashPassword('密码🔑');
      expect(await verifyPassword('密码🔑', hash)).toBe(true);
      expect(await verifyPassword('密码', hash)).toBe(false);
    });

    it('should handle long passwords', async () => {
      const longPassword = 'a'.repeat(1000);
      const hash = await hashPassword(longPassword);
      expect(await verifyPassword(longPassword, hash)).toBe(true);
      expect(await verifyPassword(longPassword + 'b', hash)).toBe(false);
    });
  });
});
