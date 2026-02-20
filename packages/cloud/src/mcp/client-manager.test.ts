// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClientManager, getMCPClientManager, _resetMCPClientManager } from './client-manager.js';

// Mock MCP SDK
const mockConnect = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
}));

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('connectContext7', () => {
    it('should connect to Context7 with API key', async () => {
      await manager.connectContext7('test-api-key');

      expect(manager.isConnected('context7')).toBe(true);
      expect(mockConnect).toHaveBeenCalled();
    });

    it('should not reconnect if already connected', async () => {
      await manager.connectContext7('test-api-key');
      await manager.connectContext7('test-api-key');

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchDocs', () => {
    beforeEach(async () => {
      await manager.connectContext7('test-api-key');
    });

    it('should search docs with query', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Result 1' },
          { type: 'text', text: 'Result 2' },
        ],
      });

      const results = await manager.searchDocs({
        query: 'nginx reverse proxy',
      });

      expect(results).toEqual(['Result 1', 'Result 2']);
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          query: 'nginx reverse proxy',
          sources: undefined,
          max_results: 5,
        },
      });
    });

    it('should search docs with sources and maxResults', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Result 1' }],
      });

      await manager.searchDocs({
        query: 'docker compose',
        sources: ['docker', 'nginx'],
        maxResults: 3,
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          query: 'docker compose',
          sources: ['docker', 'nginx'],
          max_results: 3,
        },
      });
    });

    it('should filter out non-text content', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Valid result' },
          { type: 'image', url: 'https://example.com/image.png' },
          { type: 'text', text: '' }, // empty text
        ],
      });

      const results = await manager.searchDocs({
        query: 'test',
      });

      expect(results).toEqual(['Valid result']);
    });

    it('should throw error if not connected', async () => {
      const newManager = new MCPClientManager();

      await expect(
        newManager.searchDocs({ query: 'test' })
      ).rejects.toThrow('Context7 not connected');
    });

    it('should handle callTool errors', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        manager.searchDocs({ query: 'test' })
      ).rejects.toThrow('Context7 search failed: Network error');
    });
  });

  describe('fetchDocument', () => {
    beforeEach(async () => {
      await manager.connectContext7('test-api-key');
    });

    it('should fetch document by URL', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Document content line 1' },
          { type: 'text', text: 'Document content line 2' },
        ],
      });

      const content = await manager.fetchDocument('https://example.com/doc');

      expect(content).toBe('Document content line 1\n\nDocument content line 2');
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'fetch',
        arguments: { url: 'https://example.com/doc' },
      });
    });

    it('should throw error if not connected', async () => {
      const newManager = new MCPClientManager();

      await expect(
        newManager.fetchDocument('https://example.com/doc')
      ).rejects.toThrow('Context7 not connected');
    });
  });

  describe('disconnect', () => {
    it('should disconnect specific server', async () => {
      await manager.connectContext7('test-api-key');

      await manager.disconnect('context7');

      expect(manager.isConnected('context7')).toBe(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      await expect(manager.disconnect('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all servers', async () => {
      await manager.connectContext7('test-api-key');

      await manager.disconnectAll();

      expect(manager.getConnectedServers()).toEqual([]);
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return true for connected server', async () => {
      await manager.connectContext7('test-api-key');

      expect(manager.isConnected('context7')).toBe(true);
    });

    it('should return false for disconnected server', () => {
      expect(manager.isConnected('context7')).toBe(false);
    });
  });

  describe('getConnectedServers', () => {
    it('should return list of connected servers', async () => {
      await manager.connectContext7('test-api-key');

      expect(manager.getConnectedServers()).toEqual(['context7']);
    });

    it('should return empty array when no servers connected', () => {
      expect(manager.getConnectedServers()).toEqual([]);
    });
  });
});

describe('Singleton functions', () => {
  afterEach(async () => {
    await _resetMCPClientManager();
  });

  it('should return same instance on multiple calls', () => {
    const instance1 = getMCPClientManager();
    const instance2 = getMCPClientManager();

    expect(instance1).toBe(instance2);
  });

  it('should reset singleton instance', async () => {
    const instance1 = getMCPClientManager();
    await _resetMCPClientManager();
    const instance2 = getMCPClientManager();

    expect(instance1).not.toBe(instance2);
  });
});
