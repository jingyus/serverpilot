// SPDX-License-Identifier: AGPL-3.0
/**
 * License compliance tests
 * Validates that all license files exist and are properly referenced
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('License Compliance', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('should have main LICENSE file (AGPL-3.0)', () => {
    const licensePath = path.join(rootDir, 'LICENSE');
    expect(fs.existsSync(licensePath)).toBe(true);

    const content = fs.readFileSync(licensePath, 'utf-8');
    expect(content).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(content).toContain('Version 3');
  });

  it('should have LICENSE-EE file', () => {
    const licensePath = path.join(rootDir, 'LICENSE-EE');
    expect(fs.existsSync(licensePath)).toBe(true);

    const content = fs.readFileSync(licensePath, 'utf-8');
    expect(content).toContain('Enterprise Edition (EE) License');
    expect(content).toContain('ServerPilot Contributors');
  });

  it('should have LICENSING.md strategy file', () => {
    const licensingPath = path.join(rootDir, 'LICENSING.md');
    expect(fs.existsSync(licensingPath)).toBe(true);

    const content = fs.readFileSync(licensingPath, 'utf-8');
    expect(content).toContain('Open Core');
    expect(content).toContain('AGPL-3.0');
    expect(content).toContain('Apache-2.0');
    expect(content).toContain('MIT');
  });

  it('should reference AGPL-3.0 in README.md', () => {
    const readmePath = path.join(rootDir, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf-8');

    expect(content).toContain('AGPL-3.0');
    expect(content).toContain('LICENSING.md');
  });

  it('should have consistent license strategy in EDITION_MATRIX.md', () => {
    const matrixPath = path.join(rootDir, 'EDITION_MATRIX.md');
    const content = fs.readFileSync(matrixPath, 'utf-8');

    // Should NOT mention MIT for CE (was incorrect, now fixed)
    expect(content).not.toContain('CE 版本**：MIT License');

    // Should mention AGPL-3.0 for CE
    expect(content).toContain('AGPL-3.0');
    expect(content).toContain('Commercial License');
  });

  it('should have package-level LICENSE files', () => {
    // Agent should have Apache-2.0
    const agentLicensePath = path.join(rootDir, 'packages/agent/LICENSE');
    if (fs.existsSync(agentLicensePath)) {
      const content = fs.readFileSync(agentLicensePath, 'utf-8');
      expect(content).toContain('Apache License');
    }

    // Shared should have MIT
    const sharedLicensePath = path.join(rootDir, 'packages/shared/LICENSE');
    if (fs.existsSync(sharedLicensePath)) {
      const content = fs.readFileSync(sharedLicensePath, 'utf-8');
      expect(content).toContain('MIT License');
    }
  });

  it('should not have conflicting license claims', () => {
    const licensingPath = path.join(rootDir, 'LICENSING.md');
    const content = fs.readFileSync(licensingPath, 'utf-8');

    // Verify component-to-license mapping is correct
    expect(content).toMatch(/Server.*AGPL-3\.0/);
    expect(content).toMatch(/Agent.*Apache-2\.0/);
    expect(content).toMatch(/Shared.*MIT/);
    expect(content).toMatch(/EE.*Commercial/);
  });

  it('should document EE features that require commercial license', () => {
    const licenseEEPath = path.join(rootDir, 'LICENSE-EE');
    const content = fs.readFileSync(licenseEEPath, 'utf-8');

    const requiredFeatures = [
      'Multi-server management',
      'Team collaboration',
      'Webhook',
      'Alert',
      'Metrics',
      'Audit log export',
      'OAuth',
      'rate limiting',
      'Multi-tenant'
    ];

    for (const feature of requiredFeatures) {
      expect(content.toLowerCase()).toContain(feature.toLowerCase());
    }
  });

  it('should specify subscription requirement for EE', () => {
    const licenseEEPath = path.join(rootDir, 'LICENSE-EE');
    const content = fs.readFileSync(licenseEEPath, 'utf-8');

    expect(content).toContain('subscription');
    expect(content).toContain('serverpilot.io');
  });

  it('should clarify that CE features remain AGPL even in EE', () => {
    const licenseEEPath = path.join(rootDir, 'LICENSE-EE');
    const content = fs.readFileSync(licenseEEPath, 'utf-8');

    expect(content).toContain('Community Edition (CE)');
    expect(content).toContain('AGPL-3.0');
  });
});
