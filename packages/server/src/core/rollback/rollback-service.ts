/**
 * Rollback Service — orchestrates one-click rollback from snapshots.
 *
 * Restores files captured in a pre-operation snapshot by:
 * 1. Retrieving the snapshot data from the database
 * 2. Sending a rollback request to the Agent via WebSocket
 * 3. Waiting for the Agent to restore files
 * 4. Marking the associated operation as "rolled_back"
 *
 * @module core/rollback/rollback-service
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createMessage, MessageType } from '@aiinstaller/shared';
import type { RollbackFileResult } from '@aiinstaller/shared';
import type { InstallServer } from '../../api/server.js';
import type {
  SnapshotRepository,
  Snapshot,
} from '../../db/repositories/snapshot-repository.js';
import { getSnapshotRepository } from '../../db/repositories/snapshot-repository.js';
import type { OperationRepository } from '../../db/repositories/operation-repository.js';
import { getOperationRepository } from '../../db/repositories/operation-repository.js';
import { createContextLogger, logError } from '../../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for waiting on agent rollback response (ms) */
const DEFAULT_ROLLBACK_TIMEOUT_MS = 30_000;

/** Maximum rollback timeout (ms) */
const MAX_ROLLBACK_TIMEOUT_MS = 120_000;

// ============================================================================
// Zod Schemas
// ============================================================================

export const RollbackRequestSchema = z.object({
  /** Snapshot ID to rollback to */
  snapshotId: z.string().min(1),
  /** User who initiated the rollback */
  userId: z.string().min(1),
  /** WebSocket client ID of the agent */
  clientId: z.string().min(1),
  /** Reason for the rollback */
  reason: z.string().min(1).max(500).default('User-initiated rollback'),
  /** Timeout for waiting on agent response (ms) */
  timeoutMs: z.number().int().positive().max(MAX_ROLLBACK_TIMEOUT_MS)
    .default(DEFAULT_ROLLBACK_TIMEOUT_MS),
});

export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;

// ============================================================================
// Result Types
// ============================================================================

/** Result of a rollback attempt */
export interface RollbackResult {
  /** Whether the rollback was completed successfully */
  success: boolean;
  /** Snapshot that was rolled back to */
  snapshotId: string;
  /** Per-file rollback results */
  fileResults: RollbackFileResult[];
  /** Number of files successfully restored */
  restoredCount: number;
  /** Number of files that failed to restore */
  failedCount: number;
  /** Operation ID that was marked as rolled_back (if any) */
  operationId?: string;
  /** Error message (if failed) */
  error?: string;
}

/** Pending rollback request awaiting agent response */
interface PendingRollback {
  rollbackRequestId: string;
  snapshotId: string;
  userId: string;
  operationId: string | null;
  resolve: (result: RollbackResult) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// ============================================================================
// RollbackService
// ============================================================================

export class RollbackService {
  /** Pending rollback requests keyed by rollbackRequestId */
  private pendingRequests = new Map<string, PendingRollback>();

  constructor(
    private server: InstallServer,
    private snapshotRepo: SnapshotRepository = getSnapshotRepository(),
    private operationRepo: OperationRepository = getOperationRepository(),
  ) {}

  /**
   * Execute a one-click rollback to a snapshot.
   *
   * Retrieves the snapshot, sends file contents to the agent for
   * restoration, and marks the associated operation as rolled_back.
   */
  async rollback(rawInput: RollbackRequest): Promise<RollbackResult> {
    const input = RollbackRequestSchema.parse(rawInput);

    const logger = createContextLogger({
      userId: input.userId,
      clientId: input.clientId,
    });

    // 1. Retrieve the snapshot
    const snapshot = await this.snapshotRepo.getById(input.snapshotId, input.userId);
    if (!snapshot) {
      return {
        success: false,
        snapshotId: input.snapshotId,
        fileResults: [],
        restoredCount: 0,
        failedCount: 0,
        error: 'Snapshot not found or access denied',
      };
    }

    if (snapshot.files.length === 0) {
      return {
        success: false,
        snapshotId: input.snapshotId,
        fileResults: [],
        restoredCount: 0,
        failedCount: 0,
        error: 'Snapshot contains no files to restore',
      };
    }

    logger.info(
      {
        snapshotId: snapshot.id,
        fileCount: snapshot.files.length,
        operationId: snapshot.operationId,
      },
      'Starting rollback from snapshot',
    );

    const rollbackRequestId = randomUUID();

    // 2. Build file entries for the agent
    const files = snapshot.files.map((f) => ({
      path: f.path,
      content: f.content,
      mode: f.mode,
      owner: f.owner,
      existed: true,
    }));

    // 3. Send rollback request to agent and wait for response
    const result = await new Promise<RollbackResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(rollbackRequestId);
      }, input.timeoutMs);

