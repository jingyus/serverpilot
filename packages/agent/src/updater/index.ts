// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agent self-update module.
 *
 * Provides functionality to:
 * - Check for new versions from the server
 * - Download and verify new binaries
 * - Replace the current executable with the new version
 *
 * @module updater
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { AGENT_VERSION } from '../index.js';
import { verifyUpdate, downloadSignature } from './signature-verifier.js';

// ============================================================================
// Types
// ============================================================================

export interface VersionCheckResult {
  /** Latest available version */
  latest: string;
  /** Current agent version */
  current: string;
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Whether update is mandatory (current version is deprecated) */
  forceUpdate: boolean;
  /** Release date of latest version */
  releaseDate: string;
  /** Release notes */
  releaseNotes: string;
  /** Direct download URL for the binary */
  downloadUrl?: string;
  /** SHA256 checksum for verification */
  sha256?: string;
  /** URL to download the Ed25519 signature file (.sig) */
  signatureUrl?: string;
  /** Binary size in bytes */
  size?: number;
}

export interface UpdateProgress {
  /** Current phase */
  phase: 'downloading' | 'verifying' | 'installing' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  percent: number;
  /** Downloaded bytes */
  downloadedBytes?: number;
  /** Total bytes */
  totalBytes?: number;
  /** Error message if phase is 'error' */
  error?: string;
}

export type ProgressCallback = (progress: UpdateProgress) => void;

export interface UpdateOptions {
  /** Server URL for version checks */
  serverUrl: string;
  /** Progress callback */
  onProgress?: ProgressCallback;
  /** Skip checksum verification */
  skipVerify?: boolean;
}

// ============================================================================
// Version checking
// ============================================================================

/**
 * Check for available updates.
 *
 * @param serverUrl - Server URL to check against
 * @returns Version check result
 */
