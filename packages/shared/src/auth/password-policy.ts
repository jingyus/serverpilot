// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Password policy — Zod schemas and strength validation.
 *
 * Single source of truth for password rules shared by server and dashboard.
 * Pure functions only, no runtime side-effects.
 *
 * @module auth/password-policy
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/** Minimum password length. */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum password length (prevent DoS with huge payloads). */
export const MAX_PASSWORD_LENGTH = 128;

// ============================================================================
// Types
// ============================================================================

/** Strength score from 0 (very weak) to 4 (very strong). */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

/** Result of password strength validation. */
export interface PasswordStrengthResult {
  /** 0 = very weak, 1 = weak, 2 = fair, 3 = strong, 4 = very strong */
  score: PasswordStrengthScore;
  /** Human-readable feedback messages for unmet criteria. */
  feedback: string[];
}

// ============================================================================
// Zod Schemas
// ============================================================================

/** Base password field with length constraints. */
const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);

/**
 * Schema for the change-password request body.
 *
 * Validates `currentPassword`, `newPassword`, and `confirmPassword`,
 * plus a refinement ensuring new and confirm match.
 */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// ============================================================================
// Strength Validation
// ============================================================================

/**
 * Evaluate password strength and return a score + feedback.
 *
 * Criteria (each met adds 1 point to the score):
 * 1. Length ≥ 8 characters
 * 2. Contains lowercase letter
 * 3. Contains uppercase letter
 * 4. Contains digit
 * 5. Contains special character
 *
 * Score mapping: met criteria count → score
 *   0-1 → 0 (very weak), 2 → 1 (weak), 3 → 2 (fair), 4 → 3 (strong), 5 → 4 (very strong)
 *
 * Minimum requirement: score ≥ 2 (length + lowercase + uppercase + digit).
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let criteria = 0;

  // 1. Minimum length
  if (password.length >= MIN_PASSWORD_LENGTH) {
    criteria++;
  } else {
    feedback.push(`Must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // 2. Lowercase letter
  if (/[a-z]/.test(password)) {
    criteria++;
  } else {
    feedback.push('Must contain at least one lowercase letter');
  }

  // 3. Uppercase letter
  if (/[A-Z]/.test(password)) {
    criteria++;
  } else {
    feedback.push('Must contain at least one uppercase letter');
  }

  // 4. Digit
  if (/\d/.test(password)) {
    criteria++;
  } else {
    feedback.push('Must contain at least one digit');
  }

  // 5. Special character
  if (/[^a-zA-Z0-9]/.test(password)) {
    criteria++;
  } else {
    feedback.push('Add a special character for extra strength');
  }

  const score = Math.max(0, Math.min(4, criteria - 1)) as PasswordStrengthScore;

  return { score, feedback };
}

/**
 * Check whether a password meets the minimum policy requirements.
 *
 * Minimum: ≥8 chars, at least one lowercase, one uppercase, and one digit (score ≥ 2).
 */
export function meetsMinimumPolicy(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}
