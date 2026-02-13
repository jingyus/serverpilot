// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Ed25519 signature verification for Agent binary updates.
 *
 * Provides cryptographic verification of downloaded binaries using Ed25519
 * digital signatures. The Agent embeds trusted public keys and verifies
 * that update binaries are signed by a project maintainer's private key.
 *
 * Security features:
 * - Ed25519 signature verification (fast, secure, small keys)
 * - Dual public key support for key rotation
 * - Anti-rollback protection (version downgrade prevention)
 * - SHA-256 + Ed25519 double verification
 *
 * @module updater/signature-verifier
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

// ============================================================================
// Types
// ============================================================================

/** Result of signature verification */
export interface SignatureVerificationResult {
  /** Whether the signature is valid */
  valid: boolean;
  /** Which key was used to verify (if valid) */
  keyId?: string;
  /** Error message if verification failed */
  error?: string;
}

/** An Ed25519 public key with metadata */
export interface TrustedPublicKey {
  /** Unique identifier for this key */
  id: string;
  /** Base64-encoded Ed25519 public key (32 bytes) */
  publicKey: string;
  /** When this key was introduced (ISO date) */
  addedInVersion: string;
  /** After which version this key should be removed (empty = active) */
  deprecatedAfterVersion?: string;
}

/** Options for verifying an update binary */
export interface VerifyUpdateOptions {
  /** Path to the downloaded binary file */
  binaryPath: string;
  /** Base64-encoded Ed25519 signature */
  signature: string;
  /** Expected SHA-256 checksum (hex) */
  sha256?: string;
  /** Version of the new binary (for anti-rollback) */
  newVersion: string;
  /** Current agent version (for anti-rollback) */
  currentVersion: string;
}

// ============================================================================
// Trusted Public Keys
// ============================================================================

// Placeholder keys for development. In production, these would be replaced
// with the actual project maintainer's Ed25519 public keys during the build.
//
// To generate a key pair:
//   const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
//   publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
//
// The keys below are the raw 32-byte Ed25519 public keys, base64-encoded.

const TRUSTED_KEYS: TrustedPublicKey[] = [
  {
    id: 'primary-v1',
    publicKey: 'REPLACE_WITH_PRODUCTION_PUBLIC_KEY_V1',
    addedInVersion: '0.1.0',
  },
  // Next-generation key for rotation. During transition, both keys are trusted.
  // The old key is removed after 2 major versions.
  // {
  //   id: 'primary-v2',
  //   publicKey: 'REPLACE_WITH_PRODUCTION_PUBLIC_KEY_V2',
  //   addedInVersion: '1.0.0',
  // },
];

// ============================================================================
// Key Management
// ============================================================================

/**
 * Get all currently active trusted public keys.
 *
 * Filters out keys that have been deprecated beyond the current version.
 */
export function getActiveTrustedKeys(currentVersion: string): TrustedPublicKey[] {
  return TRUSTED_KEYS.filter((key) => {
    if (!key.deprecatedAfterVersion) return true;
    // Key is deprecated if currentVersion > deprecatedAfterVersion
    return compareVersionsSimple(currentVersion, key.deprecatedAfterVersion) <= 0;
  });
}

/**
 * Get all trusted keys (including deprecated ones). Useful for diagnostics.
 */
