// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnowledgeEnhancer } from './knowledge-enhancer.js';

// Mock MCP Client Manager
const mockConnectContext7 = vi.fn();
const mockSearchDocs = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../mcp/client-manager.js', () => ({
  getMCPClientManager: () => ({
    connectContext7: mockConnectContext7,
    searchDocs: mockSearchDocs,
    disconnect: mockDisconnect,
  }),
}));

describe('KnowledgeEnhancer', () => {
  let enhancer: KnowledgeEnhancer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (enhancer) {
      await enhancer.disconnect();
    }
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should connect to Context7 when enabled', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
      });

      await enhancer.initialize();

      expect(mockConnectContext7).toHaveBeenCalledWith('test-api-key');
    });

    it('should not connect when disabled', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: false,
        apiKey: 'test-api-key',
      });

      await enhancer.initialize();

      expect(mockConnectContext7).not.toHaveBeenCalled();
    });

    it('should not connect when no API key', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
      });

      await enhancer.initialize();

      expect(mockConnectContext7).not.toHaveBeenCalled();
    });

    it('should not reconnect if already connected', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
      });

      await enhancer.initialize();
      await enhancer.initialize();

      expect(mockConnectContext7).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors gracefully', async () => {
      mockConnectContext7.mockRejectedValueOnce(new Error('Connection failed'));

      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
      });

      await enhancer.initialize();

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('searchRelevantDocs', () => {
    beforeEach(async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
        maxResults: 3,
      });
      await enhancer.initialize();
    });

    it('should search docs for technical questions', async () => {
      mockSearchDocs.mockResolvedValueOnce([
        'Nginx reverse proxy configuration...',
        'WebSocket proxy setup...',
      ]);

      const context = await enhancer.searchRelevantDocs(
        'How to configure nginx reverse proxy for WebSocket?',
        200000
      );

      expect(mockSearchDocs).toHaveBeenCalledWith({
        query: 'How to configure nginx reverse proxy for WebSocket?',
        sources: ['nginx'],
        maxResults: 3,
      });
      expect(context).toContain('相关文档参考');
      expect(context).toContain('Nginx reverse proxy configuration');
    });

    it('should not search for non-technical messages', async () => {
      const context = await enhancer.searchRelevantDocs(
        'Hello, how are you?',
        200000
      );

      expect(mockSearchDocs).not.toHaveBeenCalled();
      expect(context).toBeNull();
    });

    it('should detect multiple tech keywords', async () => {
      mockSearchDocs.mockResolvedValueOnce(['Docker Compose setup...']);

      await enhancer.searchRelevantDocs(
        'How to setup docker with nginx?',
        200000
      );

      expect(mockSearchDocs).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: expect.arrayContaining(['docker', 'nginx']),
        })
      );
    });

    it('should use default sources when no specific sources detected', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
        defaultSources: ['python', 'bash'],
      });
      await enhancer.initialize();

      mockSearchDocs.mockResolvedValueOnce(['Python tutorial...']);

      await enhancer.searchRelevantDocs(
        'How to setup python virtual environment?',
        200000
      );

      expect(mockSearchDocs).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ['python'],
        })
      );
    });

    it('should return null when no results found', async () => {
      mockSearchDocs.mockResolvedValueOnce([]);

      const context = await enhancer.searchRelevantDocs(
        'How to configure nginx?',
        200000
      );

      expect(context).toBeNull();
    });

    it('should limit context by token budget', async () => {
      const longDoc = 'A'.repeat(10000); // Very long document
      mockSearchDocs.mockResolvedValueOnce([longDoc, longDoc, longDoc]);

      const context = await enhancer.searchRelevantDocs(
        'How to configure nginx?',
        100000 // 100K context window
      );

      expect(context).not.toBeNull();
      // Token budget: 10% of 100K = 10K tokens ≈ 40K chars
      expect(context!.length).toBeLessThan(50000);
    });

    it('should handle search errors gracefully', async () => {
      mockSearchDocs.mockRejectedValueOnce(new Error('Network error'));

      const context = await enhancer.searchRelevantDocs(
        'How to configure nginx?',
        200000
      );

      expect(context).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });

    it('should return null when not enabled', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: false,
        apiKey: 'test-api-key',
      });

      const context = await enhancer.searchRelevantDocs(
        'How to configure nginx?',
        200000
      );

      expect(context).toBeNull();
      expect(mockSearchDocs).not.toHaveBeenCalled();
    });

    it('should detect Chinese question words', async () => {
      mockSearchDocs.mockResolvedValueOnce(['Docker 配置指南...']);

      await enhancer.searchRelevantDocs(
        '如何配置 docker 容器?',
        200000
      );

      expect(mockSearchDocs).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Context7', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: true,
        apiKey: 'test-api-key',
      });
      await enhancer.initialize();

      await enhancer.disconnect();

      expect(mockDisconnect).toHaveBeenCalledWith('context7');
    });

    it('should not error when disconnecting without initializing', async () => {
      enhancer = new KnowledgeEnhancer({
        enabled: false,
      });

      await expect(enhancer.disconnect()).resolves.not.toThrow();
    });
  });
});
