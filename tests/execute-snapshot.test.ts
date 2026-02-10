/**
 * Tests for packages/agent/src/execute/snapshot.ts
 *
 * Snapshot module - system snapshot creation, rollback mechanism,
 * and configuration file backup.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  SnapshotManager,
  backupConfigs,
} from '../packages/agent/src/execute/snapshot.js';
import type {
  Snapshot,
  BackupEntry,
  SnapshotOptions,
} from '../packages/agent/src/execute/snapshot.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a unique temporary directory for each test. */
function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a temporary file with given content. */
function createTempFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ============================================================================
// File Existence
// ============================================================================

describe('execute/snapshot.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/execute/snapshot.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('execute/snapshot.ts - exports', () => {
  it('should export SnapshotManager class', () => {
    expect(SnapshotManager).toBeDefined();
    expect(typeof SnapshotManager).toBe('function');
  });

  it('should export backupConfigs function', () => {
    expect(backupConfigs).toBeDefined();
    expect(typeof backupConfigs).toBe('function');
  });
});

// ============================================================================
// SnapshotManager - constructor
// ============================================================================

describe('SnapshotManager - constructor', () => {
  it('should create an instance with default config', () => {
    const manager = new SnapshotManager();
    expect(manager).toBeInstanceOf(SnapshotManager);
  });

  it('should create an instance with custom backup root', () => {
    const tempDir = createTempDir();
    const manager = new SnapshotManager(tempDir);
    expect(manager).toBeInstanceOf(SnapshotManager);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should start with no snapshots', () => {
    const manager = new SnapshotManager();
    expect(manager.listSnapshots()).toEqual([]);
  });
});

// ============================================================================
// SnapshotManager.createSnapshot()
// ============================================================================

describe('SnapshotManager.createSnapshot()', () => {
  let tempDir: string;
  let backupRoot: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupRoot = createTempDir();
    manager = new SnapshotManager(backupRoot);
  });

  afterEach(async () => {
    await manager.cleanupAll();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should create a snapshot with a unique id', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{"key": "value"}');
    const snapshot = await manager.createSnapshot([filePath]);

    expect(snapshot.id).toBeDefined();
    expect(typeof snapshot.id).toBe('string');
    expect(snapshot.id.length).toBeGreaterThan(0);
  });

  it('should use provided label', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath], { label: 'my-snapshot' });

    expect(snapshot.label).toBe('my-snapshot');
  });

  it('should generate a default label when not provided', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);

    expect(snapshot.label).toMatch(/^snapshot-/);
  });

  it('should record createdAt timestamp', async () => {
    const before = Date.now();
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);
    const after = Date.now();

    expect(snapshot.createdAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.createdAt).toBeLessThanOrEqual(after);
  });

  it('should backup an existing file', async () => {
    const content = 'original content';
    const filePath = createTempFile(tempDir, 'file.txt', content);
    const snapshot = await manager.createSnapshot([filePath]);

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].existed).toBe(true);
    expect(snapshot.entries[0].originalPath).toBe(path.resolve(filePath));
    expect(existsSync(snapshot.entries[0].backupPath)).toBe(true);
    expect(readFileSync(snapshot.entries[0].backupPath, 'utf-8')).toBe(content);
  });

  it('should handle non-existent files gracefully', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.txt');
    const snapshot = await manager.createSnapshot([nonExistentPath]);

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].existed).toBe(false);
    expect(existsSync(snapshot.entries[0].backupPath)).toBe(false);
  });

  it('should backup multiple files', async () => {
    const file1 = createTempFile(tempDir, 'a.txt', 'aaa');
    const file2 = createTempFile(tempDir, 'b.txt', 'bbb');
    const file3 = path.join(tempDir, 'c.txt'); // non-existent

    const snapshot = await manager.createSnapshot([file1, file2, file3]);

    expect(snapshot.entries).toHaveLength(3);
    expect(snapshot.entries[0].existed).toBe(true);
    expect(snapshot.entries[1].existed).toBe(true);
    expect(snapshot.entries[2].existed).toBe(false);
  });

  it('should register snapshot in the manager', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);

    const retrieved = manager.getSnapshot(snapshot.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(snapshot.id);
  });

  it('should create unique IDs for multiple snapshots', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snap1 = await manager.createSnapshot([filePath]);
    const snap2 = await manager.createSnapshot([filePath]);

    expect(snap1.id).not.toBe(snap2.id);
  });

  it('should use custom backupRoot when specified in options', async () => {
    const customRoot = createTempDir();
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath], { backupRoot: customRoot });

    expect(snapshot.backupDir.startsWith(customRoot)).toBe(true);
    rmSync(customRoot, { recursive: true, force: true });
  });

  it('should handle empty file list', async () => {
    const snapshot = await manager.createSnapshot([]);
    expect(snapshot.entries).toHaveLength(0);
  });
});

