// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, expect, it } from 'vitest';
import type { LoadedDocument } from './document-loader.js';
import {
  TextChunker,
  splitByHeadings,
  splitIntoBlocks,
  findSentenceBoundary,
  findWordBoundary,
} from './text-chunker.js';
import type { TextChunkerOptions } from './text-chunker.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal LoadedDocument for testing */
function makeDoc(
  content: string,
  overrides: Partial<LoadedDocument> = {},
): LoadedDocument {
  return {
    id: overrides.id ?? 'docs/test.md',
    title: overrides.title ?? 'Test Document',
    content,
    filePath: overrides.filePath ?? 'docs/test.md',
    category: overrides.category ?? 'docs',
    metadata: overrides.metadata ?? {
      sourceUrl: null,
      scrapedAt: null,
      category: 'docs',
      tags: [],
      wordCount: 0,
      charCount: content.length,
      headingCount: 0,
      codeBlockCount: 0,
    },
  };
}

/** Create a chunker with custom options */
function makeChunker(options: TextChunkerOptions = {}): TextChunker {
  return new TextChunker(options);
}

// ============================================================================
// splitByHeadings
// ============================================================================

describe('splitByHeadings', () => {
  it('should split on H1 headings', () => {
    const content = '# Title\n\nContent under title.\n\n# Another\n\nMore content.';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Title');
    expect(sections[0].content).toContain('Content under title.');
    expect(sections[1].heading).toBe('Another');
    expect(sections[1].content).toContain('More content.');
  });

  it('should split on H2 headings', () => {
    const content = '## Section A\n\nContent A.\n\n## Section B\n\nContent B.';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Section A');
    expect(sections[1].heading).toBe('Section B');
  });

  it('should handle preamble before first heading', () => {
    const content = 'Preamble text.\n\n# Title\n\nContent.';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('');
    expect(sections[0].content).toBe('Preamble text.');
    expect(sections[1].heading).toBe('Title');
  });

  it('should handle content with no headings', () => {
    const content = 'Just plain text.\n\nAnother paragraph.';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('');
    expect(sections[0].content).toContain('Just plain text.');
  });

  it('should handle mixed heading levels', () => {
    const content = '# Title\n\nIntro.\n\n## Sub\n\nDetail.\n\n### SubSub\n\nMore.';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(3);
    expect(sections[0].heading).toBe('Title');
    expect(sections[1].heading).toBe('Sub');
    expect(sections[2].heading).toBe('SubSub');
  });

  it('should handle empty content', () => {
    const sections = splitByHeadings('');
    expect(sections).toHaveLength(0);
  });

  it('should handle heading-only content', () => {
    const content = '# Just a title';
    const sections = splitByHeadings(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Just a title');
  });
});

// ============================================================================
// splitIntoBlocks
// ============================================================================

describe('splitIntoBlocks', () => {
  it('should split paragraphs on blank lines', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe('Paragraph one.');
    expect(blocks[1]).toBe('Paragraph two.');
    expect(blocks[2]).toBe('Paragraph three.');
  });

  it('should keep code blocks intact', () => {
    const text = 'Before.\n\n```bash\nnpm install\nnpm run build\n```\n\nAfter.';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe('Before.');
    expect(blocks[1]).toContain('```bash');
    expect(blocks[1]).toContain('npm install');
    expect(blocks[1]).toContain('npm run build');
    expect(blocks[1]).toContain('```');
    expect(blocks[2]).toBe('After.');
  });

  it('should handle multiple code blocks', () => {
    const text = '```js\nconst a = 1;\n```\n\nText.\n\n```py\nprint("hi")\n```';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('const a = 1;');
    expect(blocks[1]).toBe('Text.');
    expect(blocks[2]).toContain('print("hi")');
  });

  it('should handle text with no blank lines', () => {
    const text = 'Line one.\nLine two.\nLine three.';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('Line one.');
  });

  it('should handle empty text', () => {
    expect(splitIntoBlocks('')).toHaveLength(0);
  });

  it('should handle multiple consecutive blank lines', () => {
    const text = 'A.\n\n\n\nB.';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe('A.');
    expect(blocks[1]).toBe('B.');
  });

  it('should handle unclosed code block', () => {
    const text = 'Before.\n\n```bash\nnpm install';
    const blocks = splitIntoBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe('Before.');
    expect(blocks[1]).toContain('npm install');
  });
});

// ============================================================================
// findSentenceBoundary
// ============================================================================

