// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base document save module.
 *
 * Orchestrates the scraper to fetch OpenClaw documentation and persist it
 * to the knowledge-base/openclaw/docs/ directory within the project.
 *
 * @module knowledge/save-docs
 */

import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  scrapeOpenClawDocs,
  DEFAULT_DOC_PAGES,
  type DocPage,
  type FetchOptions,
  type ScrapeSummary,
} from './scraper.js';

// ============================================================================
// Constants
// ============================================================================

/** Default output directory relative to the project root */
export const DEFAULT_OUTPUT_DIR = 'knowledge-base/openclaw/docs';

/** Required doc files that must exist after a successful save */
export const REQUIRED_DOCS = [
  'installation.md',
  'prerequisites.md',
  'troubleshooting.md',
  'faq.md',
] as const;

// ============================================================================
// Types
// ============================================================================

/** Options for the saveOpenClawDocs function */
export interface SaveDocsOptions {
  /** Project root directory (defaults to auto-detection) */
  projectRoot?: string;
  /** Custom output subdirectory (defaults to DEFAULT_OUTPUT_DIR) */
  outputSubdir?: string;
  /** Custom pages to scrape (defaults to DEFAULT_DOC_PAGES) */
  pages?: DocPage[];
  /** Fetch options passed through to the scraper */
  fetchOptions?: FetchOptions;
}

/** Result of a save operation */
export interface SaveDocsResult {
  /** The scrape summary from the underlying scraper */
  scrapeSummary: ScrapeSummary;
  /** Absolute path of the output directory */
  outputDir: string;
  /** List of files that were saved */
  savedFiles: string[];
  /** List of required files that are missing */
  missingRequired: string[];
  /** Whether all required docs are present */
  allRequiredPresent: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Detect the project root directory by walking up from a starting directory
 * until we find a package.json with "aiinstaller" in the name.
 *
 * @param startDir - Directory to start searching from
 * @returns The project root path, or null if not found
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const { readFileSync } = require('node:fs');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name && pkg.name.includes('aiinstaller')) {
          return dir;
        }
      } catch {
        // continue searching
      }
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Resolve the output directory for saving docs.
 *
 * @param options - Save options
 * @returns Absolute path to the output directory
 */
export function resolveOutputDir(options: SaveDocsOptions = {}): string {
  const projectRoot = options.projectRoot ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const subdir = options.outputSubdir ?? DEFAULT_OUTPUT_DIR;
  return path.resolve(projectRoot, subdir);
}

/**
 * List existing doc files in the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of filenames (e.g., ['installation.md', 'faq.md'])
 */
export function listExistingDocs(outputDir: string): string[] {
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
 * Check which required docs are missing from the output directory.
 *
 * @param outputDir - Directory to check
 * @returns Array of missing required filenames
 */
export function checkMissingDocs(outputDir: string): string[] {
  const existing = listExistingDocs(outputDir);
  return REQUIRED_DOCS.filter((req) => !existing.includes(req));
}

/**
 * Save OpenClaw documentation to the knowledge base directory.
 *
 * Orchestrates the scraper to fetch documentation pages and save them
 * to knowledge-base/openclaw/docs/. Returns a detailed result including
 * which files were saved and whether all required docs are present.
 *
 * @param options - Save options
 * @returns Detailed result of the save operation
 */
export async function saveOpenClawDocs(
  options: SaveDocsOptions = {},
): Promise<SaveDocsResult> {
  const outputDir = resolveOutputDir(options);
  const pages = options.pages ?? DEFAULT_DOC_PAGES;
  const fetchOptions = options.fetchOptions ?? {};

  const scrapeSummary = await scrapeOpenClawDocs(outputDir, pages, fetchOptions);

  const savedFiles = listExistingDocs(outputDir);
  const missingRequired = checkMissingDocs(outputDir);

  return {
    scrapeSummary,
    outputDir,
    savedFiles,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
  };
}
