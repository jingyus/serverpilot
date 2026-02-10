/**
 * OpenClaw documentation scraper module.
 *
 * Fetches installation documentation from the OpenClaw official site
 * and saves it as structured markdown files to the knowledge base.
 *
 * @module knowledge/scraper
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Represents a single documentation page to scrape */
export interface DocPage {
  /** URL of the documentation page */
  url: string;
  /** Output filename (without extension) */
  filename: string;
  /** Human-readable title */
  title: string;
  /** Category for organization */
  category: 'docs' | 'issues' | 'cases' | 'solutions';
}

/** Result of scraping a single page */
export interface ScrapeResult {
  /** The page that was scraped */
  page: DocPage;
  /** Whether the scrape was successful */
  success: boolean;
  /** Content retrieved (if successful) */
  content?: string;
  /** Error message (if failed) */
  error?: string;
  /** Content length in bytes */
  contentLength: number;
}

/** Summary of a complete scrape operation */
export interface ScrapeSummary {
  /** Total pages attempted */
  total: number;
  /** Number of successful scrapes */
  succeeded: number;
  /** Number of failed scrapes */
  failed: number;
  /** Individual results */
  results: ScrapeResult[];
  /** Output directory path */
  outputDir: string;
}

/** Options for the fetch function (injectable for testing) */
export interface FetchOptions {
  /** Custom fetch function (defaults to global fetch) */
  fetchFn?: typeof fetch;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Base URL for OpenClaw documentation */
export const OPENCLAW_DOCS_BASE = 'https://docs.openclaw.ai';

/** Default pages to scrape for installation documentation */
export const DEFAULT_DOC_PAGES: DocPage[] = [
  {
    url: `${OPENCLAW_DOCS_BASE}/install/index.md`,
    filename: 'installation',
    title: 'OpenClaw 安装指南',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/start/getting-started.md`,
    filename: 'getting-started',
    title: 'OpenClaw 快速开始',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/install/node.md`,
    filename: 'prerequisites',
    title: 'OpenClaw 前置要求',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/help/troubleshooting.md`,
    filename: 'troubleshooting',
    title: 'OpenClaw 故障排除',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/help/faq.md`,
    filename: 'faq',
    title: 'OpenClaw 常见问题',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/environment.md`,
    filename: 'environment',
    title: 'OpenClaw 环境变量配置',
    category: 'docs',
  },
  {
    url: `${OPENCLAW_DOCS_BASE}/start/setup.md`,
    filename: 'setup',
    title: 'OpenClaw 安装配置',
    category: 'docs',
  },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch the content of a single documentation page.
 *
 * @param page - The documentation page to fetch
 * @param options - Fetch options including custom fetch function and timeout
 * @returns A ScrapeResult with the fetched content or error
 */
export async function fetchDocPage(
  page: DocPage,
  options: FetchOptions = {},
): Promise<ScrapeResult> {
  const { fetchFn = globalThis.fetch, timeoutMs = 30000 } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchFn(page.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AIInstaller-DocScraper/0.1.0',
        Accept: 'text/markdown, text/plain, */*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        page,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        contentLength: 0,
      };
    }

    const content = await response.text();

    if (!content || content.trim().length === 0) {
      return {
        page,
        success: false,
        error: 'Empty response body',
        contentLength: 0,
      };
    }

    return {
      page,
      success: true,
      content,
      contentLength: Buffer.byteLength(content, 'utf-8'),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      page,
      success: false,
      error: message,
      contentLength: 0,
    };
  }
}

/**
 * Format scraped content with metadata header.
 *
 * Adds a standardized header with source URL, title, and scrape timestamp.
 *
 * @param result - The scrape result with content
 * @returns Formatted markdown string with metadata header
 */
export function formatDocContent(result: ScrapeResult): string {
  if (!result.success || !result.content) {
    return '';
  }

  const header = [
    `# ${result.page.title}`,
    '',
    `> 来源: ${result.page.url}`,
    `> 抓取时间: ${new Date().toISOString().split('T')[0]}`,
    '',
    '---',
    '',
  ].join('\n');

  return header + result.content;
}

/**
 * Save a scraped document to the file system.
 *
 * Creates the output directory if it doesn't exist, then writes the
 * formatted content to a markdown file.
 *
 * @param result - The scrape result to save
 * @param outputDir - Directory to save the file in
 * @returns The full path of the saved file, or null if nothing was saved
 */
export function saveDocToFile(result: ScrapeResult, outputDir: string): string | null {
  if (!result.success || !result.content) {
    return null;
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const formatted = formatDocContent(result);
  const filePath = path.join(outputDir, `${result.page.filename}.md`);
  writeFileSync(filePath, formatted, 'utf-8');
  return filePath;
}

/**
 * Scrape all configured OpenClaw documentation pages.
 *
 * Fetches each page sequentially, formats the content, and saves to disk.
 * Returns a summary of the operation.
 *
 * @param outputDir - Directory to save scraped documents
 * @param pages - Pages to scrape (defaults to DEFAULT_DOC_PAGES)
 * @param options - Fetch options
 * @returns Summary of the scrape operation
 */
export async function scrapeOpenClawDocs(
  outputDir: string,
  pages: DocPage[] = DEFAULT_DOC_PAGES,
  options: FetchOptions = {},
): Promise<ScrapeSummary> {
  const results: ScrapeResult[] = [];

  for (const page of pages) {
    const result = await fetchDocPage(page, options);
    if (result.success) {
      saveDocToFile(result, outputDir);
    }
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;

  return {
    total: pages.length,
    succeeded,
    failed: pages.length - succeeded,
    results,
    outputDir,
  };
}
