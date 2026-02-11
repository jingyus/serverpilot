// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Password hashing utilities using Node.js built-in crypto.scrypt.
 *
 * Produces format: `scrypt:N:r:p:salt:hash` where all binary values
 * are hex-encoded. Uses recommended parameters for security (N=16384, r=8, p=1).
 *
 * @module utils/password
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;     // block size
const SCRYPT_P = 1;     // parallelization
const KEY_LEN = 64;     // output key length in bytes
const SALT_LEN = 32;    // salt length in bytes

/**
 * Hash a plaintext password using scrypt.
 *
 * @param password - The plaintext password to hash
 * @returns A formatted hash string: `scrypt:N:r:p:salt:hash`
 */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LEN);

    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) return reject(err);
      const hash = `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derived.toString('hex')}`;
      resolve(hash);
    });
  });
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param password - The plaintext password to check
 * @param storedHash - The stored hash string from `hashPassword()`
 * @returns `true` if the password matches
 */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return resolve(false);
    }

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
