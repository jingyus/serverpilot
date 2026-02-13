// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for password policy — Zod schemas and strength validation.
 */

import { describe, it, expect } from 'vitest';
import {
  ChangePasswordSchema,
  validatePasswordStrength,
  meetsMinimumPolicy,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  type PasswordStrengthResult,
} from './password-policy.js';

// ============================================================================
// ChangePasswordSchema
// ============================================================================

describe('ChangePasswordSchema', () => {
  it('should accept valid input where newPassword matches confirmPassword', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'OldPass123',
      newPassword: 'NewPass123',
      confirmPassword: 'NewPass123',
    });
    expect(result.success).toBe(true);
  });

  it('should reject when confirmPassword does not match newPassword', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'OldPass123',
      newPassword: 'NewPass123',
      confirmPassword: 'Different1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmError = result.error.issues.find((i) => i.path.includes('confirmPassword'));
      expect(confirmError?.message).toBe('New password and confirmation do not match');
    }
  });

  it('should reject empty currentPassword', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'NewPass123',
      confirmPassword: 'NewPass123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject newPassword shorter than minimum length', () => {
    const short = 'Ab1' + 'x'.repeat(MIN_PASSWORD_LENGTH - 4); // length = MIN - 1
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: short,
      confirmPassword: short,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message;
      expect(msg).toContain(`at least ${MIN_PASSWORD_LENGTH}`);
    }
  });

  it('should reject newPassword longer than maximum length', () => {
    const long = 'Ab1!' + 'x'.repeat(MAX_PASSWORD_LENGTH); // > MAX
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: long,
      confirmPassword: long,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message;
      expect(msg).toContain(`at most ${MAX_PASSWORD_LENGTH}`);
    }
  });

  it('should reject empty confirmPassword', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'NewPass123',
      confirmPassword: '',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// validatePasswordStrength
// ============================================================================

describe('validatePasswordStrength', () => {
  it('should return score 0 for empty string', () => {
    const result = validatePasswordStrength('');
    expect(result.score).toBe(0);
    expect(result.feedback.length).toBeGreaterThanOrEqual(4);
  });

  it('should return score 0 for short lowercase-only password', () => {
    const result = validatePasswordStrength('abc');
    expect(result.score).toBe(0);
    expect(result.feedback).toContain(`Must be at least ${MIN_PASSWORD_LENGTH} characters`);
    expect(result.feedback).toContain('Must contain at least one uppercase letter');
    expect(result.feedback).toContain('Must contain at least one digit');
  });

  it('should return score 1 for password meeting only length + lowercase', () => {
    const result = validatePasswordStrength('abcdefgh');
    expect(result.score).toBe(1);
    expect(result.feedback).toContain('Must contain at least one uppercase letter');
    expect(result.feedback).toContain('Must contain at least one digit');
  });

  it('should return score 2 for password with length + lowercase + uppercase', () => {
    const result = validatePasswordStrength('Abcdefgh');
    expect(result.score).toBe(2);
    expect(result.feedback).toContain('Must contain at least one digit');
    expect(result.feedback).not.toContain('Must contain at least one lowercase letter');
  });

  it('should return score 3 for password with length + lower + upper + digit', () => {
    const result = validatePasswordStrength('Abcdefg1');
    expect(result.score).toBe(3);
    expect(result.feedback).toContain('Add a special character for extra strength');
    expect(result.feedback).toHaveLength(1);
  });

  it('should return score 4 for password meeting all criteria', () => {
    const result = validatePasswordStrength('Abcdefg1!');
    expect(result.score).toBe(4);
    expect(result.feedback).toHaveLength(0);
  });

  it('should give feedback for missing lowercase', () => {
    const result = validatePasswordStrength('ABCDEFG1!');
    expect(result.feedback).toContain('Must contain at least one lowercase letter');
  });

  it('should handle digit-only password', () => {
    const result = validatePasswordStrength('12345678');
    expect(result.score).toBe(1);
    expect(result.feedback).toContain('Must contain at least one lowercase letter');
    expect(result.feedback).toContain('Must contain at least one uppercase letter');
  });

  it('should handle special-character-only password of sufficient length', () => {
    const result = validatePasswordStrength('!@#$%^&*');
    expect(result.score).toBe(1);
    expect(result.feedback).toContain('Must contain at least one lowercase letter');
    expect(result.feedback).toContain('Must contain at least one uppercase letter');
    expect(result.feedback).toContain('Must contain at least one digit');
  });

  it('should cap score at 4 for maximum criteria', () => {
    const result = validatePasswordStrength('SuperStr0ng!Password');
    expect(result.score).toBe(4);
    expect(result.feedback).toHaveLength(0);
  });
});

// ============================================================================
// meetsMinimumPolicy
// ============================================================================

describe('meetsMinimumPolicy', () => {
  it('should return true for password meeting all minimum requirements', () => {
    expect(meetsMinimumPolicy('Abcdefg1')).toBe(true);
  });

  it('should return false for password too short', () => {
    expect(meetsMinimumPolicy('Ab1')).toBe(false);
  });

  it('should return false for password without uppercase', () => {
    expect(meetsMinimumPolicy('abcdefg1')).toBe(false);
  });

  it('should return false for password without lowercase', () => {
    expect(meetsMinimumPolicy('ABCDEFG1')).toBe(false);
  });

  it('should return false for password without digit', () => {
    expect(meetsMinimumPolicy('Abcdefgh')).toBe(false);
  });

  it('should return true even without special characters (not required)', () => {
    expect(meetsMinimumPolicy('Password1')).toBe(true);
  });
});