      const pending: PendingRollback = {
        rollbackRequestId,
        snapshotId: snapshot.id,
        userId: input.userId,
        operationId: snapshot.operationId,
        resolve,
        timeoutHandle,
      };

      this.pendingRequests.set(rollbackRequestId, pending);

      try {
        this.server.send(
          input.clientId,
          createMessage(MessageType.ROLLBACK_REQUEST, {
            rollbackRequestId,
            snapshotId: snapshot.id,
            files,
            reason: input.reason,
          }),
        );
      } catch (err) {
        this.cleanupRequest(rollbackRequestId);
        resolve({
          success: false,
          snapshotId: snapshot.id,
          fileResults: [],
          restoredCount: 0,
          failedCount: 0,
          error: err instanceof Error ? err.message : 'Failed to send rollback request',
        });
      }
    });

    // 4. Mark operation as rolled_back if successful
    if (result.success && snapshot.operationId) {
      try {
        await this.operationRepo.markComplete(
          snapshot.operationId,
          input.userId,
          `Rolled back via snapshot ${snapshot.id}: ${input.reason}`,
          'rolled_back',
          0,
        );
        result.operationId = snapshot.operationId;
      } catch (err) {
        logError(
          err,
          { snapshotId: snapshot.id, operationId: snapshot.operationId },
          'Failed to mark operation as rolled_back',
        );
      }
    }

    if (result.success) {
      logger.info(
        {
          snapshotId: snapshot.id,
          restoredCount: result.restoredCount,
          operationId: result.operationId,
        },
        'Rollback completed successfully',
      );
    } else {
      logger.warn(
        { snapshotId: snapshot.id, error: result.error },
        'Rollback failed',
      );
    }

    return result;
  }

  /**
   * Handle a rollback response message from an agent.
   *
   * Called by the WebSocket message router when a `rollback.response`
   * message is received.
   *
   * @returns True if the response was matched to a pending request
   */
  async handleRollbackResponse(payload: {
    rollbackRequestId: string;
    success: boolean;
    fileResults: RollbackFileResult[];
    error?: string;
  }): Promise<boolean> {
    const pending = this.pendingRequests.get(payload.rollbackRequestId);
    if (!pending) return false;

    this.cleanupRequest(payload.rollbackRequestId);

    const restoredCount = payload.fileResults.filter((r) => r.success).length;
    const failedCount = payload.fileResults.filter((r) => !r.success).length;

    pending.resolve({
      success: payload.success,
      snapshotId: pending.snapshotId,
      fileResults: payload.fileResults,
      restoredCount,
      failedCount,
      error: payload.error,
    });

    return true;
  }

  /**
   * Get the number of pending rollback requests.
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Cancel all pending requests. Called during shutdown.
   */
  shutdown(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve({
        success: false,
        snapshotId: pending.snapshotId,
        fileResults: [],
        restoredCount: 0,
        failedCount: 0,
        error: 'Service shutting down',
      });
      this.pendingRequests.delete(id);
    }
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private handleTimeout(rollbackRequestId: string): void {
    const pending = this.pendingRequests.get(rollbackRequestId);
    if (!pending) return;

    this.pendingRequests.delete(rollbackRequestId);

    const logger = createContextLogger({ userId: pending.userId });
    logger.warn(
      { rollbackRequestId, snapshotId: pending.snapshotId },
      'Rollback request timed out',
    );

    pending.resolve({
      success: false,
      snapshotId: pending.snapshotId,
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
      error: 'Rollback request timed out',
    });
  }

  private cleanupRequest(rollbackRequestId: string): void {
    const pending = this.pendingRequests.get(rollbackRequestId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(rollbackRequestId);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: RollbackService | null = null;

/**
 * Get the global RollbackService instance.
 *
 * @param server - The WebSocket server (required on first call)
 */
export function getRollbackService(server?: InstallServer): RollbackService {
  if (!_instance) {
    if (!server) {
      throw new Error('RollbackService not initialized — provide an InstallServer on first call');
    }
    _instance = new RollbackService(server);
  }
  return _instance;
}

/** Set a custom RollbackService instance (for testing). */
export function setRollbackService(service: RollbackService): void {
  _instance = service;
}

/** Reset the singleton (for testing). */
export function _resetRollbackService(): void {
  if (_instance) {
    _instance.shutdown();
  }
  _instance = null;
}
