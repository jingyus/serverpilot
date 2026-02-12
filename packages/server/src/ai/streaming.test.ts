// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for packages/server/src/ai/streaming.ts
 *
 * Tests the streaming response handler including:
 * - streamAIResponse() - streaming AI requests
 * - Stream callbacks (onToken, onComplete, onError, onStart)
 * - Text accumulation
 * - Error handling
 * - Usage statistics
 * - createStreamAbortController()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  streamAIResponse,
  createStreamAbortController,
} from './streaming.js';
import type {
  StreamCallbacks,
  StreamRequestOptions,
  StreamResult,
  StreamUsage,
} from './streaming.js';

const STREAMING_FILE = path.resolve(__dirname, 'streaming.ts');

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a mock MessageStream that emits text events and resolves finalMessage */
function createMockStream(options: {
  textChunks: string[];
  usage?: { input_tokens: number; output_tokens: number };
  shouldError?: boolean;
  errorMessage?: string;
}) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};

  const stream = {
    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
      return stream;
    },
    finalMessage: vi.fn().mockImplementation(async () => {
      if (options.shouldError) {
        throw new Error(options.errorMessage ?? 'Stream error');
      }

      // Emit text events
      for (const chunk of options.textChunks) {
        for (const listener of listeners['text'] ?? []) {
          listener(chunk);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: options.textChunks.join(''),
          },
        ],
        usage: options.usage ?? { input_tokens: 10, output_tokens: 20 },
      };
    }),
  };

  return stream;
}

