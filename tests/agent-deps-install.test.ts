import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const ROOT = resolve(__dirname, '..');
const AGENT_DIR = resolve(ROOT, 'packages/agent');
const pkg = JSON.parse(readFileSync(resolve(AGENT_DIR, 'package.json'), 'utf-8'));

// Create a require function that resolves from packages/agent context
const agentRequire = createRequire(resolve(AGENT_DIR, 'package.json'));

describe('Agent dependencies - package.json declarations', () => {
  it('should have ws in dependencies', () => {
    expect(pkg.dependencies.ws).toBeDefined();
  });

  it('should have @clack/prompts in dependencies', () => {
    expect(pkg.dependencies['@clack/prompts']).toBeDefined();
  });

  it('should have chalk in dependencies', () => {
    expect(pkg.dependencies.chalk).toBeDefined();
  });

  it('should have osc-progress in dependencies', () => {
    expect(pkg.dependencies['osc-progress']).toBeDefined();
  });

  it('should have @aiinstaller/shared as workspace dependency', () => {
    expect(pkg.dependencies['@aiinstaller/shared']).toBe('workspace:*');
  });

  it('should have @types/ws in devDependencies', () => {
    expect(pkg.devDependencies['@types/ws']).toBeDefined();
  });

  it('should have typescript in devDependencies', () => {
    expect(pkg.devDependencies.typescript).toBeDefined();
  });

  it('should have vitest in devDependencies', () => {
    expect(pkg.devDependencies.vitest).toBeDefined();
  });

  it('should NOT have ws in devDependencies (should be in dependencies)', () => {
    expect(pkg.devDependencies.ws).toBeUndefined();
  });

  it('should NOT have chalk in devDependencies (should be in dependencies)', () => {
    expect(pkg.devDependencies.chalk).toBeUndefined();
  });

  it('should NOT have osc-progress in devDependencies (should be in dependencies)', () => {
    expect(pkg.devDependencies['osc-progress']).toBeUndefined();
  });
});

describe('Agent dependencies - Installation verification', () => {
  const nodeModules = resolve(AGENT_DIR, 'node_modules');

  it('should have node_modules directory', () => {
    expect(existsSync(nodeModules)).toBe(true);
  });

  it('should have ws installed', () => {
    expect(existsSync(resolve(nodeModules, 'ws'))).toBe(true);
  });

  it('should have @clack/prompts installed', () => {
    expect(existsSync(resolve(nodeModules, '@clack/prompts'))).toBe(true);
  });

  it('should have chalk installed', () => {
    expect(existsSync(resolve(nodeModules, 'chalk'))).toBe(true);
  });

  it('should have osc-progress installed', () => {
    expect(existsSync(resolve(nodeModules, 'osc-progress'))).toBe(true);
  });

  it('should have @types/ws installed', () => {
    expect(existsSync(resolve(nodeModules, '@types/ws'))).toBe(true);
  });

  it('should have @aiinstaller/shared linked from workspace', () => {
    expect(existsSync(resolve(nodeModules, '@aiinstaller/shared'))).toBe(true);
  });
});

describe('Agent dependencies - Version verification', () => {
  it('should have ws version matching ^8.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(AGENT_DIR, 'node_modules/ws/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('ws');
    expect(depPkg.version).toMatch(/^8\./);
  });

  it('should have @clack/prompts version matching ^0.x', () => {
    const depPkg = JSON.parse(
      readFileSync(
        resolve(AGENT_DIR, 'node_modules/@clack/prompts/package.json'),
        'utf-8',
      ),
    );
    expect(depPkg.name).toBe('@clack/prompts');
    expect(depPkg.version).toMatch(/^0\./);
  });

  it('should have chalk version matching ^5.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(AGENT_DIR, 'node_modules/chalk/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('chalk');
    expect(depPkg.version).toMatch(/^5\./);
  });

  it('should have osc-progress version matching ^0.3.x', () => {
    const depPkg = JSON.parse(
      readFileSync(
        resolve(AGENT_DIR, 'node_modules/osc-progress/package.json'),
        'utf-8',
      ),
    );
    expect(depPkg.name).toBe('osc-progress');
    expect(depPkg.version).toMatch(/^0\.3\./);
  });
});

describe('Agent dependencies - Module resolvability', () => {
  it('should resolve ws', () => {
    const resolved = agentRequire.resolve('ws');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve chalk', () => {
    const resolved = agentRequire.resolve('chalk');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve osc-progress entry point', () => {
    // osc-progress is ESM-only with exports.import only, so createRequire.resolve fails
    // Verify the main entry file exists directly
    const entryPath = resolve(AGENT_DIR, 'node_modules/osc-progress/dist/esm/index.js');
    expect(existsSync(entryPath)).toBe(true);
  });

  it('should resolve @clack/prompts', () => {
    const resolved = agentRequire.resolve('@clack/prompts');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });
});

