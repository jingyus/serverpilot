// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the RollbackHandler.
 *
 * Validates file restoration, ownership handling, error cases,
 * and message handler registration.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InstallClient } from '../client.js';
import { MessageType } from '../protocol-lite.js';
import type { RollbackFileEntry, RollbackRequestPayload } from './rollback-handler.js';
import { RollbackHandler, registerRollbackHandler } from './rollback-handler.js';

// ============================================================================
// Test helpers
// ============================================================================

let testDir: string;

function createTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-test-'));
}

function createTestFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createMockClient(): InstallClient {
  return {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as InstallClient;
}

// ============================================================================
// RollbackHandler
// ============================================================================

describe('RollbackHandler', () => {
  let handler: RollbackHandler;

  beforeEach(() => {
    testDir = createTestDir();
    handler = new RollbackHandler();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // restoreFile — file existed
  // ============================================================================

  describe('restoreFile — file existed', () => {
    it('should restore file content', async () => {
      const filePath = path.join(testDir, 'config.conf');
      fs.writeFileSync(filePath, 'modified content');

      const entry: RollbackFileEntry = {
        path: filePath,
        content: 'original content',
        mode: 0o644,
        owner: 'unknown',
        existed: true,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(true);
      expect(result.path).toBe(filePath);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('original content');
    });

    it('should create parent directories if missing', async () => {
      const deepPath = path.join(testDir, 'deep', 'nested', 'config.conf');

      const entry: RollbackFileEntry = {
        path: deepPath,
        content: 'restored',
        mode: 0o644,
        owner: 'unknown',
        existed: true,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(deepPath, 'utf-8')).toBe('restored');
    });

    it('should restore file to a path that was deleted after operation', async () => {
      const filePath = path.join(testDir, 'deleted.conf');
      // File does not exist — restoreFile should create it

      const entry: RollbackFileEntry = {
        path: filePath,
        content: 'restored content',
        mode: 0o644,
        owner: 'unknown',
        existed: true,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('restored content');
    });
  });

  // ============================================================================
  // restoreFile — file did not exist
  // ============================================================================

  describe('restoreFile — file did not exist', () => {
    it('should remove file that was created during operation', async () => {
      const filePath = createTestFile(testDir, 'new-file.conf', 'new content');

      const entry: RollbackFileEntry = {
        path: filePath,
        content: '',
        mode: 0o644,
        owner: 'unknown',
        existed: false,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should succeed when file to remove does not exist', async () => {
      const filePath = path.join(testDir, 'nonexistent.conf');

      const entry: RollbackFileEntry = {
        path: filePath,
        content: '',
        mode: 0o644,
        owner: 'unknown',
        existed: false,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // restoreFile — error handling
  // ============================================================================

  describe('restoreFile — error handling', () => {
    it('should return error when path is invalid', async () => {
      const entry: RollbackFileEntry = {
        path: '/dev/null/impossible/path/config.conf',
        content: 'content',
        mode: 0o644,
        owner: 'unknown',
        existed: true,
      };

      const result = await handler.restoreFile(entry);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleRollbackRequest
  // ============================================================================

  describe('handleRollbackRequest', () => {
    it('should restore all files and send success response', async () => {
      const client = createMockClient();
      const file1 = path.join(testDir, 'file1.conf');
      const file2 = path.join(testDir, 'file2.conf');
      fs.writeFileSync(file1, 'modified1');
      fs.writeFileSync(file2, 'modified2');

      const payload: RollbackRequestPayload = {
        rollbackRequestId: 'req-1',
        snapshotId: 'snap-1',
        files: [
          { path: file1, content: 'original1', mode: 0o644, owner: 'unknown', existed: true },
          { path: file2, content: 'original2', mode: 0o644, owner: 'unknown', existed: true },
        ],
        reason: 'Test rollback',
      };

      await handler.handleRollbackRequest(client, payload);

      // Verify files were restored
      expect(fs.readFileSync(file1, 'utf-8')).toBe('original1');
      expect(fs.readFileSync(file2, 'utf-8')).toBe('original2');

      // Verify response was sent
      expect(client.send).toHaveBeenCalledOnce();
      const sentMsg = vi.mocked(client.send).mock.calls[0][0] as {
        type: string;
        payload: {
          rollbackRequestId: string;
          success: boolean;
          fileResults: Array<{ path: string; success: boolean }>;
        };
      };
      expect(sentMsg.type).toBe(MessageType.ROLLBACK_RESPONSE);
      expect(sentMsg.payload.rollbackRequestId).toBe('req-1');
      expect(sentMsg.payload.success).toBe(true);
      expect(sentMsg.payload.fileResults).toHaveLength(2);
      expect(sentMsg.payload.fileResults[0].success).toBe(true);
      expect(sentMsg.payload.fileResults[1].success).toBe(true);
    });

    it('should report partial failure', async () => {
      const client = createMockClient();
      const file1 = path.join(testDir, 'ok.conf');
      fs.writeFileSync(file1, 'modified');

      const payload: RollbackRequestPayload = {
        rollbackRequestId: 'req-2',
        snapshotId: 'snap-2',
        files: [
          { path: file1, content: 'original', mode: 0o644, owner: 'unknown', existed: true },
          { path: '/dev/null/impossible', content: 'x', mode: 0o644, owner: 'unknown', existed: true },
        ],
        reason: 'Test partial failure',
      };

      await handler.handleRollbackRequest(client, payload);

      // First file should be restored
      expect(fs.readFileSync(file1, 'utf-8')).toBe('original');

      // Response should report partial failure
      const sentMsg = vi.mocked(client.send).mock.calls[0][0] as {
        payload: {
          success: boolean;
          fileResults: Array<{ path: string; success: boolean; error?: string }>;
          error?: string;
        };
      };
      expect(sentMsg.payload.success).toBe(false);
      expect(sentMsg.payload.fileResults[0].success).toBe(true);
      expect(sentMsg.payload.fileResults[1].success).toBe(false);
      expect(sentMsg.payload.error).toBe('Some files failed to restore');
    });

    it('should handle empty file list', async () => {
      const client = createMockClient();

      const payload: RollbackRequestPayload = {
        rollbackRequestId: 'req-3',
        snapshotId: 'snap-3',
        files: [],
        reason: 'Empty rollback',
      };

      await handler.handleRollbackRequest(client, payload);

      const sentMsg = vi.mocked(client.send).mock.calls[0][0] as {
        payload: { success: boolean; fileResults: unknown[] };
      };
      expect(sentMsg.payload.success).toBe(true);
      expect(sentMsg.payload.fileResults).toHaveLength(0);
    });
  });

  // ============================================================================
  // registerRollbackHandler
  // ============================================================================

  describe('registerRollbackHandler', () => {
    it('should register message listener on client', () => {
      const client = createMockClient();

      const handler = registerRollbackHandler(client);

      expect(handler).toBeInstanceOf(RollbackHandler);
      expect(client.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle rollback.request messages', async () => {
      const client = createMockClient();
      let messageHandler: ((msg: unknown) => void) | undefined;

      vi.mocked(client.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      }) as typeof client.on);

      registerRollbackHandler(client);

      expect(messageHandler).toBeDefined();

      const filePath = createTestFile(testDir, 'handler-test.conf', 'old content');

      // Simulate incoming rollback request
      messageHandler!({
        type: MessageType.ROLLBACK_REQUEST,
        payload: {
          rollbackRequestId: 'req-handler',
          snapshotId: 'snap-handler',
          files: [
            { path: filePath, content: 'restored', mode: 0o644, owner: 'unknown', existed: true },
          ],
          reason: 'Handler test',
        },
        timestamp: Date.now(),
      });

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('restored');
      expect(client.send).toHaveBeenCalledOnce();
    });

    it('should ignore non-rollback messages', () => {
      const client = createMockClient();
      let messageHandler: ((msg: unknown) => void) | undefined;

      vi.mocked(client.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      }) as typeof client.on);

      registerRollbackHandler(client);

      // Send a non-rollback message
      messageHandler!({
        type: 'step.execute',
        payload: {},
        timestamp: Date.now(),
      });

      // No response should be sent
      expect(client.send).not.toHaveBeenCalled();
    });
  });
});
