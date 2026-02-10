import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SnapshotManager, backupConfigs } from './snapshot.js';
import type { Snapshot } from './snapshot.js';

// ============================================================================
// Test helpers
// ============================================================================

let testDir: string;

function createTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  return dir;
}

function createTestFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ============================================================================
// SnapshotManager
// ============================================================================

describe('SnapshotManager', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // constructor
  // ============================================================================

  describe('constructor', () => {
    it('creates instance with default backup root', () => {
      const manager = new SnapshotManager();
      expect(manager).toBeInstanceOf(SnapshotManager);
    });

    it('creates instance with custom backup root', () => {
      const backupRoot = path.join(testDir, 'custom-backups');
      const manager = new SnapshotManager(backupRoot);
      expect(manager).toBeInstanceOf(SnapshotManager);
    });
  });

  // ============================================================================
  // createSnapshot
  // ============================================================================

  describe('createSnapshot', () => {
    it('creates a snapshot with unique id', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'config.json', '{"key":"value"}');
      const snapshot = await manager.createSnapshot([file]);
      expect(snapshot.id).toBeTruthy();
      expect(typeof snapshot.id).toBe('string');
    });

    it('records creation timestamp', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'config.json', '{}');
      const before = Date.now();
      const snapshot = await manager.createSnapshot([file]);
      const after = Date.now();
      expect(snapshot.createdAt).toBeGreaterThanOrEqual(before);
      expect(snapshot.createdAt).toBeLessThanOrEqual(after);
    });

    it('uses custom label', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'config.json', '{}');
      const snapshot = await manager.createSnapshot([file], { label: 'before-install' });
      expect(snapshot.label).toBe('before-install');
    });

    it('generates default label when not provided', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'config.json', '{}');
      const snapshot = await manager.createSnapshot([file]);
      expect(snapshot.label).toMatch(/^snapshot-/);
    });

    it('backs up existing files', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'original content');
      const snapshot = await manager.createSnapshot([file]);
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0].existed).toBe(true);
      expect(fs.existsSync(snapshot.entries[0].backupPath)).toBe(true);
      const backupContent = fs.readFileSync(snapshot.entries[0].backupPath, 'utf-8');
      expect(backupContent).toBe('original content');
    });

    it('records non-existing files with existed: false', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const nonExistent = path.join(testDir, 'does-not-exist.txt');
      const snapshot = await manager.createSnapshot([nonExistent]);
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0].existed).toBe(false);
    });

    it('handles multiple files', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file1 = createTestFile(testDir, 'a.txt', 'aaa');
      const file2 = createTestFile(testDir, 'b.txt', 'bbb');
      const nonExistent = path.join(testDir, 'c.txt');
      const snapshot = await manager.createSnapshot([file1, file2, nonExistent]);
      expect(snapshot.entries).toHaveLength(3);
      expect(snapshot.entries.filter((e) => e.existed)).toHaveLength(2);
    });

    it('handles empty file list', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const snapshot = await manager.createSnapshot([]);
      expect(snapshot.entries).toHaveLength(0);
    });
  });

  // ============================================================================
  // rollback
  // ============================================================================

  describe('rollback', () => {
    it('restores modified files to original content', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'config.json', 'original');
      const snapshot = await manager.createSnapshot([file]);

      // Modify the file
      fs.writeFileSync(file, 'modified', 'utf-8');
      expect(fs.readFileSync(file, 'utf-8')).toBe('modified');

      // Rollback
      await manager.rollback(snapshot.id);
      expect(fs.readFileSync(file, 'utf-8')).toBe('original');
    });

    it('removes newly created files', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const newFile = path.join(testDir, 'new-file.txt');
      const snapshot = await manager.createSnapshot([newFile]);
      expect(snapshot.entries[0].existed).toBe(false);

      // Create the file after snapshot
      fs.writeFileSync(newFile, 'new content', 'utf-8');
      expect(fs.existsSync(newFile)).toBe(true);

      // Rollback should remove it
      await manager.rollback(snapshot.id);
      expect(fs.existsSync(newFile)).toBe(false);
    });

    it('throws for unknown snapshot id', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      await expect(manager.rollback('nonexistent-id')).rejects.toThrow('Snapshot not found');
    });

    it('handles rollback when file was already deleted', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'to-delete.txt', 'content');
      const snapshot = await manager.createSnapshot([file]);

      // Delete the file
      fs.unlinkSync(file);

      // Rollback should restore it
      await manager.rollback(snapshot.id);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf-8')).toBe('content');
    });

    it('handles rollback when non-existing file was never created', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const newFile = path.join(testDir, 'never-created.txt');
      const snapshot = await manager.createSnapshot([newFile]);

      // File was never created, rollback should be no-op
      await manager.rollback(snapshot.id);
      expect(fs.existsSync(newFile)).toBe(false);
    });
  });

  // ============================================================================
  // cleanup
  // ============================================================================

  describe('cleanup', () => {
    it('removes backup directory', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const snapshot = await manager.createSnapshot([file]);
      expect(fs.existsSync(snapshot.backupDir)).toBe(true);

      await manager.cleanup(snapshot.id);
      expect(fs.existsSync(snapshot.backupDir)).toBe(false);
    });

    it('removes snapshot from registry', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const snapshot = await manager.createSnapshot([file]);
      expect(manager.getSnapshot(snapshot.id)).toBeDefined();

      await manager.cleanup(snapshot.id);
      expect(manager.getSnapshot(snapshot.id)).toBeUndefined();
    });

    it('throws for unknown snapshot id', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      await expect(manager.cleanup('nonexistent-id')).rejects.toThrow('Snapshot not found');
    });
  });

  // ============================================================================
  // getSnapshot
  // ============================================================================

  describe('getSnapshot', () => {
    it('returns snapshot by id', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const snapshot = await manager.createSnapshot([file]);
      const retrieved = manager.getSnapshot(snapshot.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(snapshot.id);
    });

    it('returns undefined for unknown id', () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      expect(manager.getSnapshot('nonexistent')).toBeUndefined();
    });
  });

  // ============================================================================
  // listSnapshots
  // ============================================================================

  describe('listSnapshots', () => {
    it('returns empty list initially', () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      expect(manager.listSnapshots()).toHaveLength(0);
    });

    it('returns all snapshots sorted by creation time (newest first)', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const s1 = await manager.createSnapshot([file], { label: 'first' });
      const s2 = await manager.createSnapshot([file], { label: 'second' });
      const list = manager.listSnapshots();
      expect(list).toHaveLength(2);
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
    });

    it('excludes cleaned up snapshots', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const s1 = await manager.createSnapshot([file]);
      const s2 = await manager.createSnapshot([file]);
      await manager.cleanup(s1.id);
      expect(manager.listSnapshots()).toHaveLength(1);
      expect(manager.listSnapshots()[0].id).toBe(s2.id);
    });
  });

  // ============================================================================
  // cleanupAll
  // ============================================================================

  describe('cleanupAll', () => {
    it('removes all snapshots', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      await manager.createSnapshot([file], { label: 'one' });
      await manager.createSnapshot([file], { label: 'two' });
      expect(manager.listSnapshots()).toHaveLength(2);

      await manager.cleanupAll();
      expect(manager.listSnapshots()).toHaveLength(0);
    });

    it('removes all backup directories', async () => {
      const manager = new SnapshotManager(path.join(testDir, 'backups'));
      const file = createTestFile(testDir, 'data.txt', 'content');
      const s1 = await manager.createSnapshot([file]);
      const s2 = await manager.createSnapshot([file]);
      const dirs = [s1.backupDir, s2.backupDir];

      await manager.cleanupAll();
      for (const dir of dirs) {
        expect(fs.existsSync(dir)).toBe(false);
      }
    });
  });
});

// ============================================================================
// backupConfigs convenience function
// ============================================================================

describe('backupConfigs', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns a snapshot and manager', async () => {
    const file = path.join(testDir, 'config.json');
    fs.writeFileSync(file, '{"key":"value"}', 'utf-8');
    const [snapshot, manager] = await backupConfigs([file], 'test-backup');
    expect(snapshot.label).toBe('test-backup');
    expect(snapshot.entries).toHaveLength(1);
    expect(manager).toBeInstanceOf(SnapshotManager);
    await manager.cleanup(snapshot.id);
  });

  it('allows rollback via returned manager', async () => {
    const file = path.join(testDir, 'data.txt');
    fs.writeFileSync(file, 'original', 'utf-8');
    const [snapshot, manager] = await backupConfigs([file]);

    fs.writeFileSync(file, 'modified', 'utf-8');
    await manager.rollback(snapshot.id);
    expect(fs.readFileSync(file, 'utf-8')).toBe('original');
    await manager.cleanup(snapshot.id);
  });
});
