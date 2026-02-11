// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base quality validation tests.
 *
 * Verifies that all 33 knowledge base documents are properly structured,
 * loadable by the knowledge loader, and produce relevant search results.
 *
 * @module tests/knowledge-base-quality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { KnowledgeBase } from '../packages/server/src/knowledge/loader.js';

// ============================================================================
// Constants
// ============================================================================

const KB_DIR = path.resolve(__dirname, '..', 'knowledge-base');

const ALL_TECH_STACKS = [
  'nginx',
  'mysql',
  'docker',
  'nodejs',
  'postgresql',
  'redis',
  'python',
  'php',
  'mongodb',
  'certbot',
  'pm2',
] as const;

const DOC_TYPES = ['installation.md', 'configuration.md', 'troubleshooting.md'] as const;

// ============================================================================
// Helpers
// ============================================================================

function readDoc(tech: string, docType: string): string {
  return readFileSync(path.join(KB_DIR, tech, docType), 'utf-8');
}

function countHeadingPatterns(content: string, pattern: RegExp): number {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

// ============================================================================
// Tests
// ============================================================================

describe('Knowledge Base Quality Validation', () => {
  // --------------------------------------------------------------------------
  // Document Inventory
  // --------------------------------------------------------------------------

  describe('document inventory', () => {
    it('should have exactly 11 technology directories', () => {
      const dirs = readdirSync(KB_DIR).filter((entry) => {
        return statSync(path.join(KB_DIR, entry)).isDirectory();
      });
      expect(dirs.sort()).toEqual([...ALL_TECH_STACKS].sort());
    });

    it('should have exactly 33 documents (11 techs × 3 docs each)', () => {
      let count = 0;
      for (const tech of ALL_TECH_STACKS) {
        for (const doc of DOC_TYPES) {
          const filePath = path.join(KB_DIR, tech, doc);
          expect(statSync(filePath).isFile(), `Missing: ${tech}/${doc}`).toBe(true);
          count++;
        }
      }
      expect(count).toBe(33);
    });
  });

  // --------------------------------------------------------------------------
  // Document Format — Installation
  // --------------------------------------------------------------------------

  describe('installation docs format', () => {
    for (const tech of ALL_TECH_STACKS) {
      it(`${tech}/installation.md should have correct format`, () => {
        const content = readDoc(tech, 'installation.md');

        // Must have a # title
        expect(content).toMatch(/^# .+$/m);

        // Must have ## 安装 section
        expect(content).toMatch(/^## 安装$/m);

        // Must have at least one code block with bash
        expect(content).toMatch(/```bash/);

        // Must be non-trivial (at least 500 chars)
        expect(content.length).toBeGreaterThan(500);
      });
    }
  });

  // --------------------------------------------------------------------------
  // Document Format — Configuration
  // --------------------------------------------------------------------------

  describe('configuration docs format', () => {
    for (const tech of ALL_TECH_STACKS) {
      it(`${tech}/configuration.md should have correct format`, () => {
        const content = readDoc(tech, 'configuration.md');

        // Must have a # title
        expect(content).toMatch(/^# .+$/m);

        // Must have ## 配置 section
        expect(content).toMatch(/^## 配置$/m);

        // Must have at least one code block
        expect(content).toMatch(/```/);

        // Must be non-trivial
        expect(content.length).toBeGreaterThan(500);
      });
    }
  });

  // --------------------------------------------------------------------------
  // Document Format — Troubleshooting
  // --------------------------------------------------------------------------

  describe('troubleshooting docs format', () => {
    for (const tech of ALL_TECH_STACKS) {
      it(`${tech}/troubleshooting.md should have correct format`, () => {
        const content = readDoc(tech, 'troubleshooting.md');

        // Must have a # title
        expect(content).toMatch(/^# .+$/m);

        // Must have ## 常见故障排查 section
        expect(content).toMatch(/^## 常见故障排查$/m);

        // Must have at least 3 numbered troubleshooting scenarios (### N.)
        const scenarios = countHeadingPatterns(content, /^### \d+\./gm);
        expect(scenarios).toBeGreaterThanOrEqual(3);

        // Must have at least one code block
        expect(content).toMatch(/```/);

        // Must be non-trivial
        expect(content.length).toBeGreaterThan(500);
      });
    }
  });

  // --------------------------------------------------------------------------
  // Code Block Language Tags
  // --------------------------------------------------------------------------

  describe('code block language tags', () => {
    for (const tech of ALL_TECH_STACKS) {
      for (const docType of DOC_TYPES) {
        it(`${tech}/${docType} code blocks should have language tags`, () => {
          const content = readDoc(tech, docType);
          const codeBlocks = content.match(/```[^\n]*/g) || [];
          const closingBlocks = codeBlocks.filter((b) => b === '```');
          const openingBlocks = codeBlocks.filter((b) => b !== '```');

          // All opening code blocks should have a language tag
          for (const block of openingBlocks) {
            expect(block).toMatch(
              /```(bash|sql|nginx|ini|conf|json|yaml|javascript|typescript|python|php|dockerfile|toml|txt|mongosh)/,
              `Untagged code block in ${tech}/${docType}: "${block}"`,
            );
          }
        });
      }
    }
  });

  // --------------------------------------------------------------------------
  // Knowledge Loader Integration
  // --------------------------------------------------------------------------

  describe('knowledge loader integration', () => {
    let kb: KnowledgeBase;

    beforeAll(() => {
      kb = new KnowledgeBase({ baseDir: KB_DIR });
      kb.loadDocuments();
    });

    it('should load all 33 documents', () => {
      expect(kb.getDocumentCount()).toBe(33);
    });

    it('should have all 11 technology categories', () => {
      const categories = new Set(kb.getDocuments().map((d) => d.category));
      for (const tech of ALL_TECH_STACKS) {
        expect(categories.has(tech), `Missing category: ${tech}`).toBe(true);
      }
    });

    it('should have 3 documents per category', () => {
      for (const tech of ALL_TECH_STACKS) {
        const docs = kb.getDocumentsByCategory(tech);
        expect(docs.length, `${tech} should have 3 docs`).toBe(3);
      }
    });

    it('should extract titles from all documents', () => {
      for (const doc of kb.getDocuments()) {
        expect(doc.title.length).toBeGreaterThan(0);
        // Title should not be the filename
        expect(doc.title).not.toBe('installation');
        expect(doc.title).not.toBe('configuration');
        expect(doc.title).not.toBe('troubleshooting');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Search Relevance
  // --------------------------------------------------------------------------

  describe('search relevance', () => {
    let kb: KnowledgeBase;

    beforeAll(() => {
      kb = new KnowledgeBase({ baseDir: KB_DIR });
      kb.loadDocuments();
    });

    const searchTests = [
      { query: '安装 nginx', expectCategory: 'nginx', label: 'Nginx installation' },
      { query: '安装 mysql', expectCategory: 'mysql', label: 'MySQL installation' },
      { query: '安装 docker', expectCategory: 'docker', label: 'Docker installation' },
      { query: '安装 nodejs', expectCategory: 'nodejs', label: 'Node.js installation' },
      { query: '安装 postgresql', expectCategory: 'postgresql', label: 'PostgreSQL installation' },
      { query: '安装 redis', expectCategory: 'redis', label: 'Redis installation' },
      { query: '安装 python', expectCategory: 'python', label: 'Python installation' },
      { query: '安装 php', expectCategory: 'php', label: 'PHP installation' },
      { query: '安装 mongodb', expectCategory: 'mongodb', label: 'MongoDB installation' },
      { query: '安装 certbot SSL', expectCategory: 'certbot', label: 'Certbot installation' },
      { query: '安装 pm2', expectCategory: 'pm2', label: 'PM2 installation' },
      { query: 'nginx 502 Bad Gateway', expectCategory: 'nginx', label: 'Nginx 502 troubleshooting' },
      { query: 'mysql 连接拒绝', expectCategory: 'mysql', label: 'MySQL connection refused' },
      { query: 'docker 容器启动失败', expectCategory: 'docker', label: 'Docker container failure' },
      { query: 'redis 内存不足', expectCategory: 'redis', label: 'Redis OOM' },
      { query: 'postgresql 慢查询', expectCategory: 'postgresql', label: 'PostgreSQL slow query' },
    ];

    for (const { query, expectCategory, label } of searchTests) {
      it(`should find relevant results for "${label}"`, () => {
        const results = kb.search(query, 5);
        expect(results.length).toBeGreaterThan(0);

        const hasExpectedCategory = results.some(
          (r) => r.document.category === expectCategory,
        );
        expect(
          hasExpectedCategory,
          `Expected "${expectCategory}" in results for "${query}", got: ${results.map((r) => r.document.category).join(', ')}`,
        ).toBe(true);
      });
    }

    it('should return results with positive scores', () => {
      const results = kb.search('nginx 配置 反向代理', 5);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
      }
    });

    it('should return results with non-empty snippets', () => {
      const results = kb.search('nginx 安装', 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Content Quality
  // --------------------------------------------------------------------------

  describe('content quality', () => {
    it('all installation docs should mention apt or package manager', () => {
      for (const tech of ALL_TECH_STACKS) {
        const content = readDoc(tech, 'installation.md');
        expect(
          content.toLowerCase().includes('apt') ||
            content.toLowerCase().includes('npm') ||
            content.toLowerCase().includes('snap') ||
            content.toLowerCase().includes('yum') ||
            content.toLowerCase().includes('pip'),
          `${tech}/installation.md should mention a package manager`,
        ).toBe(true);
      }
    });

    it('all installation docs should mention systemctl or service management', () => {
      // Service-based software should mention service management
      const serviceSoftware = ['nginx', 'mysql', 'docker', 'postgresql', 'redis', 'mongodb'];
      for (const tech of serviceSoftware) {
        const content = readDoc(tech, 'installation.md');
        expect(
          content.includes('systemctl') || content.includes('service'),
          `${tech}/installation.md should mention systemctl or service`,
        ).toBe(true);
      }
    });

    it('all troubleshooting docs should have diagnostic commands', () => {
      for (const tech of ALL_TECH_STACKS) {
        const content = readDoc(tech, 'troubleshooting.md');
        // Should have bash code blocks with diagnostic commands
        const bashBlocks = content.match(/```bash[\s\S]*?```/g) || [];
        expect(
          bashBlocks.length,
          `${tech}/troubleshooting.md should have bash code blocks`,
        ).toBeGreaterThanOrEqual(2);
      }
    });

    it('all docs should be in Chinese', () => {
      for (const tech of ALL_TECH_STACKS) {
        for (const docType of DOC_TYPES) {
          const content = readDoc(tech, docType);
          // Chinese characters (CJK Unified Ideographs range)
          expect(
            /[\u4e00-\u9fff]/.test(content),
            `${tech}/${docType} should contain Chinese characters`,
          ).toBe(true);
        }
      }
    });
  });
});
