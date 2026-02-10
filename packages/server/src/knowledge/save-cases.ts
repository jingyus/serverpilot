/**
 * Knowledge base case document save module.
 *
 * Orchestrates the scraper to fetch OpenClaw installation success case
 * documents and persist them to the knowledge-base/openclaw/cases/ directory.
 *
 * @module knowledge/save-cases
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
export const DEFAULT_CASES_DIR = 'knowledge-base/openclaw/cases';

/** Required case files that must exist after a successful save */
export const REQUIRED_CASES = [
  'macos-m1.md',
  'ubuntu-22.md',
  'windows-wsl.md',
] as const;

/** Default case pages to scrape */
export const DEFAULT_CASE_PAGES: DocPage[] = [
  {
    url: 'https://docs.openclaw.ai/cases/macos-m1.md',
    filename: 'macos-m1',
    title: 'macOS M1/M2 安装案例',
    category: 'cases',
  },
  {
    url: 'https://docs.openclaw.ai/cases/ubuntu-22.md',
    filename: 'ubuntu-22',
    title: 'Ubuntu 22.04 安装案例',
    category: 'cases',
  },
  {
    url: 'https://docs.openclaw.ai/cases/windows-wsl.md',
    filename: 'windows-wsl',
    title: 'Windows WSL 安装案例',
    category: 'cases',
  },
];

// ============================================================================
// Types
// ============================================================================

/** Options for the saveOpenClawCases function */
export interface SaveCasesOptions {
  /** Project root directory (defaults to auto-detection) */
  projectRoot?: string;
  /** Custom output subdirectory (defaults to DEFAULT_CASES_DIR) */
  outputSubdir?: string;
  /** Custom pages to scrape (defaults to DEFAULT_CASE_PAGES) */
  pages?: DocPage[];
  /** Fetch options passed through to the scraper */
  fetchOptions?: FetchOptions;
}

/** Result of a save operation */
export interface SaveCasesResult {
  /** The scrape summary from the underlying scraper */
  scrapeSummary: ScrapeSummary;
  /** Absolute path of the output directory */
  outputDir: string;
  /** List of files that were saved */
  savedFiles: string[];
  /** List of required files that are missing */
  missingRequired: string[];
  /** Whether all required case docs are present */
  allRequiredPresent: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Resolve the output directory for saving case docs.
 *
 * @param options - Save options
 * @returns Absolute path to the output directory
 */
export function resolveCasesDir(options: SaveCasesOptions = {}): string {
  const projectRoot = options.projectRoot ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const subdir = options.outputSubdir ?? DEFAULT_CASES_DIR;
  return path.resolve(projectRoot, subdir);
}

/**
 * List existing case files in the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of filenames (e.g., ['macos-m1.md', 'ubuntu-22.md'])
 */
export function listExistingCases(outputDir: string): string[] {
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
 * Check which required case docs are missing from the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of missing required filenames
 */
export function checkMissingCases(outputDir: string): string[] {
  const existing = listExistingCases(outputDir);
  return REQUIRED_CASES.filter((req) => !existing.includes(req));
}

/**
 * Save OpenClaw case documentation to the knowledge base directory.
 *
 * Orchestrates the scraper to fetch case pages and save them
 * to knowledge-base/openclaw/cases/. Returns a detailed result including
 * which files were saved and whether all required docs are present.
 *
 * @param options - Save options
 * @returns Detailed result of the save operation
 */
export async function saveOpenClawCases(
  options: SaveCasesOptions = {},
): Promise<SaveCasesResult> {
  const outputDir = resolveCasesDir(options);
  const pages = options.pages ?? DEFAULT_CASE_PAGES;
  const fetchOptions = options.fetchOptions ?? {};

  const scrapeSummary = await scrapeOpenClawDocs(outputDir, pages, fetchOptions);

  const savedFiles = listExistingCases(outputDir);
  const missingRequired = checkMissingCases(outputDir);

  return {
    scrapeSummary,
    outputDir,
    savedFiles,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
  };
}
