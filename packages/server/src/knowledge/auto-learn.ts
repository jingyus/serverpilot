// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base auto-learning module.
 *
 * Automatically extracts and persists knowledge from successful operations.
 * When an install/config operation completes successfully, this module
 * extracts software name, platform, commands, and verification steps,
 * then saves them as reusable knowledge entries.
 *
 * Flow: operation success → extract info → check existing → create/update knowledge
 *
 * @module knowledge/auto-learn
 */

import { logger } from '../utils/logger.js';
import { getKnowledgeRepository } from '../db/repositories/knowledge-repository.js';
import { getProfileRepository } from '../db/repositories/profile-repository.js';
import type { OperationRecord } from '../db/repositories/operation-repository.js';
import type {
  KnowledgeRepository,
  Knowledge,
} from '../db/repositories/knowledge-repository.js';
import type { ProfileRepository } from '../db/repositories/profile-repository.js';
import type { KnowledgeEntry } from '../db/schema.js';

// ============================================================================
// Types
// ============================================================================

/** Learnable operation types that can produce reusable knowledge. */
const LEARNABLE_TYPES = new Set(['install', 'config']);

/** Extracted software info from an operation. */
export interface SoftwareInfo {
  software: string;
  platform: string;
}

/** Result of an auto-learn attempt. */
export interface AutoLearnResult {
  /** Whether knowledge was successfully learned. */
  learned: boolean;
  /** The knowledge entry that was created or updated, if any. */
  knowledge: Knowledge | null;
  /** Whether this was a new entry or an update to existing. */
  action: 'created' | 'updated' | 'skipped';
  /** Reason for skipping, if applicable. */
  reason?: string;
}

// ============================================================================
// Software Detection Patterns
// ============================================================================

/**
 * Patterns for extracting software names from operation descriptions.
 * Ordered by specificity — more specific patterns first.
 */
const DESCRIPTION_PATTERNS: RegExp[] = [
  // Chinese patterns
  /安装\s*(\S+)/,
  /配置\s*(\S+)/,
  /部署\s*(\S+)/,
  /设置\s*(\S+)/,
  // English patterns
  /install\s+(\S+)/i,
  /configure\s+(\S+)/i,
  /setup\s+(\S+)/i,
  /deploy\s+(\S+)/i,
];

/**
 * Patterns for extracting software names from commands.
 * Matches package manager install commands.
 */
const COMMAND_PATTERNS: RegExp[] = [
  // apt/apt-get
  /apt(?:-get)?\s+install\s+(?:-y\s+)?(\S+)/,
  // yum/dnf
  /(?:yum|dnf)\s+install\s+(?:-y\s+)?(\S+)/,
  // brew
  /brew\s+install\s+(\S+)/,
  // apk
  /apk\s+add\s+(\S+)/,
  // pip
  /pip3?\s+install\s+(\S+)/,
  // npm
  /npm\s+install\s+(?:-g\s+)?(\S+)/,
  // snap
  /snap\s+install\s+(\S+)/,
  // curl-based installs often have the software name in the URL
  /curl\s+.*\/([a-zA-Z][a-zA-Z0-9_-]+)\//,
];

/**
 * Patterns for detecting verification commands in the output.
 */
const VERIFICATION_PATTERNS: RegExp[] = [
  /(\S+)\s+--version/,
  /(\S+)\s+-v$/m,
  /(\S+)\s+version/,
  /(\S+)\s+status/,
  /systemctl\s+status\s+(\S+)/,
  /service\s+(\S+)\s+status/,
];

// ============================================================================
// Core AutoLearner
// ============================================================================

export class AutoLearner {
  constructor(
    private knowledgeRepo: KnowledgeRepository,
    private profileRepo: ProfileRepository,
  ) {}

  /**
   * Main entry point: process a completed operation for knowledge extraction.
   *
   * Only processes successful install/config operations. Extracts software
   * name, platform, commands, and verification steps, then creates or
   * updates knowledge in the cache.
   */
  async processSuccessfulOperation(
    record: OperationRecord,
  ): Promise<AutoLearnResult> {
    // Guard: only learn from eligible operations
    if (!this.shouldLearn(record)) {
      return {
        learned: false,
        knowledge: null,
        action: 'skipped',
        reason: `Not learnable: status=${record.status}, type=${record.type}`,
      };
    }

    // Extract software info
    const softwareInfo = this.extractSoftwareInfo(record);
    if (!softwareInfo) {
      return {
        learned: false,
        knowledge: null,
        action: 'skipped',
        reason: 'Could not extract software name from operation',
      };
    }

    // Build knowledge entry
    const entry = this.buildKnowledgeEntry(record);

    // Check for existing knowledge
    const existing = await this.knowledgeRepo.findBySoftwarePlatform(
      softwareInfo.software,
      softwareInfo.platform,
    );

    let knowledge: Knowledge;
    let action: 'created' | 'updated';

    if (existing) {
      // Update existing: merge commands, increment success count
      const mergedEntry = this.mergeKnowledgeEntries(existing.content, entry);
      await this.knowledgeRepo.update(existing.id, {
        content: mergedEntry,
      });
      await this.knowledgeRepo.recordUsage(existing.id);
      knowledge = {
        ...existing,
        content: mergedEntry,
        successCount: existing.successCount + 1,
      };
      action = 'updated';
    } else {
      // Create new knowledge entry
      knowledge = await this.knowledgeRepo.create({
        software: softwareInfo.software,
        platform: softwareInfo.platform,
        content: entry,
        source: 'auto_learn',
      });
      // Record the first successful usage
      await this.knowledgeRepo.recordUsage(knowledge.id);
      action = 'created';
    }

    logger.info(
      {
        operation: 'auto_learn',
        software: softwareInfo.software,
        platform: softwareInfo.platform,
        action,
        knowledgeId: knowledge.id,
      },
      `Knowledge auto-learned: ${softwareInfo.software} on ${softwareInfo.platform} (${action})`,
    );

    return { learned: true, knowledge, action };
  }