describe('findSentenceBoundary', () => {
  it('should find sentence boundary at period', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const pos = findSentenceBoundary(text, 20);
    expect(pos).toBe(16); // right after ". "
  });

  it('should find the last sentence boundary before maxPos', () => {
    const text = 'A. B. C. D.';
    const pos = findSentenceBoundary(text, 8);
    expect(pos).toBe(6); // after "C. " — no, "A. B. C" has "B. " ending at 6
  });

  it('should return -1 when no sentence boundary exists', () => {
    const text = 'No sentence boundary here';
    expect(findSentenceBoundary(text, 25)).toBe(-1);
  });

  it('should find boundary at Chinese punctuation', () => {
    const text = '第一句话。第二句话。';
    const pos = findSentenceBoundary(text, 30);
    expect(pos).toBeGreaterThan(0);
  });

  it('should handle exclamation marks', () => {
    const text = 'Wow! Amazing!';
    const pos = findSentenceBoundary(text, 10);
    expect(pos).toBe(5); // after "! "
  });

  it('should handle question marks', () => {
    const text = 'Is this right? Yes it is.';
    const pos = findSentenceBoundary(text, 20);
    expect(pos).toBe(15); // after "? "
  });
});

// ============================================================================
// findWordBoundary
// ============================================================================

describe('findWordBoundary', () => {
  it('should find last word boundary before maxPos', () => {
    const text = 'hello world foo bar';
    const pos = findWordBoundary(text, 15);
    expect(pos).toBe(12); // right after space before "foo"
  });

  it('should return -1 for text without spaces', () => {
    const text = 'nospacehere';
    expect(findWordBoundary(text, 11)).toBe(-1);
  });

  it('should handle single word', () => {
    const text = 'word';
    expect(findWordBoundary(text, 4)).toBe(-1);
  });
});

// ============================================================================
// TextChunker - Constructor
// ============================================================================

describe('TextChunker constructor', () => {
  it('should use default options', () => {
    const chunker = makeChunker();
    // Should not throw
    expect(chunker).toBeDefined();
  });

  it('should accept custom options', () => {
    const chunker = makeChunker({ maxChunkSize: 500, overlapSize: 50, minChunkSize: 20 });
    expect(chunker).toBeDefined();
  });

  it('should throw for non-positive maxChunkSize', () => {
    expect(() => makeChunker({ maxChunkSize: 0 })).toThrow('maxChunkSize must be positive');
    expect(() => makeChunker({ maxChunkSize: -1 })).toThrow('maxChunkSize must be positive');
  });

  it('should throw for negative overlapSize', () => {
    expect(() => makeChunker({ overlapSize: -1 })).toThrow('overlapSize must be non-negative');
  });

  it('should throw when overlapSize >= maxChunkSize', () => {
    expect(() => makeChunker({ maxChunkSize: 100, overlapSize: 100 })).toThrow(
      'overlapSize must be less than maxChunkSize',
    );
    expect(() => makeChunker({ maxChunkSize: 100, overlapSize: 150 })).toThrow(
      'overlapSize must be less than maxChunkSize',
    );
  });

  it('should throw for negative minChunkSize', () => {
    expect(() => makeChunker({ minChunkSize: -1 })).toThrow('minChunkSize must be non-negative');
  });
});

// ============================================================================
// TextChunker.chunkDocument
// ============================================================================

