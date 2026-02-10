import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(import.meta.dirname, '..');
const AGENT_DIR = join(ROOT_DIR, 'packages', 'agent');
const PACKAGE_JSON_PATH = join(AGENT_DIR, 'package.json');
const TSCONFIG_PATH = join(AGENT_DIR, 'tsconfig.json');
const INDEX_PATH = join(AGENT_DIR, 'src', 'index.ts');

function readJSON(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('packages/agent/package.json', () => {
  const pkg = readJSON(PACKAGE_JSON_PATH) as Record<string, unknown>;

  describe('Basic fields', () => {
    it('should have correct name', () => {
      expect(pkg.name).toBe('@aiinstaller/agent');
    });

    it('should have version 0.1.0', () => {
      expect(pkg.version).toBe('0.1.0');
    });

    it('should be private', () => {
      expect(pkg.private).toBe(true);
    });

    it('should use ESM (type: module)', () => {
      expect(pkg.type).toBe('module');
    });

    it('should have a description', () => {
      expect(typeof pkg.description).toBe('string');
      expect((pkg.description as string).length).toBeGreaterThan(0);
    });
  });

  describe('Entry points', () => {
    it('should have main pointing to dist/index.js', () => {
      expect(pkg.main).toBe('dist/index.js');
    });

    it('should have types pointing to dist/index.d.ts', () => {
      expect(pkg.types).toBe('dist/index.d.ts');
    });

    it('should have exports with import and types', () => {
      const exports = pkg.exports as Record<string, Record<string, string>>;
      expect(exports['.']).toBeDefined();
      expect(exports['.'].import).toBe('./dist/index.js');
      expect(exports['.'].types).toBe('./dist/index.d.ts');
    });
  });

  describe('Scripts', () => {
    const scripts = () => pkg.scripts as Record<string, string>;

    it('should have build script using tsc', () => {
      expect(scripts().build).toBe('tsc');
    });

    it('should have dev script using tsc --watch', () => {
      expect(scripts().dev).toBe('tsc --watch');
    });

    it('should have start script', () => {
      expect(scripts().start).toBe('node dist/index.js');
    });

    it('should have test script', () => {
      expect(scripts().test).toBe('vitest run');
    });

    it('should have typecheck script', () => {
      expect(scripts().typecheck).toBe('tsc --noEmit');
    });

    it('should have clean script', () => {
      expect(scripts().clean).toBe('rm -rf dist');
    });
  });

  describe('Dependencies', () => {
    const deps = () => pkg.dependencies as Record<string, string>;

    it('should depend on @aiinstaller/shared via workspace', () => {
      expect(deps()['@aiinstaller/shared']).toBe('workspace:*');
    });

    it('should depend on ws for WebSocket client', () => {
      expect(deps().ws).toBeDefined();
      expect(deps().ws).toMatch(/^\^8/);
    });

    it('should depend on @clack/prompts for interactive prompts', () => {
      expect(deps()['@clack/prompts']).toBeDefined();
    });

    it('should depend on chalk for color output', () => {
      expect(deps().chalk).toBeDefined();
      expect(deps().chalk).toMatch(/^\^5/);
    });
  });

  describe('DevDependencies', () => {
    const devDeps = () => pkg.devDependencies as Record<string, string>;

    it('should have typescript as devDependency', () => {
      expect(devDeps().typescript).toBeDefined();
      expect(devDeps().typescript).toMatch(/^\^5/);
    });

    it('should have vitest as devDependency', () => {
      expect(devDeps().vitest).toBeDefined();
      expect(devDeps().vitest).toMatch(/^\^3/);
    });

    it('should have @types/ws as devDependency', () => {
      expect(devDeps()['@types/ws']).toBeDefined();
      expect(devDeps()['@types/ws']).toMatch(/^\^8/);
    });
  });

  describe('Engine requirements', () => {
    it('should require Node.js >= 22.0.0', () => {
      const engines = pkg.engines as Record<string, string>;
      expect(engines.node).toBe('>=22.0.0');
    });
  });
});

describe('packages/agent/tsconfig.json', () => {
  const tsconfig = readJSON(TSCONFIG_PATH) as Record<string, unknown>;

  it('should exist and be valid JSON', () => {
    expect(tsconfig).toBeDefined();
  });

  it('should extend root tsconfig', () => {
    expect(tsconfig.extends).toBe('../../tsconfig.json');
  });

  it('should have outDir set to dist', () => {
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;
    expect(compilerOptions.outDir).toBe('dist');
  });

  it('should have rootDir set to src', () => {
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;
    expect(compilerOptions.rootDir).toBe('src');
  });

  it('should include src/**/*.ts', () => {
    const include = tsconfig.include as string[];
    expect(include).toContain('src/**/*.ts');
  });

  it('should exclude node_modules, dist, and test files', () => {
    const exclude = tsconfig.exclude as string[];
    expect(exclude).toContain('node_modules');
    expect(exclude).toContain('dist');
    expect(exclude).toContain('**/*.test.ts');
  });

  it('should reference an existing root tsconfig', () => {
    const rootTsconfigPath = join(ROOT_DIR, 'tsconfig.json');
    expect(existsSync(rootTsconfigPath)).toBe(true);
  });
});

describe('packages/agent directory structure', () => {
  it('should have src/ directory', () => {
    expect(existsSync(join(AGENT_DIR, 'src'))).toBe(true);
    expect(statSync(join(AGENT_DIR, 'src')).isDirectory()).toBe(true);
  });

  it('should have src/index.ts entry file', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
  });

  it('should have src/detect/ directory', () => {
    expect(existsSync(join(AGENT_DIR, 'src', 'detect'))).toBe(true);
  });

  it('should have src/execute/ directory', () => {
    expect(existsSync(join(AGENT_DIR, 'src', 'execute'))).toBe(true);
  });

  it('should have src/ui/ directory', () => {
    expect(existsSync(join(AGENT_DIR, 'src', 'ui'))).toBe(true);
  });
});