  /**
   * Determine if an operation is eligible for learning.
   *
   * Requirements:
   * - Status must be 'success'
   * - Type must be 'install' or 'config'
   * - Must have at least one command
   */
  shouldLearn(record: OperationRecord): boolean {
    return (
      record.status === 'success' &&
      LEARNABLE_TYPES.has(record.type) &&
      record.commands.length > 0
    );
  }

  /**
   * Extract software name and platform from an operation.
   *
   * Software detection priority:
   * 1. Operation description (e.g., "install caddy")
   * 2. Command patterns (e.g., "apt install caddy")
   *
   * Platform: extracted from server profile's OS info, or defaults
   * to 'unknown' if unavailable.
   */
  extractSoftwareInfo(record: OperationRecord): SoftwareInfo | null {
    const software = this.extractSoftwareName(record);
    if (!software) return null;

    const platform = this.extractPlatformFromRecord(record);

    return { software: software.toLowerCase(), platform };
  }

  /**
   * Extract the software name from the operation's description or commands.
   */
  extractSoftwareName(record: OperationRecord): string | null {
    // Try description first
    for (const pattern of DESCRIPTION_PATTERNS) {
      const match = record.description.match(pattern);
      if (match?.[1]) {
        return this.cleanSoftwareName(match[1]);
      }
    }

    // Fallback: try command patterns
    for (const cmd of record.commands) {
      for (const pattern of COMMAND_PATTERNS) {
        const match = cmd.match(pattern);
        if (match?.[1]) {
          return this.cleanSoftwareName(match[1]);
        }
      }
    }

    return null;
  }

  /**
   * Extract platform string from operation.
   *
   * Uses the serverId from the record to look up the server profile's
   * OS info. Falls back to 'unknown' if not available.
   */
  extractPlatformFromRecord(_record: OperationRecord): string {
    // Platform will be resolved asynchronously via resolvePlatform()
    // For sync extraction, we return a default
    return 'unknown';
  }

  /**
   * Asynchronously resolve the platform for an operation by looking up
   * the server profile.
   */
  async resolvePlatform(
    serverId: string,
    userId: string,
  ): Promise<string> {
    try {
      const profile = await this.profileRepo.getByServerId(serverId, userId);
      if (profile?.osInfo) {
        const { platform, version } = profile.osInfo;
        return `${platform}-${version}`.toLowerCase();
      }
    } catch (err) {
      logger.warn(
        { serverId, error: err },
        'Failed to resolve platform from profile',
      );
    }
    return 'unknown';
  }

  /**
   * Process a successful operation with platform resolution.
   *
   * This is the full async pipeline that resolves the platform from
   * the server profile before extracting knowledge.
   */
  async processWithPlatformResolution(
    record: OperationRecord,
  ): Promise<AutoLearnResult> {
    if (!this.shouldLearn(record)) {
      return {
        learned: false,
        knowledge: null,
        action: 'skipped',
        reason: `Not learnable: status=${record.status}, type=${record.type}`,
      };
    }

    const softwareName = this.extractSoftwareName(record);
    if (!softwareName) {
      return {
        learned: false,
        knowledge: null,
        action: 'skipped',
        reason: 'Could not extract software name from operation',
      };
    }

    const platform = await this.resolvePlatform(record.serverId, record.userId);
    const softwareInfo: SoftwareInfo = {
      software: softwareName.toLowerCase(),
      platform,
    };

    const entry = this.buildKnowledgeEntry(record);
    entry.platform = platform;

    const existing = await this.knowledgeRepo.findBySoftwarePlatform(
      softwareInfo.software,
      softwareInfo.platform,
    );

    let knowledge: Knowledge;
    let action: 'created' | 'updated';

    if (existing) {
      const mergedEntry = this.mergeKnowledgeEntries(existing.content, entry);
      await this.knowledgeRepo.update(existing.id, { content: mergedEntry });
      await this.knowledgeRepo.recordUsage(existing.id);
      knowledge = {
        ...existing,
        content: mergedEntry,
        successCount: existing.successCount + 1,
      };
      action = 'updated';
    } else {
      knowledge = await this.knowledgeRepo.create({
        software: softwareInfo.software,
        platform: softwareInfo.platform,
        content: entry,
        source: 'auto_learn',
      });
      await this.knowledgeRepo.recordUsage(knowledge.id);
      action = 'created';
    }

    logger.info(
      {
        operation: 'auto_learn',
        software: softwareInfo.software,
        platform: softwareInfo.platform,
        action,
        knowledgeId: knowledge.id,
      },
      `Knowledge auto-learned: ${softwareInfo.software} on ${softwareInfo.platform} (${action})`,
    );

    return { learned: true, knowledge, action };
  }

