// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Website documentation scraper.
 *
 * Fetches documentation from official websites, extracts content from
 * HTML pages, and converts it to markdown. Supports sitemap-based
 * discovery and depth-limited crawling.
 *
 * @module knowledge/web-doc-scraper
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Configuration for a website documentation source */
export interface WebDocSource {
  /** Base URL of the documentation site (e.g., 'https://redis.io/docs/') */
  baseUrl: string;
  /** Software name for categorization */
  software: string;
  /** Specific page URLs to fetch (if empty, tries sitemap discovery) */
  pages?: string[];
  /** Maximum crawl depth from the base URL (default: 2) */
  maxDepth?: number;
  /** Maximum number of pages to fetch (default: 30) */
  maxPages?: number;
  /** URL patterns to include (regex strings) */
  includePatterns?: string[];
  /** URL patterns to exclude (regex strings) */
  excludePatterns?: string[];
}

/** Result of fetching a single web page */
export interface WebDocResult {
  /** URL of the page */
  url: string;
  /** Whether the fetch was successful */
  success: boolean;
  /** Extracted markdown content */
  content?: string;
  /** Page title extracted from HTML */
  title?: string;
  /** Error message (if failed) */
  error?: string;
  /** Content size in bytes */
  size: number;
}

/** Summary of a website scrape operation */
export interface WebScrapeSummary {
  /** Base URL of the documentation site */
  baseUrl: string;
  /** Software name */
  software: string;
  /** Total pages found/specified */
  totalFound: number;
  /** Pages successfully fetched */
  succeeded: number;
  /** Pages that failed to fetch */
  failed: number;
  /** Individual results */
  results: WebDocResult[];
  /** Output directory */
  outputDir: string;
}

