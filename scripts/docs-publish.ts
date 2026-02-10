/**
 * Documentation Publishing Module
 *
 * Manages documentation publishing workflow:
 * - Validates documentation completeness
 * - Generates user guide content
 * - Validates README quality
 * - Prepares docs for publishing
 *
 * Features:
 * - Check documentation file inventory
 * - Validate required sections in README
 * - Validate deployment docs completeness
 * - Generate documentation status report
 *
 * Usage: npx tsx scripts/docs-publish.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export interface DocFile {
  path: string;
  name: string;
  required: boolean;
  exists: boolean;
  size?: number;
  sections?: string[];
}

export interface DocValidation {
  name: string;
  passed: boolean;
  message: string;
}

export interface DocPublishResult {
  success: boolean;
  action: 'published' | 'validated' | 'skipped' | 'dry-run';
  message: string;
  inventory: DocFile[];
  validations: DocValidation[];
}

// ============================================================================
// Constants
// ============================================================================

/** Required documentation files */
export const REQUIRED_DOCS: { path: string; name: string }[] = [
  { path: 'README.md', name: 'Project README' },
  { path: 'docs/deployment.md', name: 'Deployment Guide' },
  { path: 'docs/开发指南.md', name: 'Development Guide' },
];

/** Optional documentation files */
export const OPTIONAL_DOCS: { path: string; name: string }[] = [
  { path: 'docs/开发标准.md', name: 'Development Standards' },
  { path: '需求文档.md', name: 'Requirements Document' },
  { path: '项目清单.md', name: 'Project Checklist' },
  { path: 'PROMPT.md', name: 'AI Agent Prompt' },
];

/** Required sections in README.md */
export const README_REQUIRED_SECTIONS = [
  'ServerPilot',
  '项目架构',
  '代码结构',
];

/** Required sections in deployment.md */
export const DEPLOY_DOC_REQUIRED_SECTIONS = [
  '环境要求',
  '高级部署',
  '环境变量',
  '监控',
];

// ============================================================================
// File Inventory
// ============================================================================

/**
 * Build the documentation file inventory.
 */
export function buildDocInventory(): DocFile[] {
  const docs: DocFile[] = [];

  for (const doc of REQUIRED_DOCS) {
    const fullPath = path.join(ROOT_DIR, doc.path);
    const exists = fs.existsSync(fullPath);

    docs.push({
      path: doc.path,
      name: doc.name,
      required: true,
      exists,
      size: exists ? fs.statSync(fullPath).size : undefined,
      sections: exists ? extractSections(fullPath) : undefined,
    });
  }

  for (const doc of OPTIONAL_DOCS) {
    const fullPath = path.join(ROOT_DIR, doc.path);
    const exists = fs.existsSync(fullPath);

    docs.push({
      path: doc.path,
      name: doc.name,
      required: false,
      exists,
      size: exists ? fs.statSync(fullPath).size : undefined,
    });
  }

  return docs;
}

/**
 * Extract markdown section headings from a file.
 */
