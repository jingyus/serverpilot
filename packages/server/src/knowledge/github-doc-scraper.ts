/**
 * GitHub repository documentation scraper.
 *
 * Fetches documentation files (markdown, text) from GitHub repositories
 * using the GitHub REST API. Supports traversing repository trees,
 * filtering by path/extension, and rate limit handling.
 *
 * @module knowledge/github-doc-scraper
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Configuration for a GitHub documentation source */
export interface GitHubDocSource {
  /** Repository owner (e.g., 'nginx') */
  owner: string;
  /** Repository name (e.g., 'nginx') */
  repo: string;
  /** Branch to fetch from (default: 'main') */
  branch?: string;
  /** Paths within the repo to scan (e.g., ['docs/', 'README.md']) */
  paths?: string[];
  /** File extensions to include (default: ['.md', '.txt', '.rst']) */
  extensions?: string[];
  /** Maximum number of files to fetch (default: 50) */
  maxFiles?: number;
}

/** A single file entry from the GitHub tree API */
export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

/** Result of fetching a single GitHub document */
export interface GitHubDocResult {
  /** File path within the repository */
  filePath: string;
  /** Whether the fetch was successful */
  success: boolean;
  /** Decoded content (if successful) */
  content?: string;
  /** Error message (if failed) */
  error?: string;
  /** Content size in bytes */
  size: number;
  /** SHA of the file */
  sha: string;
}

/** Summary of a GitHub scrape operation */
export interface GitHubScrapeSummary {
  /** Source repository identifier (owner/repo) */
  repository: string;
  /** Branch used */
  branch: string;
  /** Total files found matching criteria */
  totalFound: number;
  /** Files successfully fetched */
  succeeded: number;
  /** Files that failed to fetch */
  failed: number;
  /** Individual results */
  results: GitHubDocResult[];
  /** Output directory */
  outputDir: string;
  /** Remaining API rate limit (if available) */
  rateLimitRemaining?: number;
}