export async function checkForUpdates(serverUrl: string): Promise<VersionCheckResult> {
  const platform = os.platform() as 'darwin' | 'linux' | 'win32';
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';

  // Convert ws:// to http:// for REST API
  const httpUrl = serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
  const url = `${httpUrl}/api/v1/agent/version?current=${AGENT_VERSION}&platform=${platform}&arch=${arch}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to check for updates: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<VersionCheckResult>;
}

// ============================================================================
// Update download and installation
// ============================================================================

/**
 * Download and install the latest version.
 *
 * @param options - Update options
 * @returns True if update was successful
 */
export async function performUpdate(options: UpdateOptions): Promise<boolean> {
  const { serverUrl, onProgress, skipVerify } = options;

  // Phase 1: Check for updates
  const versionInfo = await checkForUpdates(serverUrl);
  if (!versionInfo.updateAvailable) {
    return false;
  }

  if (!versionInfo.downloadUrl) {
    throw new Error('No download URL available for this platform');
  }

  // Anti-rollback: reject version downgrades
  if (compareVersions(versionInfo.latest, AGENT_VERSION) <= 0) {
    throw new Error(
      `Version downgrade rejected: ${versionInfo.latest} <= ${AGENT_VERSION}`,
    );
  }

  // Phase 2: Download new binary
  onProgress?.({ phase: 'downloading', percent: 0 });

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `ai-installer-update-${Date.now()}`);

  await downloadBinary(versionInfo.downloadUrl, tempFile, (downloaded, total) => {
    const percent = total ? Math.round((downloaded / total) * 100) : 0;
    onProgress?.({
      phase: 'downloading',
      percent,
      downloadedBytes: downloaded,
      totalBytes: total,
    });
  });

  // Phase 3: Verify integrity (SHA-256 + Ed25519 signature)
  if (!skipVerify) {
    onProgress?.({ phase: 'verifying', percent: 0 });

    // Step 3a: SHA-256 checksum
    if (versionInfo.sha256) {
      const checksumValid = await verifyChecksum(tempFile, versionInfo.sha256);
      if (!checksumValid) {
        fs.unlinkSync(tempFile);
        throw new Error('SHA-256 checksum verification failed - download may be corrupted');
      }
    }

    onProgress?.({ phase: 'verifying', percent: 50 });

    // Step 3b: Ed25519 signature verification
    if (versionInfo.signatureUrl) {
      const signature = await downloadSignature(versionInfo.signatureUrl);
      const result = await verifyUpdate({
        binaryPath: tempFile,
        signature,
        sha256: versionInfo.sha256,
        newVersion: versionInfo.latest,
        currentVersion: AGENT_VERSION,
      });

      if (!result.valid) {
        fs.unlinkSync(tempFile);
        throw new Error(`Ed25519 signature verification failed: ${result.error}`);
      }
    }

    onProgress?.({ phase: 'verifying', percent: 100 });
  }

  // Phase 4: Install (replace current executable)
  onProgress?.({ phase: 'installing', percent: 0 });
  await installUpdate(tempFile);
  onProgress?.({ phase: 'installing', percent: 100 });

  onProgress?.({ phase: 'complete', percent: 100 });
  return true;
}

/**
 * Download a binary file with progress tracking.
 */
async function downloadBinary(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  let downloadedSize = 0;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response body reader');
  }

  const fileHandle = fs.openSync(destPath, 'w');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fs.writeSync(fileHandle, Buffer.from(value));
      downloadedSize += value.length;
      onProgress(downloadedSize, totalSize);
    }
  } finally {
    fs.closeSync(fileHandle);
  }

  // Make executable on Unix systems
  if (os.platform() !== 'win32') {
    fs.chmodSync(destPath, 0o755);
  }
}

/**
 * Verify file checksum matches expected value.
 */
async function verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      const actual = hash.digest('hex');
      resolve(actual === expectedSha256);
    });
  });
}

/**
 * Install the update by replacing the current executable.
 *
 * On Unix: Rename current to .old, move new to current location
 * On Windows: Schedule replacement via a helper batch file
 */
async function installUpdate(newBinaryPath: string): Promise<void> {
  const currentExe = process.execPath;
  const currentDir = path.dirname(currentExe);
  const currentName = path.basename(currentExe);

  // Skip if running from node (development mode)
  if (currentName === 'node' || currentName === 'bun') {
    throw new Error('Cannot self-update when running from node/bun. Use a compiled binary.');
  }

  if (os.platform() === 'win32') {
    // Windows: Create a batch script to replace the exe after exit
    const batchPath = path.join(currentDir, 'update.bat');
    const batchContent = `
@echo off
timeout /t 2 /nobreak > nul
move /y "${currentExe}" "${currentExe}.old"
move /y "${newBinaryPath}" "${currentExe}"
del "${currentExe}.old"
del "%~f0"
`;
    fs.writeFileSync(batchPath, batchContent);

    // Start the batch file in background
    const { spawn } = await import('node:child_process');
    spawn('cmd.exe', ['/c', batchPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    // Unix: Direct replacement
    const backupPath = `${currentExe}.old`;

    // Backup current
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.renameSync(currentExe, backupPath);
    } catch (err) {
      throw new Error(`Failed to backup current executable: ${err}`);
    }

    // Move new to current location
    try {
      fs.renameSync(newBinaryPath, currentExe);
    } catch (err) {
      // Restore backup on failure
      fs.renameSync(backupPath, currentExe);
      throw new Error(`Failed to install update: ${err}`);
    }

    // Clean up backup
    try {
      fs.unlinkSync(backupPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Version comparison utilities
// ============================================================================

/**
 * Compare two semantic version strings.
 *
 * @returns positive if a > b, negative if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  return 0;
}

/**
 * Check if a version satisfies a minimum version requirement.
 */
export function satisfiesMinVersion(current: string, minimum: string): boolean {
  return compareVersions(current, minimum) >= 0;
}
