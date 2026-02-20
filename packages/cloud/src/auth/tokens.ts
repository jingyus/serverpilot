// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * JWT token generation for Cloud — same payload shape as server for compatibility.
 *
 * Uses JWT_SECRET from env; issuer/audience match server so server can verify.
 *
 * @module cloud/auth/tokens
 */

import { SignJWT } from 'jose';

const DEFAULT_ACCESS_EXPIRES = '15m';
const DEFAULT_REFRESH_EXPIRES = '7d';
const ISSUER = 'serverpilot';
const AUDIENCE = 'serverpilot-api';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Generate access + refresh token pair for a user.
 * Caller must have set JWT_SECRET in env (min 32 chars).
 */
export async function generateTokens(userId: string): Promise<TokenPair> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }
  const key = new TextEncoder().encode(secret);

  const [accessToken, refreshToken] = await Promise.all([
    new SignJWT({ type: 'access' } as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(process.env.JWT_ACCESS_EXPIRES ?? DEFAULT_ACCESS_EXPIRES)
      .sign(key),
    new SignJWT({ type: 'refresh' } as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(process.env.JWT_REFRESH_EXPIRES ?? DEFAULT_REFRESH_EXPIRES)
      .sign(key),
  ]);

  return { accessToken, refreshToken };
}
