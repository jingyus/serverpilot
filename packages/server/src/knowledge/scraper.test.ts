/**
 * Tests for the OpenClaw documentation scraper module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fetchDocPage,
  formatDocContent,
  saveDocToFile,
  scrapeOpenClawDocs,
  OPENCLAW_DOCS_BASE,
  DEFAULT_DOC_PAGES,
  type DocPage,
  type ScrapeResult,
  type FetchOptions,
} from './scraper.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock fetch that returns the given response */
function createMockFetch(
  body: string,
  status = 200,
  statusText = 'OK',
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  });
}

/** Create a mock fetch that rejects with an error */
function createErrorFetch(error: string): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(error));
}

/** Sample documentation page for testing */
const samplePage: DocPage = {
  url: 'https://docs.openclaw.ai/install/index.md',
  filename: 'installation',
  title: 'OpenClaw 安装指南',
  category: 'docs',
};

/** Sample markdown content */
const sampleContent = `# Installation Guide

## Quick Start

Install OpenClaw:
\`\`\`bash
npm install -g openclaw@latest
\`\`\`

## Prerequisites

- Node.js >= 22
- macOS, Linux, or Windows (WSL2)
`;

// ============================================================================
// Tests
// ============================================================================

describe('scraper', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('OPENCLAW_DOCS_BASE', () => {
    it('should point to the official docs site', () => {
      expect(OPENCLAW_DOCS_BASE).toBe('https://docs.openclaw.ai');
    });
  });

  describe('DEFAULT_DOC_PAGES', () => {
    it('should contain at least 5 pages', () => {
      expect(DEFAULT_DOC_PAGES.length).toBeGreaterThanOrEqual(5);
    });

    it('should have valid URLs starting with the base URL', () => {
      for (const page of DEFAULT_DOC_PAGES) {
        expect(page.url).toMatch(/^https:\/\/docs\.openclaw\.ai\//);
      }
    });

    it('should have unique filenames', () => {
      const filenames = DEFAULT_DOC_PAGES.map((p) => p.filename);
      expect(new Set(filenames).size).toBe(filenames.length);
    });

    it('should have non-empty titles', () => {
      for (const page of DEFAULT_DOC_PAGES) {
        expect(page.title.length).toBeGreaterThan(0);
      }
    });

    it('should all be in docs category', () => {
      for (const page of DEFAULT_DOC_PAGES) {
        expect(page.category).toBe('docs');
      }
    });

    it('should include installation page', () => {
      const installPage = DEFAULT_DOC_PAGES.find(
        (p) => p.filename === 'installation',
      );
      expect(installPage).toBeDefined();
      expect(installPage!.url).toContain('/install/');
    });

    it('should include troubleshooting page', () => {
      const troublePage = DEFAULT_DOC_PAGES.find(
        (p) => p.filename === 'troubleshooting',
      );
      expect(troublePage).toBeDefined();
    });

    it('should include FAQ page', () => {
      const faqPage = DEFAULT_DOC_PAGES.find((p) => p.filename === 'faq');
      expect(faqPage).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // fetchDocPage
  // --------------------------------------------------------------------------

  describe('fetchDocPage', () => {
    it('should fetch a page successfully', async () => {
      const mockFetch = createMockFetch(sampleContent);
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(true);
      expect(result.content).toBe(sampleContent);
      expect(result.contentLength).toBeGreaterThan(0);
      expect(result.page).toBe(samplePage);
      expect(result.error).toBeUndefined();
    });

    it('should pass correct headers', async () => {
      const mockFetch = createMockFetch(sampleContent);
      await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(mockFetch).toHaveBeenCalledOnce();
      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe(samplePage.url);
      expect(callArgs[1].headers['User-Agent']).toContain('AIInstaller');
    });

    it('should handle HTTP error responses', async () => {
      const mockFetch = createMockFetch('', 404, 'Not Found');
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
      expect(result.error).toContain('Not Found');
      expect(result.contentLength).toBe(0);
    });

    it('should handle 500 server errors', async () => {
      const mockFetch = createMockFetch('', 500, 'Internal Server Error');
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should handle network errors', async () => {
      const mockFetch = createErrorFetch('Network request failed');
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network request failed');
      expect(result.contentLength).toBe(0);
    });

    it('should handle empty response body', async () => {
      const mockFetch = createMockFetch('');
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response');
    });

    it('should handle whitespace-only response body', async () => {
      const mockFetch = createMockFetch('   \n\t  ');
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response');
    });

    it('should calculate content length correctly', async () => {
      const content = 'Hello, 你好!';
      const mockFetch = createMockFetch(content);
      const result = await fetchDocPage(samplePage, { fetchFn: mockFetch });

      expect(result.contentLength).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should handle abort/timeout errors', async () => {
      const mockFetch = createErrorFetch('The operation was aborted');
      const result = await fetchDocPage(samplePage, {
        fetchFn: mockFetch,
        timeoutMs: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('aborted');
    });

    it('should handle non-Error exceptions', async () => {
      const mockFetch = vi.fn().mockRejectedValue('string error');
      const result = await fetchDocPage(samplePage, {
        fetchFn: mockFetch as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  // --------------------------------------------------------------------------
  // formatDocContent
  // --------------------------------------------------------------------------

  describe('formatDocContent', () => {
    it('should add metadata header to content', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: sampleContent,
        contentLength: 100,
      };

      const formatted = formatDocContent(result);

      expect(formatted).toContain(`# ${samplePage.title}`);
      expect(formatted).toContain(`> 来源: ${samplePage.url}`);
      expect(formatted).toContain('> 抓取时间:');
      expect(formatted).toContain('---');
      expect(formatted).toContain(sampleContent);
    });

    it('should include the current date', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: 'test',
        contentLength: 4,
      };

      const formatted = formatDocContent(result);
      const today = new Date().toISOString().split('T')[0];
      expect(formatted).toContain(today);
    });

    it('should return empty string for failed results', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: false,
        error: 'fail',
        contentLength: 0,
      };

      expect(formatDocContent(result)).toBe('');
    });

    it('should return empty string when content is undefined', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: undefined,
        contentLength: 0,
      };

      expect(formatDocContent(result)).toBe('');
    });

    it('should preserve original content structure', () => {
      const content = '## Section\n\n```bash\nnpm install\n```\n';
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content,
        contentLength: content.length,
      };

      const formatted = formatDocContent(result);
      expect(formatted).toContain('## Section');
      expect(formatted).toContain('```bash');
      expect(formatted).toContain('npm install');
    });
  });

  // --------------------------------------------------------------------------
  // saveDocToFile
  // --------------------------------------------------------------------------

  describe('saveDocToFile', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `scraper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should save content to the correct file', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: sampleContent,
        contentLength: sampleContent.length,
      };

      const savedPath = saveDocToFile(result, tmpDir);

      expect(savedPath).not.toBeNull();
      expect(savedPath).toBe(path.join(tmpDir, 'installation.md'));
      expect(existsSync(savedPath!)).toBe(true);
    });

    it('should create the output directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: sampleContent,
        contentLength: sampleContent.length,
      };

      saveDocToFile(result, nestedDir);

      expect(existsSync(nestedDir)).toBe(true);
    });

    it('should write formatted content with metadata header', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: sampleContent,
        contentLength: sampleContent.length,
      };

      const savedPath = saveDocToFile(result, tmpDir)!;
      const written = readFileSync(savedPath, 'utf-8');

      expect(written).toContain(`# ${samplePage.title}`);
      expect(written).toContain(`> 来源: ${samplePage.url}`);
      expect(written).toContain(sampleContent);
    });

    it('should return null for failed results', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: false,
        error: 'fail',
        contentLength: 0,
      };

      expect(saveDocToFile(result, tmpDir)).toBeNull();
    });

    it('should return null when content is missing', () => {
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: undefined,
        contentLength: 0,
      };

      expect(saveDocToFile(result, tmpDir)).toBeNull();
    });

    it('should use the page filename as the file name', () => {
      const customPage: DocPage = {
        url: 'https://example.com/doc.md',
        filename: 'my-custom-doc',
        title: 'Custom',
        category: 'docs',
      };
      const result: ScrapeResult = {
        page: customPage,
        success: true,
        content: 'hello',
        contentLength: 5,
      };

      const savedPath = saveDocToFile(result, tmpDir);
      expect(savedPath).toBe(path.join(tmpDir, 'my-custom-doc.md'));
    });

    it('should work when output directory already exists', () => {
      mkdirSync(tmpDir, { recursive: true });
      const result: ScrapeResult = {
        page: samplePage,
        success: true,
        content: sampleContent,
        contentLength: sampleContent.length,
      };

      const savedPath = saveDocToFile(result, tmpDir);
      expect(savedPath).not.toBeNull();
      expect(existsSync(savedPath!)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // scrapeOpenClawDocs
  // --------------------------------------------------------------------------

  describe('scrapeOpenClawDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `scraper-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should scrape all pages and return summary', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'a', title: 'A', category: 'docs' },
        { url: 'https://example.com/b.md', filename: 'b', title: 'B', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# Content\nSome docs.');

      const summary = await scrapeOpenClawDocs(tmpDir, pages, {
        fetchFn: mockFetch,
      });

      expect(summary.total).toBe(2);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.results).toHaveLength(2);
      expect(summary.outputDir).toBe(tmpDir);
    });

    it('should save files for successful scrapes', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/doc.md', filename: 'doc', title: 'Doc', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# Hello\nWorld');

      await scrapeOpenClawDocs(tmpDir, pages, { fetchFn: mockFetch });

      const filePath = path.join(tmpDir, 'doc.md');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Doc');
      expect(content).toContain('World');
    });

    it('should handle mixed success and failure', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/ok.md', filename: 'ok', title: 'OK', category: 'docs' },
        { url: 'https://example.com/fail.md', filename: 'fail', title: 'Fail', category: 'docs' },
      ];

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve('# Good content'),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(''),
        });
      });

      const summary = await scrapeOpenClawDocs(tmpDir, pages, {
        fetchFn: mockFetch as typeof fetch,
      });

      expect(summary.total).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
      expect(existsSync(path.join(tmpDir, 'ok.md'))).toBe(true);
      expect(existsSync(path.join(tmpDir, 'fail.md'))).toBe(false);
    });

    it('should handle all pages failing', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'a', title: 'A', category: 'docs' },
      ];
      const mockFetch = createErrorFetch('Connection refused');

      const summary = await scrapeOpenClawDocs(tmpDir, pages, {
        fetchFn: mockFetch,
      });

      expect(summary.total).toBe(1);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(1);
      expect(summary.results[0].error).toBe('Connection refused');
    });

    it('should handle empty page list', async () => {
      const mockFetch = createMockFetch('content');

      const summary = await scrapeOpenClawDocs(tmpDir, [], {
        fetchFn: mockFetch,
      });

      expect(summary.total).toBe(0);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.results).toHaveLength(0);
    });

    it('should call fetch for each page', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/1.md', filename: '1', title: '1', category: 'docs' },
        { url: 'https://example.com/2.md', filename: '2', title: '2', category: 'docs' },
        { url: 'https://example.com/3.md', filename: '3', title: '3', category: 'docs' },
      ];
      const mockFetch = createMockFetch('content');

      await scrapeOpenClawDocs(tmpDir, pages, { fetchFn: mockFetch });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should use default pages when none specified', async () => {
      const mockFetch = createMockFetch('# Default content');

      const summary = await scrapeOpenClawDocs(tmpDir, undefined, {
        fetchFn: mockFetch,
      });

      expect(summary.total).toBe(DEFAULT_DOC_PAGES.length);
      expect(mockFetch).toHaveBeenCalledTimes(DEFAULT_DOC_PAGES.length);
    });
  });
});
