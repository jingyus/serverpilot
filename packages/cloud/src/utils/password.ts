// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Password hashing for Cloud — same format as server (scrypt) for compatibility.
 *
 * Format: scrypt:N:r:p:salt:hash (hex). Server verifyPassword() accepts this.
 *
 * @module cloud/utils/password
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 32;

/**
 * Hash a plaintext password (same algorithm as server).
 */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LEN);
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derived.toString('hex')}`);
    });
  });
}

/**
 * Verify password against stored hash (timing-safe).
 */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const N = parseInt(parts[1]!, 10);
    const r = parseInt(parts[2]!, 10);
    const p = parseInt(parts[3]!, 10);
    const salt = Buffer.from(parts[4]!, 'hex');
    const storedKey = Buffer.from(parts[5]!, 'hex');
    scrypt(password, salt, storedKey.length, { N, r, p }, (err, derived) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(derived, storedKey));
    });
  });
}
