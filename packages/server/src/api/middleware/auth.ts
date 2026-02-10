/**
 * JWT authentication middleware for Hono REST API.
 *
 * Provides token generation (access + refresh), verification,
 * and a Hono middleware that protects routes by requiring a valid
 * Bearer token in the Authorization header.
 *
 * @module api/middleware/auth
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { ApiError } from './error-handler.js';
import type { ApiEnv } from '../routes/types.js';

// ============================================================================
// Configuration
// ============================================================================

/** JWT configuration schema with sensible defaults. */
const JwtConfigSchema = z.object({
  /** Secret key for signing tokens (min 32 chars for HS256 security). */
  secret: z.string().min(32, 'JWT secret must be at least 32 characters'),
  /** Access token lifetime (e.g. "15m", "1h"). */
  accessExpiresIn: z.string().default('15m'),
  /** Refresh token lifetime (e.g. "7d", "30d"). */
  refreshExpiresIn: z.string().default('7d'),
  /** Token issuer claim. */
  issuer: z.string().default('serverpilot'),
  /** Token audience claim. */
  audience: z.string().default('serverpilot-api'),
});

export type JwtConfig = z.infer<typeof JwtConfigSchema>;

/** Parsed and validated JWT configuration (initialized lazily). */
let _config: JwtConfig | null = null;
let _secretKey: Uint8Array | null = null;

/**
 * Initialize JWT configuration.
 *
 * Must be called before using any JWT functions. Validates the config
 * and encodes the secret key for use with the `jose` library.
 *
 * @param config - Raw JWT configuration (will be validated with Zod)
 * @throws {Error} If config validation fails
 */
export function initJwtConfig(config: Partial<JwtConfig> & { secret: string }): void {
  _config = JwtConfigSchema.parse(config);
  _secretKey = new TextEncoder().encode(_config.secret);
}

/**
 * Get the current JWT config (throws if not initialized).
 */
function getConfig(): JwtConfig {
  if (!_config) {
    throw new Error('JWT config not initialized. Call initJwtConfig() first.');
  }
  return _config;
}

/**
 * Get the encoded secret key (throws if not initialized).
 */
function getSecretKey(): Uint8Array {
  if (!_secretKey) {
    throw new Error('JWT config not initialized. Call initJwtConfig() first.');
  }
  return _secretKey;
}

// ============================================================================
// Token Payload Types
// ============================================================================

/** Claims embedded in an access token. */
export interface AccessTokenPayload {
  /** User ID (subject claim). */
  sub: string;
  /** Token type discriminator. */
  type: 'access';
}

/** Claims embedded in a refresh token. */
export interface RefreshTokenPayload {
  /** User ID (subject claim). */
  sub: string;
  /** Token type discriminator. */
  type: 'refresh';
}

/** Token pair returned after login or refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Result of verifying a token. */
export interface VerifyResult {
  userId: string;
  type: 'access' | 'refresh';
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate an access + refresh token pair for a user.
 *
 * @param userId - The user's unique ID (stored as `sub` claim)
 * @returns A promise resolving to the access/refresh token pair
 *
 * @example
 * ```ts
 * const tokens = await generateTokens('user-123');
 * // { accessToken: 'eyJ...', refreshToken: 'eyJ...' }
 * ```
 */
export async function generateTokens(userId: string): Promise<TokenPair> {
  const config = getConfig();
  const key = getSecretKey();

  const [accessToken, refreshToken] = await Promise.all([
    new SignJWT({ type: 'access' } as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime(config.accessExpiresIn)
      .sign(key),

    new SignJWT({ type: 'refresh' } as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime(config.refreshExpiresIn)
      .sign(key),
  ]);

  return { accessToken, refreshToken };
}

// ============================================================================
// Token Verification
// ============================================================================

/**
 * Verify and decode a JWT token.
 *
 * @param token - The raw JWT string
 * @param expectedType - Expected token type ('access' or 'refresh')
 * @returns Decoded user ID and token type
 * @throws {ApiError} 401 if token is invalid, expired, or wrong type
 *
 * @example
 * ```ts
 * const result = await verifyToken(token, 'access');
 * // { userId: 'user-123', type: 'access' }
 * ```
 */
export async function verifyToken(
  token: string,
  expectedType: 'access' | 'refresh',
): Promise<VerifyResult> {
  const config = getConfig();
  const key = getSecretKey();

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
    });

    const sub = payload.sub;
    const type = payload.type as string | undefined;

    if (!sub) {
      throw ApiError.unauthorized('Invalid token: missing subject');
    }

    if (type !== expectedType) {
      throw ApiError.unauthorized(
        `Invalid token type: expected ${expectedType}, got ${type ?? 'none'}`,
      );
    }

    return { userId: sub, type: expectedType };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (err instanceof joseErrors.JWTExpired) {
      throw ApiError.unauthorized('Token expired');
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw ApiError.unauthorized('Token validation failed');
    }
    if (
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWSInvalid
    ) {
      throw ApiError.unauthorized('Invalid token signature');
    }

    throw ApiError.unauthorized('Invalid token');
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware that requires a valid access token.
 *
 * Extracts the Bearer token from the Authorization header,
 * verifies it, and stores the user ID in context as `userId`.
 * Throws 401 if the token is missing, invalid, or expired.
 *
 * @example
 * ```ts
 * // Protect a single route
 * app.get('/me', requireAuth, (c) => {
 *   const userId = c.get('userId');
 *   return c.json({ userId });
 * });
 *
 * // Protect all routes in a group
 * app.use('/api/v1/servers/*', requireAuth);
 * ```
 */
export async function requireAuth(c: Context<ApiEnv>, next: Next): Promise<void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    throw ApiError.unauthorized('Missing Authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Invalid Authorization format, expected: Bearer <token>');
  }

  const token = authHeader.slice(7);

  if (!token) {
    throw ApiError.unauthorized('Missing token');
  }

  const result = await verifyToken(token, 'access');
  c.set('userId', result.userId);

  await next();
}

// ============================================================================
// Reset (for testing)
// ============================================================================

/**
 * Reset JWT configuration. Only use in tests.
 * @internal
 */
export function _resetJwtConfig(): void {
  _config = null;
  _secretKey = null;
}