/** Options for web fetching (injectable for testing) */
export interface WebFetchOptions {
  /** Custom fetch function */
  fetchFn?: typeof fetch;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Maximum response size in bytes (default: 2MB) */
  maxResponseSize?: number;
  /** Delay between requests in ms (default: 500) */
  requestDelayMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES = 30;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_SIZE = 2 * 1024 * 1024;
const DEFAULT_REQUEST_DELAY_MS = 500;
const USER_AGENT = 'ServerPilot-DocScraper/0.1.0';

// ============================================================================
// HTML to Markdown Conversion
// ============================================================================

/**
 * Extract the page title from HTML content.
 */
export function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

/**
 * Strip HTML tags and convert basic elements to markdown.
 *
 * This is a lightweight converter that handles the most common HTML
 * elements found in documentation pages. For more complex cases,
 * consider adding cheerio/turndown as dependencies.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style blocks
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  md = md.replace(/<header[\s\S]*?<\/header>/gi, '');
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Try to extract main content area
  const mainMatch = md.match(
    /<(?:main|article|div[^>]*class="[^"]*(?:content|docs|documentation|markdown)[^"]*")[^>]*>([\s\S]*?)<\/(?:main|article|div)>/i,
  );
  if (mainMatch) {
    md = mainMatch[1];
  }

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Convert code blocks
  md = md.replace(
    /<pre[^>]*><code[^>]*(?:class="[^"]*language-(\w+)[^"]*")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_match, lang, code) => `\n\`\`\`${lang || ''}\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`,
  );
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert emphasis
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n');

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
    const lines = content.trim().split('\n');
    return '\n' + lines.map((l: string) => `> ${l.trim()}`).join('\n') + '\n';
  });

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = decodeHtmlEntities(md);

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/^\s+|\s+$/g, '');

  return md;
}

/**
 * Decode common HTML entities.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * Extract links from an HTML page that match the base URL.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href="([^"]*?)"/gi;
  let match;

  const baseOrigin = new URL(baseUrl).origin;
  const basePath = new URL(baseUrl).pathname;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
      continue;
    }

    // Resolve relative URLs
    try {
      const resolved = new URL(href, baseUrl).href;
      if (resolved.startsWith(baseOrigin) && resolved.includes(basePath)) {
        // Remove fragment and query
        const clean = resolved.split('#')[0].split('?')[0];
        if (!links.includes(clean) && clean !== baseUrl) {
          links.push(clean);
        }
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return links;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch a single web documentation page.
 */
export async function fetchWebPage(
  url: string,
  options: WebFetchOptions = {},
): Promise<WebDocResult> {
  const {
    fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseSize = DEFAULT_MAX_RESPONSE_SIZE,
  } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, text/markdown, text/plain, */*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        url,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        size: 0,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (text.length > maxResponseSize) {
      return {
        url,
        success: false,
        error: `Response too large: ${text.length} bytes`,
        size: text.length,
      };
    }

    if (text.trim().length === 0) {
      return {
        url,
        success: false,
        error: 'Empty response body',
        size: 0,
      };
    }

    // If it's already markdown, use directly
    if (contentType.includes('markdown') || url.endsWith('.md')) {
      const title = extractMarkdownTitle(text);
      return {
        url,
        success: true,
        content: text,
        title,
        size: Buffer.byteLength(text, 'utf-8'),
      };
    }

    // Convert HTML to markdown
    const title = extractHtmlTitle(text);
    const markdown = htmlToMarkdown(text);

    if (markdown.trim().length === 0) {
      return {
        url,
        success: false,
        error: 'No content extracted from HTML',
        size: 0,
      };
    }

    return {
      url,
      success: true,
      content: markdown,
      title,
      size: Buffer.byteLength(markdown, 'utf-8'),
    };
  } catch (err) {
    return {
      url,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      size: 0,
    };
  }
}

/**
 * Extract title from markdown content (first heading).
 */
function extractMarkdownTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Format a web document with metadata header.
 */
export function formatWebDoc(result: WebDocResult, source: WebDocSource): string {
  if (!result.success || !result.content) return '';

  const header = [
    `# ${result.title || urlToFilename(result.url)}`,
    '',
    `> 来源: ${result.url}`,
    `> 软件: ${source.software}`,
    `> 抓取时间: ${new Date().toISOString().split('T')[0]}`,
    '',
    '---',
    '',
  ].join('\n');

  return header + result.content;
}

/**
 * Convert a URL to a safe filename.
 */
export function urlToFilename(url: string): string {
  try {
    const parsed = new URL(url);
    let name = parsed.pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');

    if (!name) name = 'index';
    if (!name.endsWith('.md')) name += '.md';
    return name;
  } catch {
    return 'page.md';
  }
}

/**
 * Save a web document to the file system.
 */
export function saveWebDoc(
  result: WebDocResult,
  source: WebDocSource,
  outputDir: string,
): string | null {
  if (!result.success || !result.content) return null;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const formatted = formatWebDoc(result, source);
  const filename = urlToFilename(result.url);
  const filePath = path.join(outputDir, filename);
  writeFileSync(filePath, formatted, 'utf-8');
  return filePath;
}

/**
 * Apply URL pattern filters.
 */
export function matchesPatterns(
  url: string,
  includePatterns?: string[],
  excludePatterns?: string[],
): boolean {
  if (excludePatterns && excludePatterns.length > 0) {
    for (const pattern of excludePatterns) {
      if (new RegExp(pattern).test(url)) return false;
    }
  }

  if (includePatterns && includePatterns.length > 0) {
    return includePatterns.some((pattern) => new RegExp(pattern).test(url));
  }

  return true;
}

/**
 * Delay execution for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Discover pages by crawling from the base URL.
 *
 * Follows links on the base page up to the configured depth,
 * collecting documentation page URLs.
 */
export async function discoverPages(
  source: WebDocSource,
  options: WebFetchOptions = {},
): Promise<string[]> {
  const {
    fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
  } = options;
  const maxDepth = source.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = source.maxPages ?? DEFAULT_MAX_PAGES;

  const visited = new Set<string>();
  const discovered: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [
    { url: source.baseUrl, depth: 0 },
  ];

  while (queue.length > 0 && discovered.length < maxPages) {
    const item = queue.shift()!;
    if (visited.has(item.url) || item.depth > maxDepth) continue;
    visited.add(item.url);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchFn(item.url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const html = await response.text();

      if (matchesPatterns(item.url, source.includePatterns, source.excludePatterns)) {
        discovered.push(item.url);
      }

      if (item.depth < maxDepth) {
        const links = extractLinks(html, source.baseUrl);
        for (const link of links) {
          if (!visited.has(link) && discovered.length + queue.length < maxPages * 2) {
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }

      if (requestDelayMs > 0) {
        await delay(requestDelayMs);
      }
    } catch {
      // Continue on error
    }
  }

  return discovered.slice(0, maxPages);
}

/**
 * Scrape documentation from a website.
 *
 * If specific pages are provided, fetches those directly. Otherwise,
 * discovers pages by crawling from the base URL.
 *
 * @param source - Web doc source configuration
 * @param outputDir - Directory to save scraped documents
 * @param options - Fetch options
 * @returns Summary of the scrape operation
 */
export async function scrapeWebDocs(
  source: WebDocSource,
  outputDir: string,
  options: WebFetchOptions = {},
): Promise<WebScrapeSummary> {
  const { requestDelayMs = DEFAULT_REQUEST_DELAY_MS } = options;

  // Determine pages to fetch
  let pages: string[];
  if (source.pages && source.pages.length > 0) {
    pages = source.pages;
  } else {
    pages = await discoverPages(source, options);
  }

  const results: WebDocResult[] = [];

  for (const pageUrl of pages) {
    const result = await fetchWebPage(pageUrl, options);
    if (result.success) {
      saveWebDoc(result, source, outputDir);
    }
    results.push(result);

    if (requestDelayMs > 0 && pages.indexOf(pageUrl) < pages.length - 1) {
      await delay(requestDelayMs);
    }
  }

  const succeeded = results.filter((r) => r.success).length;

  return {
    baseUrl: source.baseUrl,
    software: source.software,
    totalFound: pages.length,
    succeeded,
    failed: pages.length - succeeded,
    results,
    outputDir,
  };
}