// ============================================================================
// SnapshotManager.rollback()
// ============================================================================

describe('SnapshotManager.rollback()', () => {
  let tempDir: string;
  let backupRoot: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupRoot = createTempDir();
    manager = new SnapshotManager(backupRoot);
  });

  afterEach(async () => {
    await manager.cleanupAll();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should restore a modified file to its original content', async () => {
    const originalContent = 'original';
    const filePath = createTempFile(tempDir, 'config.json', originalContent);

    const snapshot = await manager.createSnapshot([filePath]);

    // Modify the file
    writeFileSync(filePath, 'modified', 'utf-8');
    expect(readFileSync(filePath, 'utf-8')).toBe('modified');

    // Rollback
    await manager.rollback(snapshot.id);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  it('should remove a newly created file that did not exist at snapshot time', async () => {
    const newFilePath = path.join(tempDir, 'new-file.txt');

    const snapshot = await manager.createSnapshot([newFilePath]);
    expect(existsSync(newFilePath)).toBe(false);

    // Create the file after snapshot
    writeFileSync(newFilePath, 'should be removed', 'utf-8');
    expect(existsSync(newFilePath)).toBe(true);

    // Rollback should remove it
    await manager.rollback(snapshot.id);
    expect(existsSync(newFilePath)).toBe(false);
  });

  it('should handle rollback when file was deleted after snapshot', async () => {
    const content = 'should be restored';
    const filePath = createTempFile(tempDir, 'config.json', content);

    const snapshot = await manager.createSnapshot([filePath]);

    // Delete the file
    rmSync(filePath);
    expect(existsSync(filePath)).toBe(false);

    // Rollback should restore it
    await manager.rollback(snapshot.id);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });

  it('should rollback multiple files', async () => {
    const file1 = createTempFile(tempDir, 'a.txt', 'aaa');
    const file2 = createTempFile(tempDir, 'b.txt', 'bbb');

    const snapshot = await manager.createSnapshot([file1, file2]);

    // Modify both files
    writeFileSync(file1, 'modified-a', 'utf-8');
    writeFileSync(file2, 'modified-b', 'utf-8');

    // Rollback
    await manager.rollback(snapshot.id);
    expect(readFileSync(file1, 'utf-8')).toBe('aaa');
    expect(readFileSync(file2, 'utf-8')).toBe('bbb');
  });

  it('should throw for unknown snapshot ID', async () => {
    await expect(manager.rollback('nonexistent-id')).rejects.toThrow('Snapshot not found');
  });

  it('should handle rollback of a non-existent file that was never created', async () => {
    const nonExistentPath = path.join(tempDir, 'never-existed.txt');
    const snapshot = await manager.createSnapshot([nonExistentPath]);

    // File was never created after snapshot either
    await manager.rollback(snapshot.id);
    expect(existsSync(nonExistentPath)).toBe(false);
  });
});

// ============================================================================
// SnapshotManager.cleanup()
// ============================================================================

