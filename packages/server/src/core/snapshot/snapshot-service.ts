/**
 * Snapshot Service — orchestrates pre-operation snapshot creation.
 *
 * Before risky command execution (YELLOW+ risk level), this service:
 * 1. Determines which files need to be backed up based on the command
 * 2. Sends a snapshot request to the Agent via WebSocket
 * 3. Waits for the Agent to capture file contents
 * 4. Stores the snapshot data in the database
 * 5. Links the snapshot to the operation record
 *
 * @module core/snapshot/snapshot-service
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createMessage, MessageType } from '@aiinstaller/shared';
import type { InstallServer } from '../../api/server.js';
import type {
  SnapshotRepository,
  CreateSnapshotInput,
  Snapshot,
} from '../../db/repositories/snapshot-repository.js';
import { getSnapshotRepository } from '../../db/repositories/snapshot-repository.js';
import type { SnapshotFile, SnapshotConfig } from '../../db/schema.js';
import { createContextLogger, logError } from '../../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for waiting on agent snapshot response (ms) */
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 15_000;

/** Maximum snapshot timeout (ms) */
const MAX_SNAPSHOT_TIMEOUT_MS = 60_000;

/** Default snapshot expiration in milliseconds (7 days) */
const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Risk levels that require automatic snapshots */
const SNAPSHOT_REQUIRED_RISK_LEVELS = new Set(['yellow', 'red', 'critical']);

// ============================================================================
// Config file mapping by command pattern
// ============================================================================

/**
 * Maps command patterns to config files that should be snapshotted.
 * When a command matches a pattern, the associated files are backed up.
 */
const COMMAND_SNAPSHOT_RULES: Array<{
  pattern: RegExp;
  files: string[];
  configType: SnapshotConfig['type'];
}> = [
  {
    pattern: /nginx/i,
    files: ['/etc/nginx/nginx.conf', '/etc/nginx/conf.d/default.conf'],
    configType: 'nginx',
  },
  {
    pattern: /mysql|mariadb|mysqld/i,
    files: ['/etc/mysql/my.cnf', '/etc/mysql/mysql.conf.d/mysqld.cnf'],
    configType: 'mysql',
  },
  {
    pattern: /redis/i,
    files: ['/etc/redis/redis.conf'],
    configType: 'redis',
  },
  {
    pattern: /cron|crontab/i,
    files: ['/etc/crontab', '/var/spool/cron/crontabs/root'],
    configType: 'crontab',
  },
  {
    pattern: /systemctl\s+(restart|stop|start|enable|disable)\s+(\S+)/,
    files: [],
    configType: 'other',
  },
  {
    pattern: /apt\s+(install|remove|purge)/i,
    files: ['/etc/apt/sources.list'],
    configType: 'other',
  },
];

// ============================================================================
// Zod Schemas
// ============================================================================

export const CreateSnapshotRequestSchema = z.object({
  /** Target server ID */
  serverId: z.string().min(1),
  /** User who initiated the operation */
  userId: z.string().min(1),
  /** WebSocket client ID of the agent */
  clientId: z.string().min(1),
  /** The command about to be executed */
  command: z.string().min(1),
  /** Risk level of the command */
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical']),
  /** Operation ID to link the snapshot to */
  operationId: z.string().optional(),
  /** Additional files to include in the snapshot */
  additionalFiles: z.array(z.string()).optional(),
  /** Timeout for waiting on agent response (ms) */
  timeoutMs: z.number().int().positive().max(MAX_SNAPSHOT_TIMEOUT_MS)
    .default(DEFAULT_SNAPSHOT_TIMEOUT_MS),
  /** Snapshot expiration duration (ms from now) */
  expirationMs: z.number().int().positive().default(DEFAULT_EXPIRATION_MS),
});

export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotRequestSchema>;

// ============================================================================
// SnapshotService
// ============================================================================

/** Result of a snapshot creation attempt */
export interface SnapshotResult {
  /** Whether the snapshot was created successfully */
  success: boolean;
  /** The snapshot record (if successful) */
  snapshot: Snapshot | null;
  /** Error message (if failed) */
  error?: string;
  /** Whether the snapshot was skipped (e.g., GREEN risk level) */
  skipped: boolean;
}

