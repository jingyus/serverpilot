/**
 * Document update detection module.
 *
 * Checks for updates to external documentation sources by comparing
 * last modified timestamps, commit SHAs (GitHub), or content hashes.
 * Helps minimize unnecessary re-fetching of unchanged documents.
 *
 * @module knowledge/doc-update-detector
 */

import crypto from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/** Result of an update check */
export interface UpdateCheckResult {
  /** Whether an update is available */
  hasUpdate: boolean;
  /** Current version identifier (SHA, timestamp, hash) */
  currentVersion?: string;
  /** Previous version identifier */
  previousVersion?: string;
  /** Reason for the result */
  reason?: string;
}

/** GitHub repository update check data */
export interface GitHubUpdateData {
  owner: string;
  repo: string;
  branch: string;
  /** Previous commit SHA */
  previousSha?: string;
}

/** Website update check data */
export interface WebsiteUpdateData {
  url: string;
  /** Previous content hash or last-modified timestamp */
  previousHash?: string;
}

/** Options for update detection */
export interface UpdateDetectorOptions {
  /** Custom fetch function (for testing) */
  fetchFn?: typeof fetch;
  /** Request timeout in ms */
  timeoutMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT = 'ServerPilot-UpdateDetector/0.1.0';

// ============================================================================
// GitHub Update Detection
// ============================================================================

/**
 * Check if a GitHub repository has been updated since the last fetch.
 *
 * Compares the current HEAD commit SHA with the previous SHA.
 * If no previous SHA is provided, returns true (needs initial fetch).
 */
export async function checkGitHubUpdate(
  data: GitHubUpdateData,
  options: UpdateDetectorOptions = {},
): Promise<UpdateCheckResult> {
  const { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // If no previous SHA, always fetch
  if (!data.previousSha) {
    return {
      hasUpdate: true,
      reason: 'No previous version recorded',
    };
  }

  try {
    const url = `${GITHUB_API_BASE}/repos/${data.owner}/${data.repo}/commits/${data.branch}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        hasUpdate: false,
        reason: `GitHub API error: ${response.status}`,
      };
    }

    const commit = (await response.json()) as { sha: string };
    const currentSha = commit.sha;

    return {
      hasUpdate: currentSha !== data.previousSha,
      currentVersion: currentSha,
      previousVersion: data.previousSha,
      reason: currentSha === data.previousSha ? 'No new commits' : 'New commits detected',
    };
  } catch (err) {
    return {
      hasUpdate: false,
      reason: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Extract the current commit SHA from a GitHub scrape summary.
 */
export function extractGitHubSha(results: Array<{ sha: string }>): string | undefined {
  // Use the first result's SHA as the version identifier
  return results[0]?.sha;
}

// ============================================================================
// Website Update Detection
// ============================================================================

/**
 * Check if a website page has been updated since the last fetch.
 *
 * Uses Last-Modified header if available, otherwise compares content hash.
 * If no previous hash is provided, returns true (needs initial fetch).
 */
export async function checkWebsiteUpdate(
  data: WebsiteUpdateData,
  options: UpdateDetectorOptions = {},
): Promise<UpdateCheckResult> {
  const { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // If no previous hash, always fetch
  if (!data.previousHash) {
    return {
      hasUpdate: true,
      reason: 'No previous version recorded',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // First try HEAD request to check Last-Modified header
    const headResponse = await fetchFn(data.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });

    clearTimeout(timeoutId);

    if (headResponse.ok) {
      const lastModified = headResponse.headers.get('last-modified');
      if (lastModified) {
        const currentVersion = new Date(lastModified).toISOString();
        return {
          hasUpdate: currentVersion !== data.previousHash,
          currentVersion,
          previousVersion: data.previousHash,
          reason:
            currentVersion === data.previousHash
              ? 'Last-Modified unchanged'
              : 'Last-Modified changed',
        };
      }
    }

    // Fallback: fetch content and compare hash
    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), timeoutMs);

    const response = await fetchFn(data.url, {
      signal: getController.signal,
      headers: { 'User-Agent': USER_AGENT },
    });

    clearTimeout(getTimeoutId);

    if (!response.ok) {
      return {
        hasUpdate: false,
        reason: `HTTP ${response.status}`,
      };
    }

    const content = await response.text();
    const currentHash = hashContent(content);

    return {
      hasUpdate: currentHash !== data.previousHash,
      currentVersion: currentHash,
      previousVersion: data.previousHash,
      reason: currentHash === data.previousHash ? 'Content unchanged' : 'Content changed',
    };
  } catch (err) {
    return {
      hasUpdate: false,
      reason: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Compute a SHA-256 hash of content for change detection.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * Extract content hash from a website scrape result.
 */
export function extractWebsiteHash(content: string): string {
  return hashContent(content);
}

// ============================================================================
// Batch Update Checking
// ============================================================================

/**
 * Check multiple GitHub sources for updates in parallel.
 */
export async function checkMultipleGitHubUpdates(
  sources: GitHubUpdateData[],
  options: UpdateDetectorOptions = {},
): Promise<UpdateCheckResult[]> {
  return Promise.all(sources.map((source) => checkGitHubUpdate(source, options)));
}

/**
 * Check multiple website sources for updates in parallel.
 */
export async function checkMultipleWebsiteUpdates(
  sources: WebsiteUpdateData[],
  options: UpdateDetectorOptions = {},
): Promise<UpdateCheckResult[]> {
  return Promise.all(sources.map((source) => checkWebsiteUpdate(source, options)));
}