describe('SnapshotManager.cleanup()', () => {
  let tempDir: string;
  let backupRoot: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupRoot = createTempDir();
    manager = new SnapshotManager(backupRoot);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should remove backup directory', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);

    expect(existsSync(snapshot.backupDir)).toBe(true);

    await manager.cleanup(snapshot.id);
    expect(existsSync(snapshot.backupDir)).toBe(false);
  });

  it('should remove snapshot from registry', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);

    await manager.cleanup(snapshot.id);
    expect(manager.getSnapshot(snapshot.id)).toBeUndefined();
  });

  it('should throw for unknown snapshot ID', async () => {
    await expect(manager.cleanup('nonexistent-id')).rejects.toThrow('Snapshot not found');
  });

  it('should not affect original files', async () => {
    const content = 'keep me';
    const filePath = createTempFile(tempDir, 'config.json', content);
    const snapshot = await manager.createSnapshot([filePath]);

    await manager.cleanup(snapshot.id);

    // Original file should still exist unchanged
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });
});

// ============================================================================
// SnapshotManager.getSnapshot()
// ============================================================================

describe('SnapshotManager.getSnapshot()', () => {
  it('should return a snapshot by ID', async () => {
    const tempDir = createTempDir();
    const backupRoot = createTempDir();
    const manager = new SnapshotManager(backupRoot);
    const filePath = createTempFile(tempDir, 'config.json', '{}');

    const snapshot = await manager.createSnapshot([filePath]);
    const retrieved = manager.getSnapshot(snapshot.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(snapshot.id);
    expect(retrieved?.label).toBe(snapshot.label);

    await manager.cleanupAll();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should return undefined for unknown ID', () => {
    const manager = new SnapshotManager();
    expect(manager.getSnapshot('nonexistent')).toBeUndefined();
  });
});

// ============================================================================
// SnapshotManager.listSnapshots()
// ============================================================================

describe('SnapshotManager.listSnapshots()', () => {
  let tempDir: string;
  let backupRoot: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupRoot = createTempDir();
    manager = new SnapshotManager(backupRoot);
  });

  afterEach(async () => {
    await manager.cleanupAll();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should return empty array when no snapshots exist', () => {
    expect(manager.listSnapshots()).toEqual([]);
  });

  it('should list all created snapshots', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    await manager.createSnapshot([filePath], { label: 'snap-1' });
    await manager.createSnapshot([filePath], { label: 'snap-2' });

    const list = manager.listSnapshots();
    expect(list).toHaveLength(2);
  });

  it('should sort snapshots by creation time (newest first)', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snap1 = await manager.createSnapshot([filePath], { label: 'first' });
    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 5));
    const snap2 = await manager.createSnapshot([filePath], { label: 'second' });

    const list = manager.listSnapshots();
    expect(list[0].label).toBe('second');
    expect(list[1].label).toBe('first');
  });

  it('should update after cleanup', async () => {
    const filePath = createTempFile(tempDir, 'config.json', '{}');
    const snap1 = await manager.createSnapshot([filePath]);
    await manager.createSnapshot([filePath]);

    await manager.cleanup(snap1.id);
    expect(manager.listSnapshots()).toHaveLength(1);
  });
});

// ============================================================================
// SnapshotManager.cleanupAll()
// ============================================================================

describe('SnapshotManager.cleanupAll()', () => {
  it('should remove all snapshots and their backup directories', async () => {
    const tempDir = createTempDir();
    const backupRoot = createTempDir();
    const manager = new SnapshotManager(backupRoot);
    const filePath = createTempFile(tempDir, 'config.json', '{}');

    const snap1 = await manager.createSnapshot([filePath]);
    const snap2 = await manager.createSnapshot([filePath]);

    expect(existsSync(snap1.backupDir)).toBe(true);
    expect(existsSync(snap2.backupDir)).toBe(true);

    await manager.cleanupAll();

    expect(manager.listSnapshots()).toHaveLength(0);
    expect(existsSync(snap1.backupDir)).toBe(false);
    expect(existsSync(snap2.backupDir)).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should be safe to call on an empty manager', async () => {
    const manager = new SnapshotManager();
    await expect(manager.cleanupAll()).resolves.toBeUndefined();
  });
});

