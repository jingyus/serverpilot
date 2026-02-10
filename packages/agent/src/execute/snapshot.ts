/**
 * Snapshot module for system state capture and rollback.
 *
 * Provides functionality to:
 * - Create system snapshots before installation steps
 * - Rollback to a previous snapshot if something goes wrong
 * - Backup and restore configuration files
 *
 * @module execute/snapshot
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/** Represents a single backed-up file. */
export interface BackupEntry {
  /** Original absolute path of the file. */
  originalPath: string;
  /** Path where the backup copy is stored. */
  backupPath: string;
  /** Whether the file existed at snapshot time. */
  existed: boolean;
}

/** A system snapshot capturing the state at a point in time. */
export interface Snapshot {
  /** Unique identifier for this snapshot. */
  id: string;
  /** Human-readable label describing what the snapshot is for. */
  label: string;
  /** Timestamp (ms since epoch) when the snapshot was created. */
  createdAt: number;
  /** List of files backed up in this snapshot. */
  entries: BackupEntry[];
  /** Root directory where backup files are stored. */
  backupDir: string;
}

/** Options for creating a snapshot. */
export interface SnapshotOptions {
  /** Human-readable label for the snapshot. */
  label?: string;
  /** Root directory to store backups (default: OS temp dir). */
  backupRoot?: string;
}

// ============================================================================
// SnapshotManager
// ============================================================================

/**
 * Manages system snapshots for safe rollback during installation.
 *
 * The SnapshotManager creates backup copies of specified files before
 * an installation step executes, and can restore them if the step fails.
 *
 * @example
 * ```ts
 * const manager = new SnapshotManager();
 *
 * // Create a snapshot before making changes
 * const snapshot = await manager.createSnapshot(
 *   ['/etc/config.json', '~/.bashrc'],
 *   { label: 'before-install' }
 * );
 *
 * // ... perform installation ...
 *
 * // If something goes wrong, rollback
 * await manager.rollback(snapshot.id);
 *
 * // Clean up when done
 * await manager.cleanup(snapshot.id);
 * ```
 */
export class SnapshotManager {
  private readonly snapshots: Map<string, Snapshot> = new Map();
  private readonly defaultBackupRoot: string;

  /**
   * Create a new SnapshotManager.
   *
   * @param backupRoot - Default root directory for storing backups.
   *                     Defaults to a subdirectory in the OS temp directory.
   */
  constructor(backupRoot?: string) {
    this.defaultBackupRoot = backupRoot ?? path.join(
      fs.realpathSync(require('node:os').tmpdir()),
      'aiinstaller-snapshots',
    );
  }

  /**
   * Create a snapshot of the specified files.
   *
   * Copies each file to a temporary backup location. Files that do not exist
   * are recorded with `existed: false` so rollback can remove newly created files.
   *
   * @param filePaths - Absolute paths of files to back up.
   * @param options - Snapshot options.
   * @returns The created Snapshot descriptor.
   */
  async createSnapshot(
    filePaths: string[],
    options: SnapshotOptions = {},
  ): Promise<Snapshot> {
    const id = randomUUID();
    const backupRoot = options.backupRoot ?? this.defaultBackupRoot;
    const backupDir = path.join(backupRoot, id);
    const label = options.label ?? `snapshot-${id.slice(0, 8)}`;

    // Ensure backup directory exists
    fs.mkdirSync(backupDir, { recursive: true });

    const entries: BackupEntry[] = [];

    for (const filePath of filePaths) {
      const resolved = path.resolve(filePath);
      const existed = fs.existsSync(resolved);
      // Create a safe backup filename based on path hash
      const safeName = resolved.replace(/[/\\:]/g, '_');
      const backupPath = path.join(backupDir, safeName);

      if (existed) {
        fs.copyFileSync(resolved, backupPath);
      }

      entries.push({
        originalPath: resolved,
        backupPath,
        existed,
      });
    }

    const snapshot: Snapshot = {
      id,
      label,
      createdAt: Date.now(),
      entries,
      backupDir,
    };

    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  /**
   * Rollback to a previously created snapshot.
   *
   * For each entry in the snapshot:
   * - If the file existed at snapshot time, restore it from backup.
   * - If the file did not exist at snapshot time, delete the current file
   *   (to undo newly created files).
   *
   * @param snapshotId - The ID of the snapshot to rollback to.
   * @throws {Error} If the snapshot ID is not found.
   */
  async rollback(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    for (const entry of snapshot.entries) {
      if (entry.existed) {
        // Restore from backup
        const backupExists = fs.existsSync(entry.backupPath);
        if (backupExists) {
          // Ensure parent directory exists
          const parentDir = path.dirname(entry.originalPath);
          fs.mkdirSync(parentDir, { recursive: true });
          fs.copyFileSync(entry.backupPath, entry.originalPath);
        }
      } else {
        // File did not exist before — remove it if it was created
        if (fs.existsSync(entry.originalPath)) {
          fs.unlinkSync(entry.originalPath);
        }
      }
    }
  }

  /**
   * Clean up a snapshot's backup files.
   *
   * Removes the backup directory and its contents, and removes the
   * snapshot from the internal registry.
   *
   * @param snapshotId - The ID of the snapshot to clean up.
   * @throws {Error} If the snapshot ID is not found.
   */
  async cleanup(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    if (fs.existsSync(snapshot.backupDir)) {
      fs.rmSync(snapshot.backupDir, { recursive: true, force: true });
    }

    this.snapshots.delete(snapshotId);
  }

  /**
   * Get a snapshot by its ID.
   *
   * @param snapshotId - The snapshot ID.
   * @returns The snapshot, or undefined if not found.
   */
  getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * List all registered snapshots.
   *
   * @returns Array of all snapshots, sorted by creation time (newest first).
   */
  listSnapshots(): Snapshot[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  /**
   * Clean up all snapshots.
   *
   * Removes all backup directories and clears the internal registry.
   */
  async cleanupAll(): Promise<void> {
    const ids = Array.from(this.snapshots.keys());
    for (const id of ids) {
      await this.cleanup(id);
    }
  }
}

/**
 * Backup a list of configuration files and return a snapshot.
 *
 * Convenience function for quickly backing up config files before
 * making changes. Uses a shared SnapshotManager instance internally.
 *
 * @param filePaths - Paths to configuration files to back up.
 * @param label - Optional label for the snapshot.
 * @returns A tuple of [Snapshot, SnapshotManager] for later rollback/cleanup.
 *
 * @example
 * ```ts
 * const [snapshot, manager] = await backupConfigs(
 *   ['/home/user/.npmrc', '/home/user/.bashrc'],
 *   'before-npm-config-change'
 * );
 *
 * // ... make changes ...
 *
 * // On failure:
 * await manager.rollback(snapshot.id);
 * await manager.cleanup(snapshot.id);
 * ```
 */
export async function backupConfigs(
  filePaths: string[],
  label?: string,
): Promise<[Snapshot, SnapshotManager]> {
  const manager = new SnapshotManager();
  const snapshot = await manager.createSnapshot(filePaths, { label });
  return [snapshot, manager];
}
