// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Rollback handler for restoring files from snapshot data.
 *
 * Receives rollback requests from the server containing file contents
 * and restores them to their original paths. Handles:
 * - Writing file content back to the original path
 * - Restoring file permissions (mode) and ownership
 * - Removing files that didn't exist before the operation
 * - Reporting per-file success/failure results
 *
 * @module execute/rollback-handler
 */

import fs from 'node:fs';
import path from 'node:path';

import type { InstallClient } from '../client.js';
import { MessageType, createMessageLite as createMessage } from '../protocol-lite.js';
import type { Message } from '../protocol-lite.js';

// ============================================================================
// Types
// ============================================================================

/** File entry to restore during rollback */
export interface RollbackFileEntry {
  path: string;
  content: string;
  mode: number;
  owner: string;
  existed: boolean;
}

/** Result of restoring a single file */
export interface FileRestoreResult {
  path: string;
  success: boolean;
  error?: string;
}

/** Rollback request payload from the server */
export interface RollbackRequestPayload {
  rollbackRequestId: string;
  snapshotId: string;
  files: RollbackFileEntry[];
  reason: string;
}

// ============================================================================
// RollbackHandler
// ============================================================================

export class RollbackHandler {
  /**
   * Handle a rollback request from the server.
   *
   * Restores each file to its snapshot state and sends the
   * results back to the server.
   */
  async handleRollbackRequest(
    client: InstallClient,
    payload: RollbackRequestPayload,
  ): Promise<void> {
    const fileResults: FileRestoreResult[] = [];
    let overallSuccess = true;

    for (const file of payload.files) {
      const result = await this.restoreFile(file);
      fileResults.push(result);
      if (!result.success) {
        overallSuccess = false;
      }
    }

    const response = createMessage(MessageType.ROLLBACK_RESPONSE, {
      rollbackRequestId: payload.rollbackRequestId,
      success: overallSuccess,
      fileResults,
      ...(overallSuccess ? {} : { error: 'Some files failed to restore' }),
    });

    client.send(response);
  }

  /**
   * Restore a single file to its snapshot state.
   *
   * If the file existed at snapshot time, writes the content back
   * with the original permissions. If it didn't exist, removes the
   * file that was created during the operation.
   */
  async restoreFile(file: RollbackFileEntry): Promise<FileRestoreResult> {
    try {
      if (file.existed) {
        // Restore file content
        const dir = path.dirname(file.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file.path, file.content, { mode: file.mode });

        // Try to set ownership (requires root, best-effort)
        this.trySetOwnership(file.path, file.owner);
      } else {
        // File didn't exist before — remove it if it was created
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }

      return { path: file.path, success: true };
    } catch (err) {
      return {
        path: file.path,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Try to set file ownership. Best-effort; requires root privileges.
   */
  private trySetOwnership(filePath: string, owner: string): void {
    try {
      if (owner && owner !== 'unknown' && process.getuid?.() === 0) {
        const parts = owner.split(':');
        const uid = parseInt(parts[0], 10);
        const gid = parseInt(parts[1] ?? parts[0], 10);
        if (!isNaN(uid) && !isNaN(gid)) {
          fs.chownSync(filePath, uid, gid);
        }
      }
    } catch {
      // Best-effort — ownership change is not critical
    }
  }
}

// ============================================================================
// Message handler registration
// ============================================================================

/**
 * Register the rollback message handler on an InstallClient.
 *
 * Listens for `rollback.request` messages and processes them.
 */
export function registerRollbackHandler(client: InstallClient): RollbackHandler {
  const handler = new RollbackHandler();

  client.on('message', (msg: Message) => {
    if (msg.type === MessageType.ROLLBACK_REQUEST) {
      const payload = (msg as { payload: RollbackRequestPayload }).payload;
      handler.handleRollbackRequest(client, payload).catch(() => {
        // Error already captured per-file in fileResults
      });
    }
  });

  return handler;
}