// ============================================================================
// backupConfigs() convenience function
// ============================================================================

describe('backupConfigs()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return a snapshot and a manager', async () => {
    const filePath = createTempFile(tempDir, 'npmrc', 'registry=https://registry.npmjs.org/');
    const [snapshot, manager] = await backupConfigs([filePath], 'backup-test');

    expect(snapshot).toBeDefined();
    expect(snapshot.id).toBeDefined();
    expect(snapshot.label).toBe('backup-test');
    expect(manager).toBeInstanceOf(SnapshotManager);

    await manager.cleanup(snapshot.id);
  });

  it('should allow rollback via the returned manager', async () => {
    const originalContent = 'original-config';
    const filePath = createTempFile(tempDir, 'config', originalContent);
    const [snapshot, manager] = await backupConfigs([filePath]);

    // Modify
    writeFileSync(filePath, 'modified-config', 'utf-8');

    // Rollback
    await manager.rollback(snapshot.id);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);

    await manager.cleanup(snapshot.id);
  });

  it('should backup multiple config files', async () => {
    const file1 = createTempFile(tempDir, '.bashrc', 'export PATH=...');
    const file2 = createTempFile(tempDir, '.npmrc', 'registry=...');

    const [snapshot, manager] = await backupConfigs([file1, file2]);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0].existed).toBe(true);
    expect(snapshot.entries[1].existed).toBe(true);

    await manager.cleanup(snapshot.id);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('SnapshotManager - edge cases', () => {
  let tempDir: string;
  let backupRoot: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupRoot = createTempDir();
    manager = new SnapshotManager(backupRoot);
  });

  afterEach(async () => {
    await manager.cleanupAll();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it('should handle files with special characters in name', async () => {
    const filePath = createTempFile(tempDir, 'config (copy).json', '{}');
    const snapshot = await manager.createSnapshot([filePath]);

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].existed).toBe(true);
  });

  it('should handle binary file content', async () => {
    const filePath = path.join(tempDir, 'binary.dat');
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    writeFileSync(filePath, binaryData);

    const snapshot = await manager.createSnapshot([filePath]);

    // Modify binary file
    writeFileSync(filePath, Buffer.from([0xaa, 0xbb]));

    // Rollback
    await manager.rollback(snapshot.id);
    const restored = readFileSync(filePath);
    expect(Buffer.compare(restored, binaryData)).toBe(0);
  });

  it('should handle creating snapshot then rollback then cleanup sequence', async () => {
    const content = 'step-by-step';
    const filePath = createTempFile(tempDir, 'flow.txt', content);

    // Step 1: Create snapshot
    const snapshot = await manager.createSnapshot([filePath], { label: 'flow-test' });
    expect(manager.listSnapshots()).toHaveLength(1);

    // Step 2: Modify file
    writeFileSync(filePath, 'changed', 'utf-8');

    // Step 3: Rollback
    await manager.rollback(snapshot.id);
    expect(readFileSync(filePath, 'utf-8')).toBe(content);

    // Step 4: Cleanup
    await manager.cleanup(snapshot.id);
    expect(manager.listSnapshots()).toHaveLength(0);
    expect(existsSync(snapshot.backupDir)).toBe(false);
  });

  it('should handle empty file backup and restore', async () => {
    const filePath = createTempFile(tempDir, 'empty.txt', '');
    const snapshot = await manager.createSnapshot([filePath]);

    writeFileSync(filePath, 'no longer empty', 'utf-8');

    await manager.rollback(snapshot.id);
    expect(readFileSync(filePath, 'utf-8')).toBe('');
  });
});