export function extractSections(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const headings: string[] = [];

  for (const line of content.split('\n')) {
    const match = line.match(/^#{1,3}\s+(.+)/);
    if (match) {
      headings.push(match[1].trim());
    }
  }

  return headings;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that all required documentation files exist.
 */
export function validateDocInventory(inventory: DocFile[]): DocValidation[] {
  const results: DocValidation[] = [];

  const requiredDocs = inventory.filter((d) => d.required);
  for (const doc of requiredDocs) {
    results.push({
      name: doc.name,
      passed: doc.exists,
      message: doc.exists
        ? `${doc.path} exists (${((doc.size || 0) / 1024).toFixed(1)} KB)`
        : `${doc.path} is missing`,
    });
  }

  return results;
}

/**
 * Validate README.md contains required sections.
 */
export function validateReadme(): DocValidation[] {
  const results: DocValidation[] = [];
  const readmePath = path.join(ROOT_DIR, 'README.md');

  if (!fs.existsSync(readmePath)) {
    results.push({
      name: 'README exists',
      passed: false,
      message: 'README.md not found',
    });
    return results;
  }

  const content = fs.readFileSync(readmePath, 'utf-8');

  for (const section of README_REQUIRED_SECTIONS) {
    const found = content.includes(section);
    results.push({
      name: `README: ${section}`,
      passed: found,
      message: found
        ? `Section "${section}" found`
        : `Section "${section}" missing from README.md`,
    });
  }

  // Check minimum length
  const minLength = 500;
  results.push({
    name: 'README length',
    passed: content.length >= minLength,
    message: content.length >= minLength
      ? `README has ${content.length} chars (min: ${minLength})`
      : `README is too short: ${content.length} chars (min: ${minLength})`,
  });

  return results;
}

/**
 * Validate deployment docs contain required sections.
 */
export function validateDeploymentDocs(): DocValidation[] {
  const results: DocValidation[] = [];
  const deployDocPath = path.join(ROOT_DIR, 'docs/deployment.md');

  if (!fs.existsSync(deployDocPath)) {
    results.push({
      name: 'Deployment doc exists',
      passed: false,
      message: 'docs/deployment.md not found',
    });
    return results;
  }

  const content = fs.readFileSync(deployDocPath, 'utf-8');

  for (const section of DEPLOY_DOC_REQUIRED_SECTIONS) {
    const found = content.includes(section);
    results.push({
      name: `Deploy doc: ${section}`,
      passed: found,
      message: found
        ? `Section "${section}" found`
        : `Section "${section}" missing from deployment.md`,
    });
  }

  // Check that fly deploy is mentioned
  results.push({
    name: 'Deploy doc: fly deploy',
    passed: content.includes('fly deploy'),
    message: content.includes('fly deploy')
      ? 'fly deploy command documented'
      : 'fly deploy command not found in deployment docs',
  });

  return results;
}

/**
 * Run all documentation validations.
 */
export function runAllValidations(): DocValidation[] {
  const inventory = buildDocInventory();

  return [
    ...validateDocInventory(inventory),
    ...validateReadme(),
    ...validateDeploymentDocs(),
  ];
}

// ============================================================================
// Publishing
// ============================================================================

/**
 * Prepare and validate documentation for publishing.
 */
export function publishDocs(dryRun = false): DocPublishResult {
  const inventory = buildDocInventory();
  const validations = runAllValidations();
  const failed = validations.filter((v) => !v.passed);

  if (dryRun) {
    return {
      success: true,
      action: 'dry-run',
      message: `[dry-run] Would validate ${inventory.length} docs. ${failed.length} issue(s) found.`,
      inventory,
      validations,
    };
  }

  if (failed.length > 0) {
    return {
      success: false,
      action: 'skipped',
      message: `Documentation validation failed: ${failed.length} issue(s). Fix before publishing.`,
      inventory,
      validations,
    };
  }

  return {
    success: true,
    action: 'validated',
    message: `All ${validations.length} documentation checks passed. Ready to publish.`,
    inventory,
    validations,
  };
}

/**
 * Generate a documentation status summary.
 */
export function generateDocsSummary(): string {
  const inventory = buildDocInventory();
  const lines: string[] = [];

  lines.push('# Documentation Status\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  lines.push('## Required Documents\n');
  for (const doc of inventory.filter((d) => d.required)) {
    const icon = doc.exists ? '✅' : '❌';
    const size = doc.size ? ` (${(doc.size / 1024).toFixed(1)} KB)` : '';
    lines.push(`- ${icon} **${doc.name}** — \`${doc.path}\`${size}`);
  }

  lines.push('\n## Optional Documents\n');
  for (const doc of inventory.filter((d) => !d.required)) {
    const icon = doc.exists ? '✅' : '➖';
    const size = doc.size ? ` (${(doc.size / 1024).toFixed(1)} KB)` : '';
    lines.push(`- ${icon} **${doc.name}** — \`${doc.path}\`${size}`);
  }

  return lines.join('\n');
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Documentation Publishing ===\n');

  const dryRun = process.argv.includes('--dry-run');

  const result = publishDocs(dryRun);

  console.log('Inventory:');
  for (const doc of result.inventory) {
    const icon = doc.exists ? '✅' : (doc.required ? '❌' : '➖');
    const size = doc.size ? ` (${(doc.size / 1024).toFixed(1)} KB)` : '';
    const req = doc.required ? ' [required]' : '';
    console.log(`  ${icon} ${doc.name}${req}${size}`);
  }

  console.log('\nValidations:');
  for (const v of result.validations) {
    const icon = v.passed ? '✅' : '❌';
    console.log(`  ${icon} ${v.name}: ${v.message}`);
  }

  if (result.success) {
    console.log(`\n✅ ${result.message}`);
  } else {
    console.error(`\n❌ ${result.message}`);
    process.exit(1);
  }
}