/** Options for GitHub API requests (injectable for testing) */
export interface GitHubFetchOptions {
  /** Custom fetch function */
  fetchFn?: typeof fetch;
  /** GitHub personal access token (optional, increases rate limit) */
  token?: string;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Maximum file size in bytes to download (default: 512KB) */
  maxFileSize?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** GitHub REST API base URL */
export const GITHUB_API_BASE = 'https://api.github.com';

/** Default file extensions to include */
const DEFAULT_EXTENSIONS = ['.md', '.txt', '.rst'];

/** Default maximum files to fetch */
const DEFAULT_MAX_FILES = 50;

/** Default maximum file size (512KB) */
const DEFAULT_MAX_FILE_SIZE = 512 * 1024;

/** Default timeout (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/** User-Agent header for GitHub API */
const USER_AGENT = 'ServerPilot-DocScraper/0.1.0';

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build HTTP headers for GitHub API requests.
 */
export function buildGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Fetch the repository tree (file listing) from GitHub.
 *
 * Uses the Git Trees API with `recursive=1` to get all files in one call.
 *
 * @param source - GitHub doc source configuration
 * @param options - Fetch options
 * @returns Array of tree entries matching the criteria
 */
export async function fetchRepoTree(
  source: GitHubDocSource,
  options: GitHubFetchOptions = {},
): Promise<{ entries: GitHubTreeEntry[]; rateLimitRemaining?: number }> {
  const { fetchFn = globalThis.fetch, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const branch = source.branch ?? 'main';
  const url = `${GITHUB_API_BASE}/repos/${source.owner}/${source.repo}/git/trees/${branch}?recursive=1`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: buildGitHubHeaders(token),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      tree: GitHubTreeEntry[];
      truncated: boolean;
    };

    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');

    const entries = filterTreeEntries(data.tree, source);

    return {
      entries,
      rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : undefined,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Filter tree entries based on source configuration (paths and extensions).
 */
export function filterTreeEntries(
  tree: GitHubTreeEntry[],
  source: GitHubDocSource,
): GitHubTreeEntry[] {
  const extensions = source.extensions ?? DEFAULT_EXTENSIONS;
  const maxFiles = source.maxFiles ?? DEFAULT_MAX_FILES;
  const paths = source.paths ?? [];

  let filtered = tree.filter((entry) => {
    if (entry.type !== 'blob') return false;
    const ext = path.extname(entry.path).toLowerCase();
    if (!extensions.includes(ext)) return false;
    return true;
  });

  // If specific paths are configured, only include files under those paths
  if (paths.length > 0) {
    filtered = filtered.filter((entry) =>
      paths.some((p) => {
        if (p.endsWith('/')) {
          return entry.path.startsWith(p);
        }
        return entry.path === p;
      }),
    );
  }

  return filtered.slice(0, maxFiles);
}

/**
 * Fetch a single file's content from GitHub.
 *
 * Uses the Contents API which returns base64-encoded content.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param filePath - File path within the repository
 * @param options - Fetch options
 * @returns The decoded file content
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
  options: GitHubFetchOptions = {},
): Promise<{ content: string; sha: string; size: number }> {
  const {
    fetchFn = globalThis.fetch,
    token,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = options;

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: buildGitHubHeaders(token),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: string;
      encoding: string;
      sha: string;
      size: number;
    };

    if (data.size > maxFileSize) {
      throw new Error(`File too large: ${data.size} bytes (max: ${maxFileSize})`);
    }

    const content = data.encoding === 'base64'
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : data.content;

    return { content, sha: data.sha, size: data.size };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Format a GitHub document with metadata header.
 */
export function formatGitHubDoc(
  result: GitHubDocResult,
  source: GitHubDocSource,
): string {
  if (!result.success || !result.content) return '';

  const repoUrl = `https://github.com/${source.owner}/${source.repo}`;
  const fileUrl = `${repoUrl}/blob/${source.branch ?? 'main'}/${result.filePath}`;

  const header = [
    `# ${path.basename(result.filePath, path.extname(result.filePath))}`,
    '',
    `> 来源: ${fileUrl}`,
    `> 仓库: ${source.owner}/${source.repo}`,
    `> 抓取时间: ${new Date().toISOString().split('T')[0]}`,
    '',
    '---',
    '',
  ].join('\n');

  return header + result.content;
}

/**
 * Save a GitHub document to the file system.
 */
export function saveGitHubDoc(
  result: GitHubDocResult,
  source: GitHubDocSource,
  outputDir: string,
): string | null {
  if (!result.success || !result.content) return null;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const formatted = formatGitHubDoc(result, source);
  const sanitizedName = result.filePath.replace(/\//g, '_');
  const filePath = path.join(outputDir, sanitizedName);
  writeFileSync(filePath, formatted, 'utf-8');
  return filePath;
}

/**
 * Scrape documentation from a GitHub repository.
 *
 * Fetches the repo tree, filters matching doc files, downloads each,
 * and saves them to the output directory.
 *
 * @param source - GitHub doc source configuration
 * @param outputDir - Directory to save scraped documents
 * @param options - Fetch options
 * @returns Summary of the scrape operation
 */
export async function scrapeGitHubDocs(
  source: GitHubDocSource,
  outputDir: string,
  options: GitHubFetchOptions = {},
): Promise<GitHubScrapeSummary> {
  const branch = source.branch ?? 'main';
  const results: GitHubDocResult[] = [];
  let rateLimitRemaining: number | undefined;

  try {
    const treeResult = await fetchRepoTree(source, options);
    rateLimitRemaining = treeResult.rateLimitRemaining;

    for (const entry of treeResult.entries) {
      try {
        const { content, sha, size } = await fetchFileContent(
          source.owner,
          source.repo,
          entry.path,
          branch,
          options,
        );

        const result: GitHubDocResult = {
          filePath: entry.path,
          success: true,
          content,
          size,
          sha,
        };

        saveGitHubDoc(result, source, outputDir);
        results.push(result);
      } catch (err) {
        results.push({
          filePath: entry.path,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          size: 0,
          sha: entry.sha,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;

    return {
      repository: `${source.owner}/${source.repo}`,
      branch,
      totalFound: treeResult.entries.length,
      succeeded,
      failed: treeResult.entries.length - succeeded,
      results,
      outputDir,
      rateLimitRemaining,
    };
  } catch (err) {
    return {
      repository: `${source.owner}/${source.repo}`,
      branch,
      totalFound: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      outputDir,
      rateLimitRemaining,
    };
  }
}