describe('Workspace integration', () => {
  it('should be included in pnpm-workspace.yaml', () => {
    const workspaceContent = readFileSync(
      join(ROOT_DIR, 'pnpm-workspace.yaml'),
      'utf-8'
    );
    expect(workspaceContent).toContain('packages/*');
  });

  it('should be referenced in root tsconfig paths', () => {
    const rootTsconfig = readJSON(join(ROOT_DIR, 'tsconfig.json')) as Record<string, unknown>;
    const compilerOptions = rootTsconfig.compilerOptions as Record<string, unknown>;
    const paths = compilerOptions.paths as Record<string, string[]>;
    expect(paths['@aiinstaller/agent']).toBeDefined();
    expect(paths['@aiinstaller/agent']).toContain('packages/agent/src');
  });

  it('should have root package.json scripts referencing agent', () => {
    const rootPkg = readJSON(join(ROOT_DIR, 'package.json')) as Record<string, unknown>;
    const scripts = rootPkg.scripts as Record<string, string>;
    expect(scripts['dev:agent']).toContain('@aiinstaller/agent');
    expect(scripts['build:agent']).toContain('@aiinstaller/agent');
  });

  it('should have vitest config alias for @aiinstaller/agent', () => {
    const vitestConfig = readFileSync(join(ROOT_DIR, 'vitest.config.ts'), 'utf-8');
    expect(vitestConfig).toContain('@aiinstaller/agent');
  });
});

describe('Consistency with shared and server packages', () => {
  const agentPkg = readJSON(PACKAGE_JSON_PATH) as Record<string, unknown>;
  const sharedPkg = readJSON(join(ROOT_DIR, 'packages', 'shared', 'package.json')) as Record<string, unknown>;
  const serverPkg = readJSON(join(ROOT_DIR, 'packages', 'server', 'package.json')) as Record<string, unknown>;

  it('should use same TypeScript version range as shared package', () => {
    const agentDevDeps = agentPkg.devDependencies as Record<string, string>;
    const sharedDevDeps = sharedPkg.devDependencies as Record<string, string>;
    expect(agentDevDeps.typescript).toBe(sharedDevDeps.typescript);
  });

  it('should use same Vitest version range as shared package', () => {
    const agentDevDeps = agentPkg.devDependencies as Record<string, string>;
    const sharedDevDeps = sharedPkg.devDependencies as Record<string, string>;
    expect(agentDevDeps.vitest).toBe(sharedDevDeps.vitest);
  });

  it('should use same Node.js engine requirement', () => {
    const agentEngines = agentPkg.engines as Record<string, string>;
    const sharedEngines = sharedPkg.engines as Record<string, string>;
    expect(agentEngines.node).toBe(sharedEngines.node);
  });

  it('should use same ESM module type', () => {
    expect(agentPkg.type).toBe(sharedPkg.type);
    expect(agentPkg.type).toBe(serverPkg.type);
  });

  it('should use same ws version range as server package', () => {
    const agentDeps = agentPkg.dependencies as Record<string, string>;
    const serverDeps = serverPkg.dependencies as Record<string, string>;
    expect(agentDeps.ws).toBe(serverDeps.ws);
  });

  it('should use same @types/ws version range as server package', () => {
    const agentDevDeps = agentPkg.devDependencies as Record<string, string>;
    const serverDevDeps = serverPkg.devDependencies as Record<string, string>;
    expect(agentDevDeps['@types/ws']).toBe(serverDevDeps['@types/ws']);
  });
});

describe('src/index.ts entry file', () => {
  const indexContent = readFileSync(INDEX_PATH, 'utf-8');

  it('should export AGENT_NAME constant', () => {
    expect(indexContent).toContain('AGENT_NAME');
    expect(indexContent).toContain('@aiinstaller/agent');
  });

  it('should export AGENT_VERSION constant', () => {
    expect(indexContent).toContain('AGENT_VERSION');
    expect(indexContent).toContain('0.1.0');
  });

  it('should have JSDoc documentation', () => {
    expect(indexContent).toContain('/**');
  });
});
