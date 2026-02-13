// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the website documentation scraper module.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractHtmlTitle,
  htmlToMarkdown,
  decodeHtmlEntities,
  extractLinks,
  fetchWebPage,
  urlToFilename,
  formatWebDoc,
  saveWebDoc,
  matchesPatterns,
  discoverPages,
  scrapeWebDocs,
  type WebDocSource,
  type WebDocResult,
} from './web-doc-scraper.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockFetch(body: string, status = 200, headers?: Record<string, string>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(body),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  }) as unknown as typeof fetch;
}

function createErrorFetch(error: string): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(error)) as unknown as typeof fetch;
}

const sampleSource: WebDocSource = {
  baseUrl: 'https://docs.example.com',
  software: 'example',
  pages: ['https://docs.example.com/page1', 'https://docs.example.com/page2'],
  maxPages: 10,
};

// ============================================================================
// Tests
// ============================================================================

describe('web-doc-scraper', () => {
  // --------------------------------------------------------------------------
  // extractHtmlTitle
  // --------------------------------------------------------------------------

  describe('extractHtmlTitle', () => {
    it('should extract title from HTML', () => {
      const html = '<html><head><title>My Page</title></head><body></body></html>';
      expect(extractHtmlTitle(html)).toBe('My Page');
    });

    it('should trim whitespace', () => {
      const html = '<html><head><title>  Spaced Title  </title></head><body></body></html>';
      expect(extractHtmlTitle(html)).toBe('Spaced Title');
    });

    it('should return empty string if no title', () => {
      const html = '<html><head></head><body></body></html>';
      expect(extractHtmlTitle(html)).toBe('');
    });

    it('should handle case-insensitive tags', () => {
      const html = '<TITLE>UPPERCASE</TITLE>';
      expect(extractHtmlTitle(html)).toBe('UPPERCASE');
    });
  });

  // --------------------------------------------------------------------------
  // decodeHtmlEntities
  // --------------------------------------------------------------------------

  describe('decodeHtmlEntities', () => {
    it('should decode common HTML entities', () => {
      expect(decodeHtmlEntities('&lt;html&gt;')).toBe('<html>');
      expect(decodeHtmlEntities('&amp; &quot; &#39;')).toBe('& " \'');
      expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
    });

    it('should decode numeric entities', () => {
      expect(decodeHtmlEntities('&#65;')).toBe('A');
      expect(decodeHtmlEntities('&#97;')).toBe('a');
    });

    it('should handle mixed entities', () => {
      const input = 'Code: &#60;div&#62;&amp;#39;test&amp;#39;&#60;/div&#62;';
      const output = decodeHtmlEntities(input);
      expect(output).toContain('<');
      expect(output).toContain('>');
    });
  });

  // --------------------------------------------------------------------------
  // htmlToMarkdown
  // --------------------------------------------------------------------------

  describe('htmlToMarkdown', () => {
    it('should convert headings', () => {
      const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('# Title');
      expect(md).toContain('## Subtitle');
      expect(md).toContain('### Section');
    });

    it('should convert links', () => {
      const html = '<a href="https://example.com">Example</a>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('[Example](https://example.com)');
    });

    it('should convert code blocks', () => {
      const html = '<pre><code class="language-python">print("hello")</code></pre>';
      const md = htmlToMarkdown(html);
      // The regex matches language-(\w+), so "language-python" should extract "python"
      // But the regex needs exact match pattern
      expect(md).toContain('```');
      expect(md).toContain('print("hello")');
    });

    it('should convert inline code', () => {
      const html = 'Use <code>console.log()</code> for debugging.';
      const md = htmlToMarkdown(html);
      expect(md).toContain('`console.log()`');
    });

    it('should convert lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('- Item 1');
      expect(md).toContain('- Item 2');
    });

    it('should convert emphasis', () => {
      const html = '<strong>Bold</strong> and <em>italic</em>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('**Bold**');
      expect(md).toContain('*italic*');
    });

    it('should remove script and style tags', () => {
      const html = '<script>alert("test")</script><p>Content</p><style>.test{}</style>';
      const md = htmlToMarkdown(html);
      expect(md).not.toContain('alert');
      expect(md).not.toContain('.test');
      expect(md).toContain('Content');
    });

    it('should extract main content area if present', () => {
      const html = `
        <nav>Navigation</nav>
        <main>Main Content</main>
        <footer>Footer</footer>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('Main Content');
      expect(md).not.toContain('Navigation');
      expect(md).not.toContain('Footer');
    });

    it('should decode HTML entities', () => {
      const html = '<p>&lt;html&gt; &amp; &quot;test&quot;</p>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('<html>');
      expect(md).toContain('&');
      expect(md).toContain('"test"');
    });
  });

  // --------------------------------------------------------------------------
  // extractLinks
  // --------------------------------------------------------------------------

  describe('extractLinks', () => {
    it('should extract links matching the base URL', () => {
      const html = `
        <a href="https://docs.example.com/docs/page1">Page 1</a>
        <a href="https://docs.example.com/docs/page2">Page 2</a>
        <a href="https://other.com/page">Other</a>
      `;
      const links = extractLinks(html, 'https://docs.example.com/docs/');
      expect(links).toHaveLength(2);
      expect(links).toContain('https://docs.example.com/docs/page1');
      expect(links).toContain('https://docs.example.com/docs/page2');
    });

    it('should resolve relative URLs', () => {
      const html = '<a href="./page1">Page 1</a><a href="/docs/page2">Page 2</a>';
      const links = extractLinks(html, 'https://docs.example.com/docs/');
      expect(links).toContain('https://docs.example.com/docs/page1');
      expect(links).toContain('https://docs.example.com/docs/page2');
    });

    it('should remove fragments and query params', () => {
      const html = '<a href="/page#section">Link</a><a href="/page?foo=bar">Link 2</a>';
      const links = extractLinks(html, 'https://docs.example.com/');
      expect(links).toContain('https://docs.example.com/page');
      expect(links).toHaveLength(1); // Should deduplicate
    });

    it('should skip anchor, mailto, and javascript links', () => {
      const html = `
        <a href="#section">Anchor</a>
        <a href="mailto:test@example.com">Email</a>
        <a href="javascript:void(0)">JS</a>
        <a href="/valid">Valid</a>
      `;
      const links = extractLinks(html, 'https://docs.example.com/');
      expect(links).toHaveLength(1);
      expect(links[0]).toBe('https://docs.example.com/valid');
    });

    it('should deduplicate links', () => {
      const html = `
        <a href="/page">Link 1</a>
        <a href="/page">Link 2</a>
        <a href="/page#section">Link 3</a>
      `;
      const links = extractLinks(html, 'https://docs.example.com/');
      expect(links).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // urlToFilename
  // --------------------------------------------------------------------------

  describe('urlToFilename', () => {
    it('should convert URL path to filename', () => {
      expect(urlToFilename('https://example.com/docs/install')).toBe('docs_install.md');
    });

    it('should handle paths with slashes', () => {
      expect(urlToFilename('https://example.com/a/b/c')).toBe('a_b_c.md');
    });

    it('should handle trailing slash', () => {
      expect(urlToFilename('https://example.com/docs/')).toBe('docs.md');
    });

    it('should handle root URL', () => {
      expect(urlToFilename('https://example.com/')).toBe('index.md');
    });

    it('should remove special characters', () => {
      expect(urlToFilename('https://example.com/docs/file.html')).toBe('docs_filehtml.md');
    });

    it('should handle invalid URLs', () => {
      expect(urlToFilename('not-a-url')).toBe('page.md');
    });
  });

  // --------------------------------------------------------------------------
  // matchesPatterns
  // --------------------------------------------------------------------------

  describe('matchesPatterns', () => {
    it('should return true when no patterns specified', () => {
      expect(matchesPatterns('https://example.com/page')).toBe(true);
    });

    it('should match include patterns', () => {
      expect(matchesPatterns(
        'https://example.com/docs/page',
        ['/docs/'],
      )).toBe(true);

      expect(matchesPatterns(
        'https://example.com/blog/post',
        ['/docs/'],
      )).toBe(false);
    });

    it('should exclude via exclude patterns', () => {
      expect(matchesPatterns(
        'https://example.com/docs/page',
        undefined,
        ['/api/'],
      )).toBe(true);

      expect(matchesPatterns(
        'https://example.com/api/endpoint',
        undefined,
        ['/api/'],
      )).toBe(false);
    });

    it('should apply both include and exclude', () => {
      expect(matchesPatterns(
        'https://example.com/docs/page',
        ['/docs/'],
        ['/docs/api/'],
      )).toBe(true);

      expect(matchesPatterns(
        'https://example.com/docs/api/endpoint',
        ['/docs/'],
        ['/api/'],
      )).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // fetchWebPage
  // --------------------------------------------------------------------------

  describe('fetchWebPage', () => {
    it('should fetch and convert HTML page', async () => {
      const html = '<html><head><title>Test</title></head><body><h1>Content</h1></body></html>';
      const mockFetch = createMockFetch(html);

      const result = await fetchWebPage('https://example.com/page', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.title).toBe('Test');
      expect(result.content).toContain('# Content');
      expect(result.url).toBe('https://example.com/page');
    });

    it('should handle markdown files directly', async () => {
      const markdown = '# Markdown Title\n\nContent here.';
      const mockFetch = createMockFetch(markdown, 200, { 'content-type': 'text/markdown' });

      const result = await fetchWebPage('https://example.com/doc.md', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(markdown);
      expect(result.title).toBe('Markdown Title');
    });

    it('should handle HTTP errors', async () => {
      const mockFetch = createMockFetch('Not Found', 404);

      const result = await fetchWebPage('https://example.com/missing', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should handle network errors', async () => {
      const mockFetch = createErrorFetch('Connection refused');

      const result = await fetchWebPage('https://example.com/page', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should reject responses that are too large', async () => {
      const largeContent = 'x'.repeat(3 * 1024 * 1024); // 3MB
      const mockFetch = createMockFetch(largeContent);

      const result = await fetchWebPage('https://example.com/large', {
        fetchFn: mockFetch,
        maxResponseSize: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject empty responses', async () => {
      const mockFetch = createMockFetch('');

      const result = await fetchWebPage('https://example.com/empty', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response');
    });

    it('should reject when no content extracted', async () => {
      const html = '<html><head></head><body></body></html>';
      const mockFetch = createMockFetch(html);

      const result = await fetchWebPage('https://example.com/empty', {
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No content extracted');
    });
  });

  // --------------------------------------------------------------------------
  // formatWebDoc
  // --------------------------------------------------------------------------

  describe('formatWebDoc', () => {
    it('should format successful result with metadata header', () => {
      const result: WebDocResult = {
        url: 'https://docs.example.com/install',
        success: true,
        content: '# Install\n\nRun the installer.',
        title: 'Install Guide',
        size: 30,
      };

      const formatted = formatWebDoc(result, sampleSource);

      expect(formatted).toContain('# Install Guide');
      expect(formatted).toContain('> 来源: https://docs.example.com/install');
      expect(formatted).toContain('> 软件: example');
      expect(formatted).toContain('> 抓取时间:');
      expect(formatted).toContain('Run the installer.');
    });

    it('should use URL-derived filename when no title', () => {
      const result: WebDocResult = {
        url: 'https://docs.example.com/docs/guide',
        success: true,
        content: 'Content',
        size: 7,
      };

      const formatted = formatWebDoc(result, sampleSource);
      expect(formatted).toContain('# docs_guide');
    });

    it('should return empty string for failed results', () => {
      const result: WebDocResult = {
        url: 'https://example.com',
        success: false,
        error: 'fail',
        size: 0,
      };

      expect(formatWebDoc(result, sampleSource)).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // saveWebDoc
  // --------------------------------------------------------------------------

  describe('saveWebDoc', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `web-scraper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should save document to file', () => {
      const result: WebDocResult = {
        url: 'https://docs.example.com/install',
        success: true,
        content: '# Install Guide',
        title: 'Install',
        size: 16,
      };

      const savedPath = saveWebDoc(result, sampleSource, tmpDir);
      expect(savedPath).not.toBeNull();
      expect(existsSync(savedPath!)).toBe(true);

      const content = readFileSync(savedPath!, 'utf-8');
      expect(content).toContain('# Install');
      expect(content).toContain('> 软件: example');
    });

    it('should create output directory if it does not exist', () => {
      const result: WebDocResult = {
        url: 'https://example.com/page',
        success: true,
        content: '# Test',
        size: 6,
      };

      saveWebDoc(result, sampleSource, tmpDir);
      expect(existsSync(tmpDir)).toBe(true);
    });

    it('should return null for failed results', () => {
      const result: WebDocResult = {
        url: 'https://example.com',
        success: false,
        error: 'fail',
        size: 0,
      };

      expect(saveWebDoc(result, sampleSource, tmpDir)).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // discoverPages
  // --------------------------------------------------------------------------

  describe('discoverPages', () => {
    it('should discover pages from base URL', async () => {
      const baseHtml = `
        <html><body>
          <a href="/docs/page1">Page 1</a>
          <a href="/docs/page2">Page 2</a>
        </body></html>
      `;

      const mockFetch = createMockFetch(baseHtml);

      const pages = await discoverPages(
        {
          baseUrl: 'https://docs.example.com/docs/',
          software: 'test',
        },
        { fetchFn: mockFetch, requestDelayMs: 0 },
      );

      expect(pages).toContain('https://docs.example.com/docs/');
      expect(pages.length).toBeGreaterThan(0);
    });

    it('should respect maxPages limit', async () => {
      const html = Array(50).fill(0).map((_, i) =>
        `<a href="/page${i}">Page ${i}</a>`
      ).join('');

      const mockFetch = createMockFetch(`<html><body>${html}</body></html>`);

      const pages = await discoverPages(
        {
          baseUrl: 'https://example.com/',
          software: 'test',
          maxPages: 5,
        },
        { fetchFn: mockFetch, requestDelayMs: 0 },
      );

      expect(pages.length).toBeLessThanOrEqual(5);
    });

    it('should respect maxDepth limit', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html><body><a href="/page">Link</a></body></html>'),
          headers: { get: () => null },
        });
      }) as unknown as typeof fetch;

      await discoverPages(
        {
          baseUrl: 'https://example.com/',
          software: 'test',
          maxDepth: 0,
        },
        { fetchFn: mockFetch, requestDelayMs: 0 },
      );

      expect(callCount).toBe(1); // Only base URL
    });

    it('should apply include patterns', async () => {
      const html = `
        <html><body>
          <a href="/docs/page1">Docs</a>
          <a href="/blog/post">Blog</a>
        </body></html>
      `;

      const mockFetch = createMockFetch(html);

      const pages = await discoverPages(
        {
          baseUrl: 'https://example.com/',
          software: 'test',
          includePatterns: ['/docs/'],
        },
        { fetchFn: mockFetch, requestDelayMs: 0 },
      );

      expect(pages.every(p => p.includes('/docs/'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // scrapeWebDocs
  // --------------------------------------------------------------------------

  describe('scrapeWebDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `web-scrape-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should scrape specified pages', async () => {
      const html = '<html><head><title>Test</title></head><body><h1>Content</h1></body></html>';
      const mockFetch = createMockFetch(html);

      const source: WebDocSource = {
        baseUrl: 'https://example.com',
        software: 'test',
        pages: ['https://example.com/page1', 'https://example.com/page2'],
      };

      const summary = await scrapeWebDocs(source, tmpDir, {
        fetchFn: mockFetch,
        requestDelayMs: 0,
      });

      expect(summary.baseUrl).toBe('https://example.com');
      expect(summary.software).toBe('test');
      expect(summary.totalFound).toBe(2);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);
    });

    it('should handle individual page failures', async () => {
      let callIndex = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<html><body><h1>OK</h1></body></html>'),
            headers: { get: () => null },
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(''),
          headers: { get: () => null },
        });
      }) as unknown as typeof fetch;

      const source: WebDocSource = {
        baseUrl: 'https://example.com',
        software: 'test',
        pages: ['https://example.com/ok', 'https://example.com/fail'],
      };

      const summary = await scrapeWebDocs(source, tmpDir, {
        fetchFn: mockFetch,
        requestDelayMs: 0,
      });

      expect(summary.totalFound).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
    });

    it('should discover pages when none specified', async () => {
      const html = '<html><body><a href="/page1">Page</a></body></html>';
      const mockFetch = createMockFetch(html);

      const source: WebDocSource = {
        baseUrl: 'https://example.com',
        software: 'test',
      };

      const summary = await scrapeWebDocs(source, tmpDir, {
        fetchFn: mockFetch,
        requestDelayMs: 0,
      });

      expect(summary.totalFound).toBeGreaterThan(0);
    });
  });
});
