/**
 * Knowledge base solution document save module.
 *
 * Orchestrates the scraper to fetch OpenClaw installation solution
 * documents and persist them to the knowledge-base/openclaw/solutions/ directory.
 *
 * @module knowledge/save-solutions
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
export const DEFAULT_SOLUTIONS_DIR = 'knowledge-base/openclaw/solutions';

/** Required solution files that must exist after a successful save */
export const REQUIRED_SOLUTIONS = [
  'npm-registry-timeout.md',
  'node-version-mismatch.md',
  'global-install-permission.md',
] as const;

/** Default solution pages to scrape */
export const DEFAULT_SOLUTION_PAGES: DocPage[] = [
  {
    url: 'https://docs.openclaw.ai/solutions/npm-registry-timeout.md',
    filename: 'npm-registry-timeout',
    title: 'npm Registry 超时解决方案',
    category: 'solutions',
  },
  {
    url: 'https://docs.openclaw.ai/solutions/node-version-mismatch.md',
    filename: 'node-version-mismatch',
    title: 'Node.js 版本不匹配解决方案',
    category: 'solutions',
  },
  {
    url: 'https://docs.openclaw.ai/solutions/global-install-permission.md',
    filename: 'global-install-permission',
    title: '全局安装权限解决方案',
    category: 'solutions',
  },
];

// ============================================================================
// Types
// ============================================================================

/** Options for the saveOpenClawSolutions function */
export interface SaveSolutionsOptions {
  /** Project root directory (defaults to auto-detection) */
  projectRoot?: string;
  /** Custom output subdirectory (defaults to DEFAULT_SOLUTIONS_DIR) */
  outputSubdir?: string;
  /** Custom pages to scrape (defaults to DEFAULT_SOLUTION_PAGES) */
  pages?: DocPage[];
  /** Fetch options passed through to the scraper */
  fetchOptions?: FetchOptions;
}

/** Result of a save operation */
export interface SaveSolutionsResult {
  /** The scrape summary from the underlying scraper */
  scrapeSummary: ScrapeSummary;
  /** Absolute path of the output directory */
  outputDir: string;
  /** List of files that were saved */
  savedFiles: string[];
  /** List of required files that are missing */
  missingRequired: string[];
  /** Whether all required solution docs are present */
  allRequiredPresent: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Resolve the output directory for saving solution docs.
 *
 * @param options - Save options
 * @returns Absolute path to the output directory
 */
export function resolveSolutionsDir(options: SaveSolutionsOptions = {}): string {
  const projectRoot = options.projectRoot ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const subdir = options.outputSubdir ?? DEFAULT_SOLUTIONS_DIR;
  return path.resolve(projectRoot, subdir);
}

/**
 * List existing solution files in the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of filenames (e.g., ['npm-registry-timeout.md', 'node-version-mismatch.md'])
 */
export function listExistingSolutions(outputDir: string): string[] {
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
 * Check which required solution docs are missing from the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of missing required filenames
 */
export function checkMissingSolutions(outputDir: string): string[] {
  const existing = listExistingSolutions(outputDir);
  return REQUIRED_SOLUTIONS.filter((req) => !existing.includes(req));
}

/**
 * Save OpenClaw solution documentation to the knowledge base directory.
 *
 * Orchestrates the scraper to fetch solution pages and save them
 * to knowledge-base/openclaw/solutions/. Returns a detailed result including
 * which files were saved and whether all required docs are present.
 *
 * @param options - Save options
 * @returns Detailed result of the save operation
 */
export async function saveOpenClawSolutions(
  options: SaveSolutionsOptions = {},
): Promise<SaveSolutionsResult> {
  const outputDir = resolveSolutionsDir(options);
  const pages = options.pages ?? DEFAULT_SOLUTION_PAGES;
  const fetchOptions = options.fetchOptions ?? {};

  const scrapeSummary = await scrapeOpenClawDocs(outputDir, pages, fetchOptions);

  const savedFiles = listExistingSolutions(outputDir);
  const missingRequired = checkMissingSolutions(outputDir);

  return {
    scrapeSummary,
    outputDir,
    savedFiles,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
  };
}