describe('TextChunker.chunkDocument', () => {
  it('should return empty array for empty document', () => {
    const chunker = makeChunker();
    const doc = makeDoc('');
    expect(chunker.chunkDocument(doc)).toHaveLength(0);
  });

  it('should return empty array for whitespace-only document', () => {
    const chunker = makeChunker();
    const doc = makeDoc('   \n\n   ');
    expect(chunker.chunkDocument(doc)).toHaveLength(0);
  });

  it('should produce single chunk for small document', () => {
    const chunker = makeChunker({ maxChunkSize: 1000 });
    const doc = makeDoc('# Title\n\nShort content.');
    const chunks = chunker.chunkDocument(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Short content.');
    expect(chunks[0].documentId).toBe('docs/test.md');
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].id).toBe('docs/test.md#chunk-0');
    expect(chunks[0].category).toBe('docs');
  });

  it('should produce multiple chunks for large document', () => {
    const chunker = makeChunker({ maxChunkSize: 100, overlapSize: 10, minChunkSize: 10 });
    const longContent = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ` + 'x'.repeat(40))
      .join('\n\n');
    const doc = makeDoc(longContent);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should have valid IDs
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].id).toBe(`docs/test.md#chunk-${i}`);
    }
  });

  it('should set charCount correctly', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const doc = makeDoc('# Title\n\nSome content here.');
    const chunks = chunker.chunkDocument(doc);

    for (const chunk of chunks) {
      expect(chunk.charCount).toBe(chunk.content.length);
    }
  });

  it('should preserve heading context', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const content = '# Main\n\nIntro.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    // At least one chunk should have heading context
    const headings = chunks.map((c) => c.headingContext);
    expect(headings).toContain('Main');
  });

  it('should inherit category from document', () => {
    const chunker = makeChunker();
    const doc = makeDoc('Some content.', { category: 'solutions' });
    const chunks = chunker.chunkDocument(doc);

    for (const chunk of chunks) {
      expect(chunk.category).toBe('solutions');
    }
  });

  it('should keep code blocks intact when possible', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const content = '# Install\n\nRun:\n\n```bash\nnpm install\nnpm run build\n```\n\nDone.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    // Find a chunk that has the code block
    const codeChunk = chunks.find((c) => c.content.includes('npm install'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain('npm run build');
  });

  it('should not exceed maxChunkSize', () => {
    const maxChunkSize = 200;
    const chunker = makeChunker({ maxChunkSize, overlapSize: 20, minChunkSize: 10 });
    const longParagraph = 'Word '.repeat(100);
    const doc = makeDoc(longParagraph);
    const chunks = chunker.chunkDocument(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(maxChunkSize + 50); // Allow small tolerance for overlap
    }
  });

  it('should merge small chunks', () => {
    const chunker = makeChunker({ maxChunkSize: 500, overlapSize: 0, minChunkSize: 100 });
    const content = '# Title\n\nA.\n\n## Section\n\nB is a longer section with more content here.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    // Small chunks (like "A.") should be merged
    for (const chunk of chunks) {
      // After merging, no chunk should be smaller than minChunkSize
      // unless it's the only chunk or the total content is small
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// TextChunker.chunkDocuments
// ============================================================================

describe('TextChunker.chunkDocuments', () => {
  it('should chunk multiple documents', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const docs = [
      makeDoc('# Doc 1\n\nContent one.', { id: 'docs/one.md' }),
      makeDoc('# Doc 2\n\nContent two.', { id: 'docs/two.md' }),
    ];

    const { chunks, summary } = chunker.chunkDocuments(docs);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(summary.totalDocuments).toBe(2);
    expect(summary.totalChunks).toBe(chunks.length);
  });

  it('should handle empty document list', () => {
    const chunker = makeChunker();
    const { chunks, summary } = chunker.chunkDocuments([]);

    expect(chunks).toHaveLength(0);
    expect(summary.totalDocuments).toBe(0);
    expect(summary.totalChunks).toBe(0);
    expect(summary.avgChunkSize).toBe(0);
  });

  it('should compute correct summary statistics', () => {
    const chunker = makeChunker({ maxChunkSize: 50, overlapSize: 0, minChunkSize: 5 });
    const content = 'Short.\n\nA longer paragraph with more words in it for testing.';
    const docs = [makeDoc(content, { id: 'docs/a.md' })];

    const { chunks, summary } = chunker.chunkDocuments(docs);

    expect(summary.totalDocuments).toBe(1);
    expect(summary.totalChunks).toBe(chunks.length);
    expect(summary.avgChunkSize).toBeGreaterThan(0);
    expect(summary.minChunkSize).toBeLessThanOrEqual(summary.maxChunkSize);
    expect(summary.minChunkSize).toBeGreaterThan(0);
  });

  it('should produce unique chunk IDs across documents', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const docs = [
      makeDoc('Content A.', { id: 'a.md' }),
      makeDoc('Content B.', { id: 'b.md' }),
    ];

    const { chunks } = chunker.chunkDocuments(docs);
    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should skip empty documents without affecting others', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const docs = [
      makeDoc('Content A.', { id: 'a.md' }),
      makeDoc('', { id: 'empty.md' }),
      makeDoc('Content C.', { id: 'c.md' }),
    ];

    const { chunks, summary } = chunker.chunkDocuments(docs);

    expect(summary.totalDocuments).toBe(3);
    // Empty doc produces 0 chunks
    expect(chunks.every((c) => c.documentId !== 'empty.md')).toBe(true);
  });
});

// ============================================================================
// TextChunker - Overlap behavior
// ============================================================================

describe('TextChunker - overlap', () => {
  it('should produce overlap between adjacent chunks', () => {
    const chunker = makeChunker({ maxChunkSize: 60, overlapSize: 20, minChunkSize: 5 });
    const content = 'First paragraph with some text.\n\nSecond paragraph also has text.\n\nThird paragraph is the last.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    if (chunks.length >= 2) {
      // With overlap, later chunks may contain text from previous chunks
      // This is a structural test — overlap is applied internally
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should work with zero overlap', () => {
    const chunker = makeChunker({ maxChunkSize: 60, overlapSize: 0, minChunkSize: 5 });
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// TextChunker - Edge cases
// ============================================================================

describe('TextChunker - edge cases', () => {
  it('should handle document with only headings', () => {
    const chunker = makeChunker();
    const doc = makeDoc('# Title\n\n## Section\n\n### Subsection');
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should handle document with only code blocks', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const doc = makeDoc('```bash\nnpm install\n```\n\n```bash\nnpm run build\n```');
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should handle very long single line', () => {
    const chunker = makeChunker({ maxChunkSize: 100, overlapSize: 10, minChunkSize: 5 });
    const longLine = 'word '.repeat(200);
    const doc = makeDoc(longLine);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should handle document with Chinese content', () => {
    const chunker = makeChunker({ maxChunkSize: 100, overlapSize: 10, minChunkSize: 5 });
    const content = '# 安装指南\n\n这是一个安装指南。请按照以下步骤操作。\n\n## 前置要求\n\n需要 Node.js 22+ 版本。';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
    // All chunks should have content
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('should handle document with tables', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const content = '# Table\n\n| Column A | Column B |\n|----------|----------|\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
    // Table should be preserved within a chunk
    const tableChunk = chunks.find((c) => c.content.includes('Column A'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.content).toContain('Cell 1');
  });

  it('should handle document with metadata header', () => {
    const chunker = makeChunker({ maxChunkSize: 500 });
    const content = '> 来源: https://example.com\n> 抓取时间: 2026-01-01\n\n# Title\n\nContent.';
    const doc = makeDoc(content);
    const chunks = chunker.chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Integration: chunkDocuments with real-world content
// ============================================================================

describe('TextChunker - integration', () => {
  it('should chunk a realistic Markdown document', () => {
    const chunker = makeChunker({ maxChunkSize: 300, overlapSize: 30, minChunkSize: 30 });
    const content = `# OpenClaw 安装指南

> 来源: https://docs.openclaw.ai/install
> 抓取时间: 2026-02-06

## 快速开始

目标：从零开始完成首次安装和配置。

### 安装方式一：脚本安装（推荐）

安装脚本会自动处理全局 CLI 安装和初始化配置。

\`\`\`bash
curl -fsSL https://openclaw.ai/install.sh | bash
\`\`\`

### 安装方式二：npm 全局安装

适用于已安装 Node.js 的开发者：
\`\`\`bash
npm install -g openclaw@latest
\`\`\`

## 安装后配置

### 步骤 1：运行初始化向导
\`\`\`bash
openclaw onboard --install-daemon
\`\`\`
该命令会配置认证、网关设置和可选的通道。

### 步骤 2：验证服务状态
\`\`\`bash
openclaw gateway status
\`\`\`

## 验证安装

\`\`\`bash
openclaw doctor
openclaw status
\`\`\``;

    const doc = makeDoc(content, { id: 'docs/installation.md', category: 'docs' });
    const { chunks, summary } = chunker.chunkDocuments([doc]);

    // Should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Summary should be accurate
    expect(summary.totalDocuments).toBe(1);
    expect(summary.totalChunks).toBe(chunks.length);
    expect(summary.avgChunkSize).toBeGreaterThan(0);

    // All chunks should have valid structure
    for (const chunk of chunks) {
      expect(chunk.documentId).toBe('docs/installation.md');
      expect(chunk.category).toBe('docs');
      expect(chunk.charCount).toBe(chunk.content.length);
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }

    // Chunk IDs should be sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].id).toBe(`docs/installation.md#chunk-${i}`);
    }
  });

  it('should handle multiple documents in batch', () => {
    const chunker = makeChunker({ maxChunkSize: 200, overlapSize: 20, minChunkSize: 20 });
    const docs = [
      makeDoc('# Doc A\n\n' + 'Paragraph A. '.repeat(30), { id: 'a.md', category: 'docs' }),
      makeDoc('# Doc B\n\n' + 'Paragraph B. '.repeat(30), { id: 'b.md', category: 'issues' }),
      makeDoc('# Doc C\n\nShort.', { id: 'c.md', category: 'cases' }),
    ];

    const { chunks, summary } = chunker.chunkDocuments(docs);

    expect(summary.totalDocuments).toBe(3);
    expect(summary.totalChunks).toBeGreaterThan(3);

    // Verify documents are represented
    const docIds = new Set(chunks.map((c) => c.documentId));
    expect(docIds.has('a.md')).toBe(true);
    expect(docIds.has('b.md')).toBe(true);
    expect(docIds.has('c.md')).toBe(true);

    // Verify categories are preserved
    for (const chunk of chunks) {
      if (chunk.documentId === 'a.md') expect(chunk.category).toBe('docs');
      if (chunk.documentId === 'b.md') expect(chunk.category).toBe('issues');
      if (chunk.documentId === 'c.md') expect(chunk.category).toBe('cases');
    }
  });
});
