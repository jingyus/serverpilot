// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Token Counting Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  extractClaudeTokens,
  extractOpenAITokens,
  extractTokenUsage,
  mergeTokenUsage,
  isValidTokenUsage,
  safeTokenUsage,
} from './token-counting.js';

describe('extractClaudeTokens', () => {
  it('should extract tokens from valid Claude response', () => {
    const response = {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    };

    const result = extractClaudeTokens(response);
    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it('should extract cache tokens from Claude response', () => {
    const response = {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      },
    };

    const result = extractClaudeTokens(response);
    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 300,
    });
  });

  it('should default non-numeric cache fields to 0', () => {
    const response = {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: undefined,
      },
    };

    const result = extractClaudeTokens(response);
    expect(result?.cacheCreationInputTokens).toBe(0);
    expect(result?.cacheReadInputTokens).toBe(0);
  });

  it('should return null for invalid response', () => {
    expect(extractClaudeTokens(null)).toBeNull();
    expect(extractClaudeTokens({})).toBeNull();
  });
});

describe('extractOpenAITokens', () => {
  it('should extract tokens from valid OpenAI response', () => {
    const response = {
      usage: {
        prompt_tokens: 150,
        completion_tokens: 75,
      },
    };

    const result = extractOpenAITokens(response);
    expect(result).toEqual({
      inputTokens: 150,
      outputTokens: 75,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

describe('extractTokenUsage', () => {
  it('should extract tokens based on provider type', () => {
    const claudeResponse = {
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    expect(extractTokenUsage(claudeResponse, 'claude')).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

describe('mergeTokenUsage', () => {
  it('should merge multiple token usage objects', () => {
    const usages = [
      { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { inputTokens: 80, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ];

    const result = mergeTokenUsage(usages);
    expect(result).toEqual({
      inputTokens: 180,
      outputTokens: 90,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it('should merge cache token fields', () => {
    const usages = [
      { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 20 },
      { inputTokens: 80, outputTokens: 40, cacheCreationInputTokens: 30, cacheReadInputTokens: 40 },
    ];

    const result = mergeTokenUsage(usages);
    expect(result.cacheCreationInputTokens).toBe(40);
    expect(result.cacheReadInputTokens).toBe(60);
  });

  it('should handle usage objects without cache fields (optional)', () => {
    const usages = [
      { inputTokens: 100, outputTokens: 50 },
      { inputTokens: 80, outputTokens: 40, cacheCreationInputTokens: 30, cacheReadInputTokens: 40 },
    ];

    const result = mergeTokenUsage(usages);
    expect(result.inputTokens).toBe(180);
    expect(result.outputTokens).toBe(90);
    expect(result.cacheCreationInputTokens).toBe(30);
    expect(result.cacheReadInputTokens).toBe(40);
  });
});

describe('isValidTokenUsage', () => {
  it('should validate correct token usage', () => {
    expect(isValidTokenUsage({ inputTokens: 100, outputTokens: 50 })).toBe(true);
  });

  it('should reject invalid token usage', () => {
    expect(isValidTokenUsage(null)).toBe(false);
    expect(isValidTokenUsage({})).toBe(false);
  });
});

describe('safeTokenUsage', () => {
  it('should return valid token usage as-is', () => {
    const usage = { inputTokens: 100, outputTokens: 50 };
    expect(safeTokenUsage(usage)).toEqual(usage);
  });

  it('should return zero for invalid input', () => {
    expect(safeTokenUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });
});