/** Create a mock Anthropic client that returns a mock stream */
function createMockClient(stream: any) {
  return {
    messages: {
      stream: vi.fn().mockReturnValue(stream),
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('src/ai/streaming.ts', () => {
  // --------------------------------------------------------------------------
  // File existence
  // --------------------------------------------------------------------------

  describe('File existence', () => {
    it('should exist at packages/server/src/ai/streaming.ts', () => {
      expect(existsSync(STREAMING_FILE)).toBe(true);
    });

    it('should be a non-empty TypeScript file', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Exports', () => {
    it('should export streamAIResponse function', () => {
      expect(streamAIResponse).toBeDefined();
      expect(typeof streamAIResponse).toBe('function');
    });

    it('should export createStreamAbortController function', () => {
      expect(createStreamAbortController).toBeDefined();
      expect(typeof createStreamAbortController).toBe('function');
    });
  });

  // --------------------------------------------------------------------------
  // streamAIResponse - Success cases
  // --------------------------------------------------------------------------

  describe('streamAIResponse - success', () => {
    it('should return accumulated text on successful stream', async () => {
      const mockStream = createMockStream({
        textChunks: ['Hello', ' world', '!'],
        usage: { input_tokens: 15, output_tokens: 3 },
      });
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'Say hello',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello world!');
      expect(result.error).toBeUndefined();
    });

    it('should return token usage statistics', async () => {
      const mockStream = createMockStream({
        textChunks: ['test'],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it('should call stream with correct parameters', async () => {
      const mockStream = createMockStream({ textChunks: ['ok'] });
      const mockClient = createMockClient(mockStream);

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-opus-4-20250514',
        maxTokens: 2048,
        prompt: 'test prompt',
        system: 'You are helpful.',
      });

      expect(mockClient.messages.stream).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.messages.stream.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-opus-4-20250514');
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
      expect(callArgs.system).toBe('You are helpful.');
    });

    it('should not include system when not provided', async () => {
      const mockStream = createMockStream({ textChunks: ['ok'] });
      const mockClient = createMockClient(mockStream);

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      const callArgs = mockClient.messages.stream.mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });

    it('should pass timeout as options when provided', async () => {
      const mockStream = createMockStream({ textChunks: ['ok'] });
      const mockClient = createMockClient(mockStream);

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
        timeoutMs: 30000,
      });

      expect(mockClient.messages.stream).toHaveBeenCalledTimes(1);
      const optionsArg = mockClient.messages.stream.mock.calls[0][1];
      expect(optionsArg).toEqual({ timeout: 30000 });
    });
  });

  // --------------------------------------------------------------------------
  // streamAIResponse - Callbacks
  // --------------------------------------------------------------------------

  describe('streamAIResponse - callbacks', () => {
    it('should call onStart when streaming begins', async () => {
      const mockStream = createMockStream({ textChunks: ['hello'] });
      const mockClient = createMockClient(mockStream);
      const onStart = vi.fn();

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
        callbacks: { onStart },
      });

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should call onToken for each text delta', async () => {
      const mockStream = createMockStream({ textChunks: ['Hello', ' ', 'world'] });
      const mockClient = createMockClient(mockStream);
      const onToken = vi.fn();

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
        callbacks: { onToken },
      });

      expect(onToken).toHaveBeenCalledTimes(3);
      // First call: token='Hello', accumulated='Hello'
      expect(onToken).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      // Second call: token=' ', accumulated='Hello '
      expect(onToken).toHaveBeenNthCalledWith(2, ' ', 'Hello ');
      // Third call: token='world', accumulated='Hello world'
      expect(onToken).toHaveBeenNthCalledWith(3, 'world', 'Hello world');
    });

    it('should call onComplete with final text and usage', async () => {
      const mockStream = createMockStream({
        textChunks: ['result'],
        usage: { input_tokens: 5, output_tokens: 1 },
      });
      const mockClient = createMockClient(mockStream);
      const onComplete = vi.fn();

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
        callbacks: { onComplete },
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('result', { inputTokens: 5, outputTokens: 1 });
    });

    it('should call onError when stream fails', async () => {
      const mockStream = createMockStream({
        textChunks: [],
        shouldError: true,
        errorMessage: 'Connection lost',
      });
      const mockClient = createMockClient(mockStream);
      const onError = vi.fn();

      await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
        callbacks: { onError },
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe('Connection lost');
    });

    it('should work without any callbacks', async () => {
      const mockStream = createMockStream({ textChunks: ['ok'] });
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // streamAIResponse - Error handling
  // --------------------------------------------------------------------------

  describe('streamAIResponse - error handling', () => {
    it('should return failure with error message when stream errors', async () => {
      const mockStream = createMockStream({
        textChunks: [],
        shouldError: true,
        errorMessage: 'Rate limit exceeded',
      });
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('should handle non-Error thrown objects', async () => {
      const mockStream = createMockStream({ textChunks: [] });
      mockStream.finalMessage.mockRejectedValue('string error');
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should return partial text accumulated before error', async () => {
      // Simulate partial streaming then error
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const mockStream = {
        on(event: string, listener: (...args: any[]) => void) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
          return mockStream;
        },
        finalMessage: vi.fn().mockImplementation(async () => {
          // Emit partial text then throw
          for (const listener of listeners['text'] ?? []) {
            listener('partial');
          }
          throw new Error('Connection lost mid-stream');
        }),
      };
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.text).toBe('partial');
      expect(result.error).toBe('Connection lost mid-stream');
    });

    it('should default usage to zero when stream errors', async () => {
      const mockStream = createMockStream({
        textChunks: [],
        shouldError: true,
      });
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // streamAIResponse - Fallback text extraction
  // --------------------------------------------------------------------------

  describe('streamAIResponse - text extraction', () => {
    it('should fall back to final message text if no tokens accumulated via events', async () => {
      // Stream that does not emit 'text' events but has final message content
      const mockStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'fallback text' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
      const mockClient = createMockClient(mockStream);

      const result = await streamAIResponse({
        client: mockClient as any,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        prompt: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('fallback text');
    });
  });

  // --------------------------------------------------------------------------
  // createStreamAbortController
  // --------------------------------------------------------------------------

  describe('createStreamAbortController', () => {
    it('should return an AbortController', () => {
      const controller = createStreamAbortController();
      expect(controller).toBeInstanceOf(AbortController);
    });

    it('should have an initially non-aborted signal', () => {
      const controller = createStreamAbortController();
      expect(controller.signal.aborted).toBe(false);
    });

    it('should support abort()', () => {
      const controller = createStreamAbortController();
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Code quality
  // --------------------------------------------------------------------------

  describe('Code quality', () => {
    it('should export StreamCallbacks interface', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain('export interface StreamCallbacks');
    });

    it('should export StreamUsage interface', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain('export interface StreamUsage');
    });

    it('should export StreamRequestOptions interface', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain('export interface StreamRequestOptions');
    });

    it('should export StreamResult interface', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain('export interface StreamResult');
    });

    it('should have JSDoc on exported functions', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain('* Execute a streaming AI request');
      expect(content).toContain('* Create an abort controller');
    });

    it('should import from @anthropic-ai/sdk', () => {
      const content = readFileSync(STREAMING_FILE, 'utf-8');
      expect(content).toContain("from '@anthropic-ai/sdk'");
    });
  });
});
