import { describe, it, expect } from "vitest";
import { countCjkChars, getCharsPerToken, estimateTokens } from "./token.js";

// ============================================================================
// countCjkChars
// ============================================================================

describe("countCjkChars", () => {
  it("returns 0 for pure ASCII text", () => {
    expect(countCjkChars("hello world")).toBe(0);
  });

  it("counts Chinese characters", () => {
    expect(countCjkChars("你好世界")).toBe(4);
  });

  it("counts Japanese Hiragana characters", () => {
    expect(countCjkChars("こんにちは")).toBe(5);
  });

  it("counts Japanese Katakana characters", () => {
    expect(countCjkChars("カタカナ")).toBe(4);
  });

  it("counts Korean Hangul characters", () => {
    expect(countCjkChars("안녕하세요")).toBe(5);
  });

  it("counts fullwidth forms", () => {
    expect(countCjkChars("ＡＢＣ")).toBe(3);
  });

  it("counts only CJK chars in mixed text", () => {
    expect(countCjkChars("Hello 你好 World")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countCjkChars("")).toBe(0);
  });
});

// ============================================================================
// getCharsPerToken
// ============================================================================

describe("getCharsPerToken", () => {
  it("returns 4 for pure ASCII text", () => {
    expect(getCharsPerToken("hello world")).toBe(4);
  });

  it("returns 1.5 for pure CJK text", () => {
    expect(getCharsPerToken("你好世界")).toBe(1.5);
  });

  it("returns weighted average for mixed text", () => {
    const ratio = getCharsPerToken("Hello你好");
    // 7 total chars, 2 CJK → cjkRatio = 2/7
    // 1.5 * (2/7) + 4.0 * (5/7) ≈ 3.286
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(4);
  });

  it("returns 4 for empty string", () => {
    expect(getCharsPerToken("")).toBe(4);
  });

  it("handles text with numbers and punctuation", () => {
    expect(getCharsPerToken("abc123!@#")).toBe(4);
  });
});

// ============================================================================
// estimateTokens
// ============================================================================

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates pure English text at ~4 chars/token", () => {
    const text = "This is a test sentence for token estimation.";
    // 46 chars / 4 = 11.5 → ceil = 12
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it("estimates pure Chinese text at ~1.5 chars/token", () => {
    const text = "这是一个测试句子";
    // 8 chars / 1.5 = 5.33 → ceil = 6
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 1.5));
  });

  it("estimates mixed Chinese-English text with weighted ratio", () => {
    const text = "Hello世界";
    const ratio = getCharsPerToken(text);
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / ratio));
  });

  it("returns higher token count for CJK than ASCII at same length", () => {
    // 4 CJK chars should estimate more tokens than 4 ASCII chars
    const cjkTokens = estimateTokens("你好世界"); // 4 / 1.5 = 2.67 → 3
    const asciiTokens = estimateTokens("abcd"); // 4 / 4 = 1
    expect(cjkTokens).toBeGreaterThan(asciiTokens);
  });

  it("handles Korean text", () => {
    const text = "서버파일럿";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 1.5));
  });

  it("handles Japanese mixed script", () => {
    const text = "テスト文字列";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 1.5));
  });

  it("handles long English text", () => {
    const text = "a".repeat(1000);
    expect(estimateTokens(text)).toBe(250); // 1000 / 4
  });

  it("handles long CJK text", () => {
    const text = "中".repeat(1000);
    // 1000 / 1.5 = 666.67 → 667
    expect(estimateTokens(text)).toBe(667);
  });

  it("handles single character", () => {
    expect(estimateTokens("a")).toBe(1); // 1 / 4 → ceil = 1
    expect(estimateTokens("中")).toBe(1); // 1 / 1.5 → ceil = 1
  });

  it("handles text with only whitespace", () => {
    expect(estimateTokens("   ")).toBe(1); // 3 / 4 → ceil = 1
  });

  it("handles text with newlines", () => {
    const text = "line1\nline2\nline3";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });
});
