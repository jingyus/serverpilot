/**
 * Website Deployment Tests
 *
 * Validates:
 * - GitHub Actions deploy workflow configuration
 * - VitePress config for production (sitemap, meta tags)
 * - CNAME file for custom domain
 * - Website build output structure
 * - Domain configuration
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const projectRoot = join(__dirname, '..');
const websiteRoot = join(projectRoot, 'packages', 'website');

// Skip all website-related tests if website package doesn't exist (Phase 3 in TODO.md)
const websiteExists = existsSync(websiteRoot);

// ============================================================================
// GitHub Actions Deploy Workflow
// ============================================================================

describe('GitHub Actions Deploy Workflow', () => {
  const workflowPath = join(projectRoot, '.github', 'workflows', 'deploy-website.yml');

  it('should have deploy-website.yml workflow file', () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it('should be valid YAML', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed).toBeDefined();
    expect(parsed.name).toBeDefined();
  });

  it('should have workflow name', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.name).toBe('Deploy Website');
  });

  it('should trigger on push to master/main', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.on.push).toBeDefined();
    expect(parsed.on.push.branches).toContain('master');
  });

  it('should trigger on changes to website files', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.on.push.paths).toBeDefined();
    const paths: string[] = parsed.on.push.paths;
    expect(paths.some((p: string) => p.includes('packages/website'))).toBe(true);
  });

  it('should support manual dispatch', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.on.workflow_dispatch).toBeDefined();
  });

  it('should have correct permissions for GitHub Pages', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions.contents).toBe('read');
    expect(parsed.permissions.pages).toBe('write');
    expect(parsed.permissions['id-token']).toBe('write');
  });

  it('should have concurrency control', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.concurrency).toBeDefined();
    expect(parsed.concurrency.group).toBe('pages');
  });

  it('should have build job', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.jobs.build).toBeDefined();
    expect(parsed.jobs.build['runs-on']).toBe('ubuntu-latest');
  });

  it('should have deploy job that depends on build', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.jobs.deploy).toBeDefined();
    expect(parsed.jobs.deploy.needs).toBe('build');
  });

  it('should use actions/checkout', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toMatch(/actions\/checkout@v\d+/);
  });

  it('should use pnpm/action-setup', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('pnpm/action-setup');
  });

  it('should use actions/setup-node', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toMatch(/actions\/setup-node@v\d+/);
  });

  it('should use actions/configure-pages', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('actions/configure-pages');
  });

  it('should use actions/upload-pages-artifact', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('actions/upload-pages-artifact');
  });

  it('should use actions/deploy-pages', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('actions/deploy-pages');
  });

  it('should build the website with pnpm filter', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('pnpm --filter @aiinstaller/website build');
  });

  it('should upload correct dist path', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('packages/website/docs/.vitepress/dist');
  });

  it('should install dependencies with frozen lockfile', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('pnpm install --frozen-lockfile');
  });

  it('should configure deploy environment as github-pages', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed.jobs.deploy.environment.name).toBe('github-pages');
  });
});

// ============================================================================
// CNAME File (Custom Domain)
// ============================================================================

describe.skipIf(!websiteExists)('Custom Domain Configuration', () => {
  const cnamePath = join(websiteRoot, 'docs', 'public', 'CNAME');

  it('should have CNAME file in public directory', () => {
    expect(existsSync(cnamePath)).toBe(true);
  });

  it('should contain correct domain', () => {
    const content = readFileSync(cnamePath, 'utf-8').trim();
    expect(content).toBe('aiinstaller.dev');
  });

  it('should contain only the domain (no protocol)', () => {
    const content = readFileSync(cnamePath, 'utf-8').trim();
    expect(content).not.toContain('http');
    expect(content).not.toContain('://');
  });

  it('should be a single line', () => {
    const content = readFileSync(cnamePath, 'utf-8').trim();
    const lines = content.split('\n').filter((l: string) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
  });
});

// ============================================================================
// VitePress Configuration for Production
// ============================================================================

describe.skipIf(!websiteExists)('VitePress Production Configuration', () => {
  const configPath = join(websiteRoot, 'docs', '.vitepress', 'config.ts');

  it('should have VitePress config file', () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it('should configure sitemap with custom domain', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('sitemap');
    expect(content).toContain('https://aiinstaller.dev');
  });

  it('should have meta tags for SEO', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('og:type');
    expect(content).toContain('og:title');
    expect(content).toContain('og:description');
  });

  it('should have og:url pointing to custom domain', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain("'https://aiinstaller.dev'");
  });

  it('should have favicon configured', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('icon');
    expect(content).toContain('logo.png');
  });

  it('should have proper title and description', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain("title: 'AI Installer'");
    expect(content).toContain('description');
  });

  it('should have navigation configured', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('nav:');
    expect(content).toContain('/download');
    expect(content).toContain('/faq');
    expect(content).toContain('/pricing');
  });

  it('should have sidebar configured', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('sidebar');
    expect(content).toContain('/guide/getting-started');
    expect(content).toContain('/guide/usage');
  });

  it('should have social links', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('socialLinks');
    expect(content).toContain('github');
  });

  it('should have footer', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('footer');
    expect(content).toContain('MIT License');
  });
});

// ============================================================================
// Website Build Output
// ============================================================================

describe.skipIf(!websiteExists)('Website Build Output', () => {
  const distDir = join(websiteRoot, 'docs', '.vitepress', 'dist');

  it('should have dist directory from previous build', () => {
    expect(existsSync(distDir)).toBe(true);
  });

  it('should have index.html', () => {
    expect(existsSync(join(distDir, 'index.html'))).toBe(true);
  });

  it('should have download page', () => {
    expect(existsSync(join(distDir, 'download.html'))).toBe(true);
  });

  it('should have FAQ page', () => {
    expect(existsSync(join(distDir, 'faq.html'))).toBe(true);
  });

  it('should have pricing page', () => {
    expect(existsSync(join(distDir, 'pricing.html'))).toBe(true);
  });

  it('should have guide pages', () => {
    expect(existsSync(join(distDir, 'guide', 'getting-started.html'))).toBe(true);
    expect(existsSync(join(distDir, 'guide', 'usage.html'))).toBe(true);
  });

  it('should have 404 page', () => {
    expect(existsSync(join(distDir, '404.html'))).toBe(true);
  });

  it('should have assets directory', () => {
    expect(existsSync(join(distDir, 'assets'))).toBe(true);
  });

  it('should have CSS files in assets', () => {
    const content = readFileSync(join(distDir, 'index.html'), 'utf-8');
    expect(content).toContain('.css');
  });

  it('should have JS files in assets', () => {
    const content = readFileSync(join(distDir, 'index.html'), 'utf-8');
    expect(content).toContain('.js');
  });
});

// ============================================================================
// Website Package Configuration
// ============================================================================

describe.skipIf(!websiteExists)('Website Package Configuration', () => {
  const pkgJsonPath = join(websiteRoot, 'package.json');

  it('should have package.json', () => {
    expect(existsSync(pkgJsonPath)).toBe(true);
  });

  it('should have build script', () => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.build).toContain('vitepress build');
  });

  it('should have dev script', () => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.dev).toContain('vitepress dev');
  });

  it('should have preview script', () => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    expect(pkg.scripts.preview).toBeDefined();
    expect(pkg.scripts.preview).toContain('vitepress preview');
  });

  it('should have vitepress as dependency', () => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    expect(
      pkg.devDependencies?.vitepress || pkg.dependencies?.vitepress
    ).toBeDefined();
  });
});

// ============================================================================
// CI Workflow Coexistence
// ============================================================================

describe('CI and Deploy Workflows', () => {
  it('should have CI workflow', () => {
    const ciPath = join(projectRoot, '.github', 'workflows', 'ci.yml');
    expect(existsSync(ciPath)).toBe(true);
  });

  it('should have deploy workflow', () => {
    const deployPath = join(projectRoot, '.github', 'workflows', 'deploy-website.yml');
    expect(existsSync(deployPath)).toBe(true);
  });

  it('CI and deploy workflows should have different names', () => {
    const ciContent = readFileSync(
      join(projectRoot, '.github', 'workflows', 'ci.yml'),
      'utf-8'
    );
    const deployContent = readFileSync(
      join(projectRoot, '.github', 'workflows', 'deploy-website.yml'),
      'utf-8'
    );
    const ciParsed = parseYaml(ciContent);
    const deployParsed = parseYaml(deployContent);
    expect(ciParsed.name).not.toBe(deployParsed.name);
  });

  it('deploy workflow should not duplicate test steps from CI', () => {
    const deployContent = readFileSync(
      join(projectRoot, '.github', 'workflows', 'deploy-website.yml'),
      'utf-8'
    );
    // Deploy workflow should build, not run tests (that's CI's job)
    expect(deployContent).not.toContain('pnpm test');
    expect(deployContent).not.toContain('vitest');
  });
});
