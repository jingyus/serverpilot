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