export function getAllTrustedKeys(): readonly TrustedPublicKey[] {
  return TRUSTED_KEYS;
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify an Ed25519 signature against file contents.
 *
 * Tries each active trusted key until one succeeds or all fail.
 *
 * @param data - The data that was signed
 * @param signatureBase64 - Base64-encoded Ed25519 signature (64 bytes)
 * @param currentVersion - Current agent version (for key filtering)
 * @returns Verification result
 */
export function verifySignature(
  data: Buffer,
  signatureBase64: string,
  currentVersion: string,
): SignatureVerificationResult {
  const activeKeys = getActiveTrustedKeys(currentVersion);

  if (activeKeys.length === 0) {
    return { valid: false, error: 'No active trusted keys available' };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch {
    return { valid: false, error: 'Invalid signature encoding: not valid base64' };
  }

  if (signature.length !== 64) {
    return {
      valid: false,
      error: `Invalid signature length: expected 64 bytes, got ${signature.length}`,
    };
  }

  for (const key of activeKeys) {
    try {
      const publicKeyDer = Buffer.from(key.publicKey, 'base64');
      const keyObject = createEd25519PublicKey(publicKeyDer);
      const isValid = crypto.verify(null, data, keyObject, signature);

      if (isValid) {
        return { valid: true, keyId: key.id };
      }
    } catch {
      // Key parsing/verification failed for this key; try the next one
      continue;
    }
  }

  return { valid: false, error: 'Signature does not match any trusted key' };
}

/**
 * Verify a downloaded binary file with full security checks.
 *
 * Performs all verification steps:
 * 1. Anti-rollback: new version must be greater than current
 * 2. SHA-256 checksum verification (if provided)
 * 3. Ed25519 signature verification
 *
 * @param options - Verification options
 * @returns Verification result
 */
export async function verifyUpdate(
  options: VerifyUpdateOptions,
): Promise<SignatureVerificationResult> {
  const { binaryPath, signature, sha256, newVersion, currentVersion } = options;

  // Step 1: Anti-rollback check
  if (compareVersionsSimple(newVersion, currentVersion) <= 0) {
    return {
      valid: false,
      error: `Version downgrade rejected: ${newVersion} <= ${currentVersion}`,
    };
  }

  // Step 2: Read the binary
  let binaryData: Buffer;
  try {
    binaryData = await fs.promises.readFile(binaryPath);
  } catch (err) {
    return {
      valid: false,
      error: `Failed to read binary file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 3: SHA-256 checksum verification (if provided)
  if (sha256) {
    const actualHash = crypto.createHash('sha256').update(binaryData).digest('hex');
    if (actualHash !== sha256) {
      return {
        valid: false,
        error: `SHA-256 checksum mismatch: expected ${sha256}, got ${actualHash}`,
      };
    }
  }

  // Step 4: Ed25519 signature verification
  return verifySignature(binaryData, signature, currentVersion);
}

// ============================================================================
// Signature File Parsing
// ============================================================================

/**
 * Parse a .sig file content.
 *
 * Signature files contain a single line with the base64-encoded Ed25519
 * signature of the binary file.
 *
 * @param content - Raw content of the .sig file
 * @returns The base64-encoded signature string
 */
export function parseSignatureFile(content: string): string {
  return content.trim();
}

/**
 * Download and parse a signature file from a URL.
 *
 * @param signatureUrl - URL of the .sig file
 * @param timeoutMs - Download timeout in milliseconds (default: 30000)
 * @returns The base64-encoded signature string
 */
export async function downloadSignature(
  signatureUrl: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(signatureUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to download signature: ${response.status} ${response.statusText}`,
      );
    }
    const text = await response.text();
    return parseSignatureFile(text);
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Key Pair Generation (for development/CI use)
// ============================================================================

/**
 * Generate a new Ed25519 key pair for signing.
 *
 * This is a utility for CI/CD pipelines and development.
 * The private key should NEVER be stored in source control.
 *
 * @returns Object with base64-encoded public and private keys
 */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    publicKey: pubDer.toString('base64'),
    privateKey: privDer.toString('base64'),
  };
}

/**
 * Sign data with an Ed25519 private key.
 *
 * This is a utility for CI/CD pipelines and development.
 *
 * @param data - The data to sign
 * @param privateKeyBase64 - Base64-encoded Ed25519 private key (PKCS8 DER)
 * @returns Base64-encoded signature
 */
export function signData(data: Buffer, privateKeyBase64: string): string {
  const privateKeyDer = Buffer.from(privateKeyBase64, 'base64');
  const keyObject = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, data, keyObject);
  return signature.toString('base64');
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Create a Node.js KeyObject from a raw Ed25519 public key.
 *
 * Ed25519 public keys in SPKI DER format have a fixed 12-byte header
 * followed by the 32-byte raw key. If the input is 32 bytes (raw key),
 * we prepend the SPKI header. If it's already in SPKI format, use as-is.
 */
function createEd25519PublicKey(keyData: Buffer): crypto.KeyObject {
  // SPKI header for Ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00
  const _SPKI_HEADER = Buffer.from('302a300506032b657003210', 'hex');

  let derBuffer: Buffer;
  if (keyData.length === 32) {
    // Raw 32-byte key — wrap in SPKI DER
    const spkiHeader = Buffer.from(
      '302a300506032b6570032100',
      'hex',
    );
    derBuffer = Buffer.concat([spkiHeader, keyData]);
  } else {
    // Assume already SPKI DER format
    derBuffer = keyData;
  }

  return crypto.createPublicKey({
    key: derBuffer,
    format: 'der',
    type: 'spki',
  });
}

/**
 * Simple semver comparison for version strings.
 *
 * @returns positive if a > b, negative if a < b, 0 if equal
 */
function compareVersionsSimple(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) return aVal - bVal;
  }

  return 0;
}