describe('Agent dependencies - Module importability', () => {
  it('should import ws', async () => {
    const ws = await import(agentRequire.resolve('ws'));
    expect(ws).toBeDefined();
  });

  it('should have WebSocket class from ws', async () => {
    const ws = await import(agentRequire.resolve('ws'));
    const WS = ws.default || ws.WebSocket;
    expect(WS).toBeDefined();
    expect(typeof WS).toBe('function');
  });

  it('should import chalk', async () => {
    const chalk = await import(agentRequire.resolve('chalk'));
    expect(chalk).toBeDefined();
  });

  it('should have chalk default export with color functions', async () => {
    const chalkModule = await import(agentRequire.resolve('chalk'));
    const chalk = chalkModule.default || chalkModule;
    expect(chalk).toBeDefined();
    expect(typeof chalk.red).toBe('function');
    expect(typeof chalk.green).toBe('function');
    expect(typeof chalk.blue).toBe('function');
    expect(typeof chalk.bold).toBe('function');
  });

  it('should import osc-progress', async () => {
    const oscPath = resolve(AGENT_DIR, 'node_modules/osc-progress/dist/esm/index.js');
    const osc = await import(oscPath);
    expect(osc).toBeDefined();
  });

  it('should have core exports from osc-progress', async () => {
    const oscPath = resolve(AGENT_DIR, 'node_modules/osc-progress/dist/esm/index.js');
    const osc = await import(oscPath);
    expect(typeof osc.createOscProgressController).toBe('function');
    expect(typeof osc.supportsOscProgress).toBe('function');
  });

  it('should have additional exports from osc-progress', async () => {
    const oscPath = resolve(AGENT_DIR, 'node_modules/osc-progress/dist/esm/index.js');
    const osc = await import(oscPath);
    expect(typeof osc.startOscProgress).toBe('function');
    expect(typeof osc.stripOscProgress).toBe('function');
    expect(typeof osc.sanitizeOscProgress).toBe('function');
  });

  it('should import @clack/prompts', async () => {
    const clack = await import(agentRequire.resolve('@clack/prompts'));
    expect(clack).toBeDefined();
  });

  it('should have core prompt functions from @clack/prompts', async () => {
    const clack = await import(agentRequire.resolve('@clack/prompts'));
    expect(typeof clack.intro).toBe('function');
    expect(typeof clack.outro).toBe('function');
    expect(typeof clack.text).toBe('function');
    expect(typeof clack.confirm).toBe('function');
    expect(typeof clack.select).toBe('function');
    expect(typeof clack.spinner).toBe('function');
  });
});

describe('Agent dependencies - Functional verification', () => {
  it('should create chalk colored output', async () => {
    const chalkModule = await import(agentRequire.resolve('chalk'));
    const chalk = chalkModule.default || chalkModule;
    const result = chalk.red('error');
    expect(typeof result).toBe('string');
    expect(result).toContain('error');
  });

  it('should create a @clack/prompts spinner instance', async () => {
    const clack = await import(agentRequire.resolve('@clack/prompts'));
    const s = clack.spinner();
    expect(s).toBeDefined();
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
  });

  it('should check osc-progress support (function callable)', async () => {
    const oscPath = resolve(AGENT_DIR, 'node_modules/osc-progress/dist/esm/index.js');
    const osc = await import(oscPath);
    // supportsOscProgress checks terminal capabilities, may return true or false
    const result = osc.supportsOscProgress();
    expect(typeof result).toBe('boolean');
  });

  it('should have WebSocket ready for client use', async () => {
    const ws = await import(agentRequire.resolve('ws'));
    const WS = ws.default || ws.WebSocket;
    expect(typeof WS).toBe('function');
    // Should support standard WebSocket events
    expect(WS.prototype).toBeDefined();
  });
});

describe('Agent dependencies - Workspace integration', () => {
  it('should have @aiinstaller/shared linked in node_modules', () => {
    const sharedDir = resolve(AGENT_DIR, 'node_modules/@aiinstaller/shared');
    expect(existsSync(sharedDir)).toBe(true);
  });

  it('should have @aiinstaller/shared package.json with correct name', () => {
    const sharedPkg = JSON.parse(
      readFileSync(
        resolve(AGENT_DIR, 'node_modules/@aiinstaller/shared/package.json'),
        'utf-8',
      ),
    );
    expect(sharedPkg.name).toBe('@aiinstaller/shared');
  });

  it('should have @aiinstaller/shared source files available via workspace link', () => {
    const sharedSrc = resolve(AGENT_DIR, 'node_modules/@aiinstaller/shared/src/index.ts');
    expect(existsSync(sharedSrc)).toBe(true);
  });
});