/** Pending snapshot request awaiting agent response */
interface PendingRequest {
  snapshotRequestId: string;
  serverId: string;
  userId: string;
  operationId?: string;
  command: string;
  expirationMs: number;
  resolve: (result: SnapshotResult) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class SnapshotService {
  /** Pending snapshot requests keyed by snapshotRequestId */
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(
    private server: InstallServer,
    private snapshotRepo: SnapshotRepository = getSnapshotRepository(),
  ) {}

  /**
   * Create a pre-operation snapshot if required by the command's risk level.
   *
   * For GREEN risk level, the snapshot is skipped.
   * For YELLOW+ risk levels, the service determines which files to backup,
   * requests the Agent to capture them, and stores the result.
   */
  async createPreOperationSnapshot(
    rawInput: CreateSnapshotRequest,
  ): Promise<SnapshotResult> {
    const input = CreateSnapshotRequestSchema.parse(rawInput);

    // Skip snapshots for low-risk (GREEN) operations
    if (!SNAPSHOT_REQUIRED_RISK_LEVELS.has(input.riskLevel)) {
      return { success: true, snapshot: null, skipped: true };
    }

    const logger = createContextLogger({
      serverId: input.serverId,
      clientId: input.clientId,
      userId: input.userId,
    });

    // Determine which files to snapshot based on the command
    const filesToSnapshot = this.resolveFilesForCommand(
      input.command,
      input.additionalFiles,
    );

    if (filesToSnapshot.length === 0) {
      logger.info(
        { command: input.command, riskLevel: input.riskLevel },
        'No files identified for snapshot, skipping',
      );
      return { success: true, snapshot: null, skipped: true };
    }

    logger.info(
      {
        command: input.command,
        riskLevel: input.riskLevel,
        files: filesToSnapshot,
      },
      'Creating pre-operation snapshot',
    );

    const snapshotRequestId = randomUUID();

    // Send snapshot request to the agent and wait for response
    const result = await new Promise<SnapshotResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(snapshotRequestId);
      }, input.timeoutMs);

      const pending: PendingRequest = {
        snapshotRequestId,
        serverId: input.serverId,
        userId: input.userId,
        operationId: input.operationId,
        command: input.command,
        expirationMs: input.expirationMs,
        resolve,
        timeoutHandle,
      };

      this.pendingRequests.set(snapshotRequestId, pending);

