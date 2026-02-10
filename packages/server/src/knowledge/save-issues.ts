/**
 * Knowledge base issue document save module.
 *
 * Orchestrates the scraper to fetch OpenClaw common issue documents and
 * persist them to the knowledge-base/openclaw/issues/ directory.
 *
 * @module knowledge/save-issues
 */

import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  scrapeOpenClawDocs,
  type DocPage,
  type FetchOptions,
  type ScrapeSummary,
} from './scraper.js';
import { findProjectRoot } from './save-docs.js';

// ============================================================================
// Constants
// ============================================================================

/** Default output directory relative to the project root */
export const DEFAULT_ISSUES_DIR = 'knowledge-base/openclaw/issues';

/** Required issue files that must exist after a successful save */
export const REQUIRED_ISSUES = [
  'network-errors.md',
  'permission-errors.md',
  'dependency-errors.md',
  'version-conflicts.md',
] as const;

/** Default issue pages to scrape */
export const DEFAULT_ISSUE_PAGES: DocPage[] = [
  {
    url: 'https://docs.openclaw.ai/help/network-errors.md',
    filename: 'network-errors',
    title: 'OpenClaw 网络错误',
    category: 'issues',
  },
  {
    url: 'https://docs.openclaw.ai/help/permission-errors.md',
    filename: 'permission-errors',
    title: 'OpenClaw 权限错误',
    category: 'issues',
  },
  {
    url: 'https://docs.openclaw.ai/help/dependency-errors.md',
    filename: 'dependency-errors',
    title: 'OpenClaw 依赖错误',
    category: 'issues',
  },
  {
    url: 'https://docs.openclaw.ai/help/version-conflicts.md',
    filename: 'version-conflicts',
    title: 'OpenClaw 版本冲突',
    category: 'issues',
  },
];

// ============================================================================
// Types
// ============================================================================

/** Options for the saveOpenClawIssues function */
export interface SaveIssuesOptions {
  /** Project root directory (defaults to auto-detection) */
  projectRoot?: string;
  /** Custom output subdirectory (defaults to DEFAULT_ISSUES_DIR) */
  outputSubdir?: string;
  /** Custom pages to scrape (defaults to DEFAULT_ISSUE_PAGES) */
  pages?: DocPage[];
  /** Fetch options passed through to the scraper */
  fetchOptions?: FetchOptions;
}

/** Result of a save operation */
export interface SaveIssuesResult {
  /** The scrape summary from the underlying scraper */
  scrapeSummary: ScrapeSummary;
  /** Absolute path of the output directory */
  outputDir: string;
  /** List of files that were saved */
  savedFiles: string[];
  /** List of required files that are missing */
  missingRequired: string[];
  /** Whether all required issue docs are present */
  allRequiredPresent: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Resolve the output directory for saving issue docs.
 *
 * @param options - Save options
 * @returns Absolute path to the output directory
 */
export function resolveIssuesDir(options: SaveIssuesOptions = {}): string {
  const projectRoot = options.projectRoot ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const subdir = options.outputSubdir ?? DEFAULT_ISSUES_DIR;
  return path.resolve(projectRoot, subdir);
}

/**
 * List existing issue files in the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of filenames (e.g., ['network-errors.md', 'permission-errors.md'])
 */
export function listExistingIssues(outputDir: string): string[] {
  if (!existsSync(outputDir)) {
    return [];
  }

  try {
    return readdirSync(outputDir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Check which required issue docs are missing from the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of missing required filenames
 */
export function checkMissingIssues(outputDir: string): string[] {
  const existing = listExistingIssues(outputDir);
  return REQUIRED_ISSUES.filter((req) => !existing.includes(req));
}

/**
 * Save OpenClaw issue documentation to the knowledge base directory.
 *
 * Orchestrates the scraper to fetch issue pages and save them
 * to knowledge-base/openclaw/issues/. Returns a detailed result including
 * which files were saved and whether all required docs are present.
 *
 * @param options - Save options
 * @returns Detailed result of the save operation
 */
export async function saveOpenClawIssues(
  options: SaveIssuesOptions = {},
): Promise<SaveIssuesResult> {
  const outputDir = resolveIssuesDir(options);
  const pages = options.pages ?? DEFAULT_ISSUE_PAGES;
  const fetchOptions = options.fetchOptions ?? {};

  const scrapeSummary = await scrapeOpenClawDocs(outputDir, pages, fetchOptions);

  const savedFiles = listExistingIssues(outputDir);
  const missingRequired = checkMissingIssues(outputDir);

  return {
    scrapeSummary,
    outputDir,
    savedFiles,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
  };
}
