// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Language-aware token estimation utilities.
 *
 * Provides heuristic token counting that accounts for CJK characters
 * (Chinese, Japanese, Korean) which typically use fewer characters per token
 * than ASCII/Latin text.
 *
 * Ratios:
 * - ASCII/Latin: ~4 characters per token
 * - CJK: ~1.5 characters per token
 * - Mixed: weighted average based on CJK proportion
 *
 * @module utils/token
 */

/** Chars-per-token ratio for ASCII/Latin text. */
const CHARS_PER_TOKEN_ASCII = 4;

/** Chars-per-token ratio for CJK text. */
const CHARS_PER_TOKEN_CJK = 1.5;

/**
 * Regex matching CJK characters:
 * - \u2E80-\u9FFF: CJK Radicals, Kangxi, Ideographs, Hiragana, Katakana
 * - \uAC00-\uD7AF: Hangul Syllables (Korean)
 * - \uF900-\uFAFF: CJK Compatibility Ideographs
 * - \uFF00-\uFFEF: Halfwidth and Fullwidth Forms
 */
const CJK_REGEX = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/g;

/**
 * Count the number of CJK characters in a text string.
 */
export function countCjkChars(text: string): number {
  const matches = text.match(CJK_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Compute the weighted chars-per-token ratio based on CJK character proportion.
 *
 * - Pure ASCII text → 4.0
 * - Pure CJK text → 1.5
 * - Mixed text → weighted average
 */
export function getCharsPerToken(text: string): number {
  if (!text) return CHARS_PER_TOKEN_ASCII;
  const cjkCount = countCjkChars(text);
  if (cjkCount === 0) return CHARS_PER_TOKEN_ASCII;
  const asciiCount = text.length - cjkCount;
  if (asciiCount === 0) return CHARS_PER_TOKEN_CJK;
  const cjkRatio = cjkCount / text.length;
  return (
    CHARS_PER_TOKEN_CJK * cjkRatio + CHARS_PER_TOKEN_ASCII * (1 - cjkRatio)
  );
}

/**
 * Estimate token count for a text string.
 *
 * Uses language-aware heuristics:
 * - English/ASCII text: ~4 chars per token
 * - CJK text (Chinese/Japanese/Korean): ~1.5 chars per token
 * - Mixed text: weighted average based on CJK proportion
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / getCharsPerToken(text));
}
