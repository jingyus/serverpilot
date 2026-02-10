/**
 * Operation history service — business logic for full audit trail logging.
 *
 * Records all operations with complete traceability, auto-syncs summaries
 * to server profiles, and provides filtering/search/stats capabilities.
 *
 * @module core/operation/operation-history-service
 */

import { getOperationRepository } from '../../db/repositories/operation-repository.js';
import { getProfileRepository } from '../../db/repositories/profile-repository.js';
import { getAutoLearner } from '../../knowledge/auto-learn.js';
import { logger } from '../../utils/logger.js';

import type {
  OperationRepository,
  OperationRecord,
  CreateOperationInput,
  OperationFilter,
  OperationStats,
  PaginationOptions,
} from '../../db/repositories/operation-repository.js';
import type { ProfileRepository } from '../../db/repositories/profile-repository.js';
import type { AutoLearner } from '../../knowledge/auto-learn.js';

// ============================================================================
// Types
// ============================================================================

export interface RecordOperationOptions {
  /** Auto-append a summary to the server's profile operation history. */
  syncToProfile?: boolean;
}

// ============================================================================
// Service
// ============================================================================

export class OperationHistoryService {
  private autoLearner: AutoLearner | null;

  constructor(
    private operationRepo: OperationRepository,
    private profileRepo: ProfileRepository,
    autoLearner?: AutoLearner | null,
  ) {
    this.autoLearner = autoLearner ?? null;
  }

  /**
   * Record a new operation in the audit log.
   *
   * Creates an operation record and optionally syncs a summary
   * to the server's profile history for AI context.
   */
  async recordOperation(
    input: CreateOperationInput,
    options: RecordOperationOptions = {},
  ): Promise<OperationRecord> {
    const { syncToProfile = true } = options;

    const record = await this.operationRepo.create(input);

    if (syncToProfile) {
      const summary = this.formatProfileSummary(record);
      await this.profileRepo.addOperationHistory(
        input.serverId,
        input.userId,
        summary,
      ).catch((err) => {
        // Non-critical: log but don't fail the operation
        logger.warn(
          { serverId: input.serverId, error: err },
          'Failed to sync operation to profile history',
        );
      });
    }

    logger.info(
      {
        operation: 'operation_recorded',
        operationId: record.id,
        serverId: input.serverId,
        type: input.type,
        riskLevel: input.riskLevel,
      },
      `Operation recorded: ${input.description}`,
    );

    return record;
  }

  /**
   * Mark operation as running and log the state transition.
   */
  async markRunning(
    operationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.operationRepo.markRunning(operationId, userId);

    if (result) {
      logger.info(
        { operation: 'operation_started', operationId },
        'Operation started',
      );
    }

    return result;
  }

  /**
   * Mark operation as complete, log the result, and sync to profile.
   */
  async markComplete(
    operationId: string,
    userId: string,
    output: string,
    status: 'success' | 'failed' | 'rolled_back',
    duration: number,
  ): Promise<boolean> {
    const result = await this.operationRepo.markComplete(
      operationId, userId, output, status, duration,
    );

    if (result) {
      const record = await this.operationRepo.getById(operationId, userId);
      if (record) {
        const completionSummary = this.formatCompletionSummary(record);
        await this.profileRepo.addOperationHistory(
          record.serverId,
          userId,
          completionSummary,
        ).catch((err) => {
          logger.warn(
            { operationId, error: err },
            'Failed to sync completion to profile history',
          );
        });
      }

      logger.info(
        { operation: 'operation_completed', operationId, status, duration },
        `Operation completed: ${status} (${duration}ms)`,
      );

      // Auto-learn from successful operations
      if (status === 'success' && record && this.autoLearner) {
        this.autoLearner.processWithPlatformResolution(record).catch((err) => {
          logger.warn(
            { operationId, error: err },
            'Failed to auto-learn from successful operation',
          );
        });
      }
    }

    return result;
  }

  /**
   * Get a single operation by ID.
   */
  async getById(
    operationId: string,
    userId: string,
  ): Promise<OperationRecord | null> {
    return this.operationRepo.getById(operationId, userId);
  }

  /**
   * List operations with advanced filtering, search, and pagination.
   */
  async listOperations(
    userId: string,
    filter: OperationFilter,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }> {
    return this.operationRepo.listWithFilter(userId, filter, pagination);
  }

  /**
   * Get aggregated statistics for operation history.
   */
  async getStats(
    userId: string,
    serverId?: string,
  ): Promise<OperationStats> {
    return this.operationRepo.getStats(userId, serverId);
  }

  /**
   * Format a profile-friendly summary for a newly created operation.
   */
  private formatProfileSummary(record: OperationRecord): string {
    const ts = record.createdAt;
    const cmds = record.commands.length > 0
      ? ` [${record.commands[0]}${record.commands.length > 1 ? ` +${record.commands.length - 1}` : ''}]`
      : '';
    return `[${ts}] ${record.type.toUpperCase()} (${record.riskLevel}) ${record.description}${cmds}`;
  }

  /**
   * Format a profile-friendly summary for a completed operation.
   */
  private formatCompletionSummary(record: OperationRecord): string {
    const ts = record.completedAt ?? new Date().toISOString();
    const dur = record.duration != null ? ` ${record.duration}ms` : '';
    return `[${ts}] COMPLETED ${record.status.toUpperCase()}${dur}: ${record.description}`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _service: OperationHistoryService | null = null;

export function getOperationHistoryService(): OperationHistoryService {
  if (!_service) {
    let autoLearner: AutoLearner | null = null;
    try {
      autoLearner = getAutoLearner();
    } catch {
      logger.warn('AutoLearner not available; auto-learning disabled');
    }
    _service = new OperationHistoryService(
      getOperationRepository(),
      getProfileRepository(),
      autoLearner,
    );
  }
  return _service;
}

export function setOperationHistoryService(
  service: OperationHistoryService,
): void {
  _service = service;
}

export function _resetOperationHistoryService(): void {
  _service = null;
}