      try {
        this.server.send(
          input.clientId,
          createMessage(MessageType.SNAPSHOT_REQUEST, {
            snapshotRequestId,
            files: filesToSnapshot,
            label: `Pre-operation snapshot for: ${input.command}`,
          }),
        );
      } catch (err) {
        this.cleanupRequest(snapshotRequestId);
        resolve({
          success: false,
          snapshot: null,
          skipped: false,
          error: err instanceof Error ? err.message : 'Failed to send snapshot request',
        });
      }
    });

    if (result.success) {
      logger.info(
        { snapshotId: result.snapshot?.id, fileCount: result.snapshot?.files.length },
        'Pre-operation snapshot created successfully',
      );
    } else {
      logger.warn(
        { error: result.error },
        'Pre-operation snapshot creation failed',
      );
    }

    return result;
  }

  /**
   * Handle a snapshot response message from an agent.
   *
   * Called by the WebSocket message router when a `snapshot.response`
   * message is received. Processes the file data and stores the snapshot.
   *
   * @returns True if the response was matched to a pending request
   */
  async handleSnapshotResponse(payload: {
    snapshotRequestId: string;
    success: boolean;
    files: Array<{
      path: string;
      content?: string;
      mode?: number;
      owner?: string;
      existed?: boolean;
    }>;
    error?: string;
  }): Promise<boolean> {
    const pending = this.pendingRequests.get(payload.snapshotRequestId);
    if (!pending) return false;

    this.cleanupRequest(payload.snapshotRequestId);

    if (!payload.success) {
      pending.resolve({
        success: false,
        snapshot: null,
        skipped: false,
        error: payload.error ?? 'Agent failed to capture snapshot',
      });
      return true;
    }

    // Convert agent response files to SnapshotFile format
    const snapshotFiles: SnapshotFile[] = payload.files
      .filter((f) => f.existed !== false && f.content !== undefined)
      .map((f) => ({
        path: f.path,
        content: f.content!,
        mode: f.mode ?? 0o644,
        owner: f.owner ?? 'unknown',
      }));

    // Determine config types for the captured files
    const configs = this.classifyConfigs(snapshotFiles, pending.command);

    try {
      const expiresAt = new Date(Date.now() + pending.expirationMs);

      const snapshot = await this.snapshotRepo.create({
        serverId: pending.serverId,
        userId: pending.userId,
        operationId: pending.operationId,
        files: snapshotFiles,
        configs,
        expiresAt,
      });

      pending.resolve({
        success: true,
        snapshot,
        skipped: false,
      });
    } catch (err) {
      logError(err, { serverId: pending.serverId }, 'Failed to store snapshot');
      pending.resolve({
        success: false,
        snapshot: null,
        skipped: false,
        error: err instanceof Error ? err.message : 'Failed to store snapshot',
      });
    }

    return true;
  }

  /**
   * Check whether a given risk level requires a pre-operation snapshot.
   */
  requiresSnapshot(riskLevel: string): boolean {
    return SNAPSHOT_REQUIRED_RISK_LEVELS.has(riskLevel);
  }

  /**
   * Get the number of pending snapshot requests.
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
        snapshot: null,
        skipped: false,
        error: 'Service shutting down',
      });
      this.pendingRequests.delete(id);
    }
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  /**
   * Determine which files to snapshot based on the command to be executed.
   */
  private resolveFilesForCommand(
    command: string,
    additionalFiles?: string[],
  ): string[] {
    const files = new Set<string>();

    for (const rule of COMMAND_SNAPSHOT_RULES) {
      if (rule.pattern.test(command)) {
        for (const file of rule.files) {
          files.add(file);
        }
      }
    }

    // Extract file paths mentioned in the command itself
    const pathMatches = command.match(/\/[\w/.-]+/g);
    if (pathMatches) {
      for (const p of pathMatches) {
        // Only snapshot paths that look like config files
        if (p.startsWith('/etc/') || p.endsWith('.conf') || p.endsWith('.cfg') || p.endsWith('.ini')) {
          files.add(p);
        }
      }
    }

    if (additionalFiles) {
      for (const f of additionalFiles) {
        files.add(f);
      }
    }

    return Array.from(files);
  }

  /**
   * Classify captured files into config types based on their paths.
   */
  private classifyConfigs(
    files: SnapshotFile[],
    command: string,
  ): SnapshotConfig[] {
    return files.map((file) => {
      let type: SnapshotConfig['type'] = 'other';

      if (file.path.includes('nginx')) type = 'nginx';
      else if (file.path.includes('mysql') || file.path.includes('mariadb')) type = 'mysql';
      else if (file.path.includes('redis')) type = 'redis';
      else if (file.path.includes('cron')) type = 'crontab';

      return { type, path: file.path, content: file.content };
    });
  }

  private handleTimeout(snapshotRequestId: string): void {
    const pending = this.pendingRequests.get(snapshotRequestId);
    if (!pending) return;

    this.pendingRequests.delete(snapshotRequestId);

    const logger = createContextLogger({ serverId: pending.serverId });
    logger.warn(
      { snapshotRequestId, command: pending.command },
      'Snapshot request timed out',
    );

    pending.resolve({
      success: false,
      snapshot: null,
      skipped: false,
      error: 'Snapshot request timed out',
    });
  }

  private cleanupRequest(snapshotRequestId: string): void {
    const pending = this.pendingRequests.get(snapshotRequestId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(snapshotRequestId);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: SnapshotService | null = null;

/**
 * Get the global SnapshotService instance.
 *
 * @param server - The WebSocket server (required on first call)
 */
export function getSnapshotService(server?: InstallServer): SnapshotService {
  if (!_instance) {
    if (!server) {
      throw new Error('SnapshotService not initialized — provide an InstallServer on first call');
    }
    _instance = new SnapshotService(server);
  }
  return _instance;
}

/** Set a custom SnapshotService instance (for testing). */
export function setSnapshotService(service: SnapshotService): void {
  _instance = service;
}

/** Reset the singleton (for testing). */
export function _resetSnapshotService(): void {
  if (_instance) {
    _instance.shutdown();
  }
  _instance = null;
}