  /**
   * Build a KnowledgeEntry from an operation record.
   */
  buildKnowledgeEntry(record: OperationRecord): KnowledgeEntry {
    const commands = [...record.commands];
    const verification = this.extractVerificationCommand(record);
    const notes = this.extractNotes(record);

    return {
      commands,
      verification: verification ?? undefined,
      notes: notes.length > 0 ? notes : undefined,
    };
  }

  /**
   * Extract a verification command from the operation.
   *
   * Looks at the last few commands for version checks or status checks.
   * Also scans the output for version patterns.
   */
  extractVerificationCommand(record: OperationRecord): string | null {
    // Check the last commands for version/status patterns
    const lastCommands = record.commands.slice(-3);
    for (const cmd of lastCommands.reverse()) {
      for (const pattern of VERIFICATION_PATTERNS) {
        if (pattern.test(cmd)) {
          return cmd;
        }
      }
    }

    // Check output for version patterns to infer verification command
    if (record.output) {
      const versionMatch = record.output.match(/v?\d+\.\d+\.\d+/);
      if (versionMatch) {
        // Try to find the command that produced this output
        for (const cmd of lastCommands) {
          if (cmd.includes('version') || cmd.includes('-v')) {
            return cmd;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract notes from the operation output.
   *
   * Looks for warnings, prerequisites, and notable information
   * in the command output.
   */
  extractNotes(record: OperationRecord): string[] {
    const notes: string[] = [];

    if (!record.output) return notes;

    // Extract warnings
    const warningLines = record.output
      .split('\n')
      .filter((line) => /warning|warn|注意|提示/i.test(line))
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 200);

    if (warningLines.length > 0) {
      notes.push(...warningLines.slice(0, 3));
    }

    // Note if GPG keys were added
    if (record.output.includes('gpg') || record.commands.some((c) => c.includes('gpg'))) {
      notes.push('需要添加 GPG key');
    }

    // Note if external repositories were added
    if (record.commands.some((c) =>
      c.includes('add-apt-repository') ||
      c.includes('apt-key') ||
      c.includes('sources.list'),
    )) {
      notes.push('需要添加外部 APT 源');
    }

    return [...new Set(notes)]; // deduplicate
  }

  /**
   * Merge a new knowledge entry into an existing one.
   *
   * - Commands: replaces with the latest set (more recent = more accurate)
   * - Verification: uses the latest if available
   * - Notes: merges and deduplicates
   */
  mergeKnowledgeEntries(
    existing: KnowledgeEntry,
    incoming: KnowledgeEntry,
  ): KnowledgeEntry {
    // Use incoming commands (latest successful execution)
    const commands = incoming.commands;

    // Use incoming verification if available, otherwise keep existing
    const verification = incoming.verification ?? existing.verification;

    // Merge notes, deduplicate
    const existingNotes = existing.notes ?? [];
    const incomingNotes = incoming.notes ?? [];
    const allNotes = [...new Set([...existingNotes, ...incomingNotes])];

    return {
      commands,
      verification,
      notes: allNotes.length > 0 ? allNotes : undefined,
      platform: incoming.platform ?? existing.platform,
    };
  }

  /**
   * Clean up a software name extracted from text.
   *
   * Removes version numbers, flags, and other noise.
   */
  private cleanSoftwareName(raw: string): string {
    return raw
      .replace(/[=<>]+.*$/, '') // remove version specifiers (e.g., "node>=18")
      .replace(/^-+/, '') // remove leading dashes
      .replace(/@.*$/, '') // remove npm scopes/versions (e.g., "@latest")
      .replace(/['"]/g, '') // remove quotes
      .trim();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _autoLearner: AutoLearner | null = null;

export function getAutoLearner(): AutoLearner {
  if (!_autoLearner) {
    _autoLearner = new AutoLearner(
      getKnowledgeRepository(),
      getProfileRepository(),
    );
  }
  return _autoLearner;
}

export function setAutoLearner(learner: AutoLearner): void {
  _autoLearner = learner;
}

export function _resetAutoLearner(): void {
  _autoLearner = null;
}
