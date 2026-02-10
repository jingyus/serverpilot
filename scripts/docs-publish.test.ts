/**
 * Tests for Documentation Publishing Module.
 *
 * Validates:
 * - Constants (required/optional docs, required sections)
 * - File inventory building
 * - Section extraction
 * - Documentation validation
 * - README validation
 * - Deployment docs validation
 * - Publish dry-run
 * - Summary generation
 * - Type exports
 * - Integration with project structure
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUIRED_DOCS,
  OPTIONAL_DOCS,
  README_REQUIRED_SECTIONS,
  DEPLOY_DOC_REQUIRED_SECTIONS,
  buildDocInventory,
  extractSections,
  validateDocInventory,
  validateReadme,
  validateDeploymentDocs,
  runAllValidations,
  publishDocs,
  generateDocsSummary,
} from './docs-publish';
import type {
  DocFile,
  DocValidation,
  DocPublishResult,
} from './docs-publish';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('REQUIRED_DOCS', () => {
  it('should include README.md', () => {
    expect(REQUIRED_DOCS.some((d) => d.path === 'README.md')).toBe(true);
  });

  it('should include deployment guide', () => {
    expect(REQUIRED_DOCS.some((d) => d.path === 'docs/deployment.md')).toBe(true);
  });

  it('should include development guide', () => {
    expect(REQUIRED_DOCS.some((d) => d.path.includes('开发指南'))).toBe(true);
  });

  it('each entry should have path and name', () => {
    for (const doc of REQUIRED_DOCS) {
      expect(doc.path.length).toBeGreaterThan(0);
      expect(doc.name.length).toBeGreaterThan(0);
    }
  });
});

describe('OPTIONAL_DOCS', () => {
  it('should have at least 2 entries', () => {
    expect(OPTIONAL_DOCS.length).toBeGreaterThanOrEqual(2);
  });

  it('each entry should have path and name', () => {
    for (const doc of OPTIONAL_DOCS) {
      expect(doc.path.length).toBeGreaterThan(0);
      expect(doc.name.length).toBeGreaterThan(0);
    }
  });

  it('should not overlap with REQUIRED_DOCS', () => {
    const requiredPaths = new Set(REQUIRED_DOCS.map((d) => d.path));
    for (const doc of OPTIONAL_DOCS) {
      expect(requiredPaths.has(doc.path)).toBe(false);
    }
  });
});

describe('README_REQUIRED_SECTIONS', () => {
  it('should have at least 2 sections', () => {
    expect(README_REQUIRED_SECTIONS.length).toBeGreaterThanOrEqual(2);
  });

  it('should include ServerPilot', () => {
    expect(README_REQUIRED_SECTIONS.some((s) => s.includes('ServerPilot'))).toBe(true);
  });
});

describe('DEPLOY_DOC_REQUIRED_SECTIONS', () => {
  it('should have at least 3 sections', () => {
    expect(DEPLOY_DOC_REQUIRED_SECTIONS.length).toBeGreaterThanOrEqual(3);
  });

  it('should include deployment-related sections', () => {
    expect(DEPLOY_DOC_REQUIRED_SECTIONS.some((s) => s.includes('部署'))).toBe(true);
    expect(DEPLOY_DOC_REQUIRED_SECTIONS.some((s) => s.includes('环境变量'))).toBe(true);
  });
});

// ============================================================================
// buildDocInventory
// ============================================================================

describe('buildDocInventory()', () => {
  it('should return required and optional docs', () => {
    const inventory = buildDocInventory();
    expect(inventory.length).toBe(REQUIRED_DOCS.length + OPTIONAL_DOCS.length);
  });

  it('required docs should be marked as required', () => {
    const inventory = buildDocInventory();
    const required = inventory.filter((d) => d.required);
    expect(required.length).toBe(REQUIRED_DOCS.length);
  });

  it('optional docs should not be marked as required', () => {
    const inventory = buildDocInventory();
    const optional = inventory.filter((d) => !d.required);
    expect(optional.length).toBe(OPTIONAL_DOCS.length);
  });

  it('README.md should exist', () => {
    const inventory = buildDocInventory();
    const readme = inventory.find((d) => d.path === 'README.md');
    expect(readme).toBeDefined();
    expect(readme!.exists).toBe(true);
  });

  it('deployment.md should exist', () => {
    const inventory = buildDocInventory();
    const deploy = inventory.find((d) => d.path === 'docs/deployment.md');
    expect(deploy).toBeDefined();
    expect(deploy!.exists).toBe(true);
  });

  it('existing files should have size', () => {
    const inventory = buildDocInventory();
    for (const doc of inventory) {
      if (doc.exists) {
        expect(doc.size).toBeDefined();
        expect(doc.size!).toBeGreaterThan(0);
      }
    }
  });

  it('required existing files should have sections', () => {
    const inventory = buildDocInventory();
    for (const doc of inventory) {
      if (doc.required && doc.exists) {
        expect(doc.sections).toBeDefined();
        expect(doc.sections!.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// extractSections
// ============================================================================

describe('extractSections()', () => {
  it('should extract headings from README.md', () => {
    const sections = extractSections(path.join(ROOT_DIR, 'README.md'));
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should extract headings from deployment.md', () => {
    const sections = extractSections(path.join(ROOT_DIR, 'docs/deployment.md'));
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should return empty array for nonexistent file', () => {
    const sections = extractSections('/tmp/nonexistent-file-xyz-123.md');
    expect(sections).toEqual([]);
  });

  it('should extract both h1 and h2 headings', () => {
    const sections = extractSections(path.join(ROOT_DIR, 'docs/deployment.md'));
    // deployment.md should have multiple heading levels
    expect(sections.length).toBeGreaterThan(3);
  });
});

// ============================================================================
// validateDocInventory
// ============================================================================

describe('validateDocInventory()', () => {
  it('should validate required docs', () => {
    const inventory = buildDocInventory();
    const validations = validateDocInventory(inventory);
    expect(validations.length).toBe(REQUIRED_DOCS.length);
  });

  it('README.md validation should pass', () => {
    const inventory = buildDocInventory();
    const validations = validateDocInventory(inventory);
    const readme = validations.find((v) => v.name === 'Project README');
    expect(readme).toBeDefined();
    expect(readme!.passed).toBe(true);
  });

  it('deployment.md validation should pass', () => {
    const inventory = buildDocInventory();
    const validations = validateDocInventory(inventory);
    const deploy = validations.find((v) => v.name === 'Deployment Guide');
    expect(deploy).toBeDefined();
    expect(deploy!.passed).toBe(true);
  });

  it('each validation should have name, passed, and message', () => {
    const inventory = buildDocInventory();
    const validations = validateDocInventory(inventory);
    for (const v of validations) {
      expect(typeof v.name).toBe('string');
      expect(typeof v.passed).toBe('boolean');
      expect(typeof v.message).toBe('string');
    }
  });
});

// ============================================================================
// validateReadme
// ============================================================================

describe('validateReadme()', () => {
  it('should return validations for required sections', () => {
    const validations = validateReadme();
    // sections + length check
    expect(validations.length).toBeGreaterThanOrEqual(README_REQUIRED_SECTIONS.length);
  });

  it('should check README length', () => {
    const validations = validateReadme();
    const lengthCheck = validations.find((v) => v.name === 'README length');
    expect(lengthCheck).toBeDefined();
    expect(lengthCheck!.passed).toBe(true);
  });

  it('ServerPilot section should be found', () => {
    const validations = validateReadme();
    const section = validations.find((v) => v.name.includes('ServerPilot'));
    expect(section).toBeDefined();
    expect(section!.passed).toBe(true);
  });
});

// ============================================================================
// validateDeploymentDocs
// ============================================================================

describe('validateDeploymentDocs()', () => {
  it('should return validations for required sections', () => {
    const validations = validateDeploymentDocs();
    expect(validations.length).toBeGreaterThan(0);
  });

  it('should check for fly deploy', () => {
    const validations = validateDeploymentDocs();
    const flyDeploy = validations.find((v) => v.name.includes('fly deploy'));
    expect(flyDeploy).toBeDefined();
    expect(flyDeploy!.passed).toBe(true);
  });

  it('required sections should be found', () => {
    const validations = validateDeploymentDocs();
    for (const section of DEPLOY_DOC_REQUIRED_SECTIONS) {
      const check = validations.find((v) => v.name.includes(section));
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    }
  });
});

// ============================================================================
// runAllValidations
// ============================================================================

describe('runAllValidations()', () => {
  it('should return combined validations', () => {
    const validations = runAllValidations();
    expect(validations.length).toBeGreaterThan(5);
  });

  it('should include inventory, readme, and deploy validations', () => {
    const validations = runAllValidations();
    const names = validations.map((v) => v.name);
    expect(names.some((n) => n.includes('README'))).toBe(true);
    expect(names.some((n) => n.includes('Deploy') || n.includes('Deployment'))).toBe(true);
  });

  it('all validations should have proper structure', () => {
    const validations = runAllValidations();
    for (const v of validations) {
      expect(typeof v.name).toBe('string');
      expect(typeof v.passed).toBe('boolean');
      expect(typeof v.message).toBe('string');
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.message.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// publishDocs (dry-run)
// ============================================================================

describe('publishDocs() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = publishDocs(true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should include inventory', () => {
    const result = publishDocs(true);
    expect(result.inventory.length).toBeGreaterThan(0);
  });

  it('should include validations', () => {
    const result = publishDocs(true);
    expect(result.validations.length).toBeGreaterThan(0);
  });

  it('message should mention dry-run', () => {
    const result = publishDocs(true);
    expect(result.message).toContain('dry-run');
  });
});

describe('publishDocs() real', () => {
  it('should return a valid result', () => {
    const result = publishDocs(false);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('inventory');
    expect(result).toHaveProperty('validations');
  });

  it('should include all inventory items', () => {
    const result = publishDocs(false);
    expect(result.inventory.length).toBe(REQUIRED_DOCS.length + OPTIONAL_DOCS.length);
  });

  it('if successful, action should be validated', () => {
    const result = publishDocs(false);
    if (result.success) {
      expect(result.action).toBe('validated');
    }
  });

  it('if failed, should mention what needs fixing', () => {
    const result = publishDocs(false);
    if (!result.success) {
      expect(result.message).toContain('issue');
    }
  });
});

// ============================================================================
// generateDocsSummary
// ============================================================================

describe('generateDocsSummary()', () => {
  it('should return a markdown string', () => {
    const summary = generateDocsSummary();
    expect(summary).toContain('# Documentation Status');
  });

  it('should include required documents section', () => {
    const summary = generateDocsSummary();
    expect(summary).toContain('Required Documents');
  });

  it('should include optional documents section', () => {
    const summary = generateDocsSummary();
    expect(summary).toContain('Optional Documents');
  });

  it('should mention README.md', () => {
    const summary = generateDocsSummary();
    expect(summary).toContain('README.md');
  });

  it('should include generation timestamp', () => {
    const summary = generateDocsSummary();
    expect(summary).toContain('Generated:');
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('DocFile type should be usable', () => {
    const doc: DocFile = {
      path: 'README.md',
      name: 'README',
      required: true,
      exists: true,
      size: 1000,
      sections: ['intro', 'install'],
    };
    expect(doc.required).toBe(true);
    expect(doc.sections).toHaveLength(2);
  });

  it('DocValidation type should be usable', () => {
    const validation: DocValidation = {
      name: 'test',
      passed: true,
      message: 'ok',
    };
    expect(validation.passed).toBe(true);
  });

  it('DocPublishResult type should be usable', () => {
    const result: DocPublishResult = {
      success: true,
      action: 'validated',
      message: 'done',
      inventory: [],
      validations: [],
    };
    expect(result.action).toBe('validated');
  });

  it('DocPublishResult action should cover all values', () => {
    const actions: DocPublishResult['action'][] = ['published', 'validated', 'skipped', 'dry-run'];
    expect(actions).toHaveLength(4);
  });
});

// ============================================================================
// Integration
// ============================================================================

describe('Integration: project structure', () => {
  it('all REQUIRED_DOCS should exist', () => {
    for (const doc of REQUIRED_DOCS) {
      const exists = fs.existsSync(path.join(ROOT_DIR, doc.path));
      expect(exists, `${doc.path} should exist`).toBe(true);
    }
  });

  it('README.md should have minimum content', () => {
    const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
    expect(readme.length).toBeGreaterThan(500);
  });

  it('deployment.md should reference all deployment methods', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('Docker');
    expect(deployDoc).toContain('Fly.io');
  });
});
