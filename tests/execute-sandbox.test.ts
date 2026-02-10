/**
 * Tests for packages/agent/src/execute/sandbox.ts
 *
 * Sandbox module - command whitelist validation, path access control,
 * user confirmation mechanism, and dry-run mode.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WHITELIST,
  Sandbox,
} from '../packages/agent/src/execute/sandbox.js';
import type {
  SandboxConfig,
  ValidationResult,
} from '../packages/agent/src/execute/sandbox.js';
import { ExecResultSchema } from '../packages/shared/src/protocol/types.js';

// ============================================================================
// File Existence
// ============================================================================

describe('execute/sandbox.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/execute/sandbox.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('execute/sandbox.ts - exports', () => {
  it('should export Sandbox class', () => {
    expect(Sandbox).toBeDefined();
    expect(typeof Sandbox).toBe('function');
  });

  it('should export DEFAULT_WHITELIST', () => {
    expect(DEFAULT_WHITELIST).toBeDefined();
    expect(Array.isArray(DEFAULT_WHITELIST)).toBe(true);
    expect(DEFAULT_WHITELIST.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// DEFAULT_WHITELIST
// ============================================================================

describe('DEFAULT_WHITELIST', () => {
  it('should include common package managers', () => {
    expect(DEFAULT_WHITELIST).toContain('npm');
    expect(DEFAULT_WHITELIST).toContain('pnpm');
    expect(DEFAULT_WHITELIST).toContain('yarn');
    expect(DEFAULT_WHITELIST).toContain('bun');
  });

  it('should include system package managers', () => {
    expect(DEFAULT_WHITELIST).toContain('brew');
    expect(DEFAULT_WHITELIST).toContain('apt');
    expect(DEFAULT_WHITELIST).toContain('apt-get');
  });

  it('should include common tools', () => {
    expect(DEFAULT_WHITELIST).toContain('node');
    expect(DEFAULT_WHITELIST).toContain('git');
    expect(DEFAULT_WHITELIST).toContain('curl');
  });

  it('should include verification commands', () => {
    expect(DEFAULT_WHITELIST).toContain('which');
    expect(DEFAULT_WHITELIST).toContain('echo');
    expect(DEFAULT_WHITELIST).toContain('uname');
  });
});

// ============================================================================
// Sandbox - constructor
// ============================================================================

describe('Sandbox - constructor', () => {
  it('should create an instance with default config', () => {
    const sandbox = new Sandbox();
    expect(sandbox).toBeInstanceOf(Sandbox);
  });

  it('should create an instance with custom whitelist', () => {
    const sandbox = new Sandbox({ whitelist: ['node', 'npm'] });
    expect(sandbox).toBeInstanceOf(Sandbox);
    expect(sandbox.getWhitelist()).toEqual(['node', 'npm']);
  });

  it('should create an instance with dry-run enabled', () => {
    const sandbox = new Sandbox({ dryRun: true });
    expect(sandbox.isDryRun()).toBe(true);
  });

  it('should default dry-run to false', () => {
    const sandbox = new Sandbox();
    expect(sandbox.isDryRun()).toBe(false);
  });

  it('should create an instance with allowed paths', () => {
    const sandbox = new Sandbox({ allowedPaths: ['/tmp'] });
    expect(sandbox).toBeInstanceOf(Sandbox);
  });

  it('should use DEFAULT_WHITELIST when no whitelist is provided', () => {
    const sandbox = new Sandbox();
    const whitelist = sandbox.getWhitelist();
    for (const cmd of DEFAULT_WHITELIST) {
      expect(whitelist).toContain(cmd);
    }
  });
});

// ============================================================================
// Sandbox.validateCommand()
// ============================================================================

describe('Sandbox.validateCommand()', () => {
  it('should allow a whitelisted command', () => {
    const sandbox = new Sandbox({ whitelist: ['npm', 'node'] });
    const result = sandbox.validateCommand('npm');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should deny a non-whitelisted command', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    const result = sandbox.validateCommand('rm');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rm');
    expect(result.reason).toContain('not in the whitelist');
  });

  it('should handle commands with full paths', () => {
    const sandbox = new Sandbox({ whitelist: ['node'] });
    const result = sandbox.validateCommand('/usr/local/bin/node');
    expect(result.allowed).toBe(true);
  });

  it('should strip .cmd extension on Windows-style commands', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    const result = sandbox.validateCommand('npm.cmd');
    expect(result.allowed).toBe(true);
  });

  it('should strip .exe extension on Windows-style commands', () => {
    const sandbox = new Sandbox({ whitelist: ['node'] });
    const result = sandbox.validateCommand('node.exe');
    expect(result.allowed).toBe(true);
  });

  it('should deny dangerous commands', () => {
    const sandbox = new Sandbox();
    expect(sandbox.validateCommand('rm').allowed).toBe(false);
    expect(sandbox.validateCommand('dd').allowed).toBe(false);
    expect(sandbox.validateCommand('mkfs').allowed).toBe(false);
    expect(sandbox.validateCommand('shutdown').allowed).toBe(false);
  });
});

// ============================================================================
// Sandbox.validatePath()
// ============================================================================

describe('Sandbox.validatePath()', () => {
  it('should allow any path when no allowedPaths configured', () => {
    const sandbox = new Sandbox({ allowedPaths: [] });
    const result = sandbox.validatePath('/some/random/path');
    expect(result.allowed).toBe(true);
  });

  it('should allow when cwd is undefined', () => {
    const sandbox = new Sandbox({ allowedPaths: ['/safe'] });
    const result = sandbox.validatePath(undefined);
    expect(result.allowed).toBe(true);
  });

  it('should allow a path within allowed paths', () => {
    const tmpDir = os.tmpdir();
    const sandbox = new Sandbox({ allowedPaths: [tmpDir] });
    const result = sandbox.validatePath(path.join(tmpDir, 'subdir'));
    expect(result.allowed).toBe(true);
  });

  it('should allow a path that exactly matches allowed path', () => {
    const tmpDir = os.tmpdir();
    const sandbox = new Sandbox({ allowedPaths: [tmpDir] });
    const result = sandbox.validatePath(tmpDir);
    expect(result.allowed).toBe(true);
  });

  it('should deny a path outside allowed paths', () => {
    const sandbox = new Sandbox({ allowedPaths: ['/safe/zone'] });
    const result = sandbox.validatePath('/unsafe/path');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not within allowed paths');
  });

  it('should handle relative paths by resolving them', () => {
    const cwd = process.cwd();
    const sandbox = new Sandbox({ allowedPaths: [cwd] });
    const result = sandbox.validatePath('.');
    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// Sandbox.validate()
// ============================================================================

describe('Sandbox.validate()', () => {
  it('should pass when command is whitelisted and no path restriction', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    const result = sandbox.validate('npm');
    expect(result.allowed).toBe(true);
  });

  it('should fail when command is not whitelisted', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    const result = sandbox.validate('rm', '/tmp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in the whitelist');
  });

  it('should fail when path is outside allowed paths', () => {
    const sandbox = new Sandbox({
      whitelist: ['npm'],
      allowedPaths: ['/safe'],
    });
    const result = sandbox.validate('npm', '/unsafe');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not within allowed paths');
  });

  it('should pass when both command and path are valid', () => {
    const tmpDir = os.tmpdir();
    const sandbox = new Sandbox({
      whitelist: ['npm'],
      allowedPaths: [tmpDir],
    });
    const result = sandbox.validate('npm', tmpDir);
    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// Sandbox whitelist management
// ============================================================================

describe('Sandbox - whitelist management', () => {
  it('should add a command to the whitelist', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    sandbox.addToWhitelist('custom-tool');
    expect(sandbox.getWhitelist()).toContain('custom-tool');
    expect(sandbox.validateCommand('custom-tool').allowed).toBe(true);
  });

  it('should remove a command from the whitelist', () => {
    const sandbox = new Sandbox({ whitelist: ['npm', 'node'] });
    sandbox.removeFromWhitelist('npm');
    expect(sandbox.getWhitelist()).not.toContain('npm');
    expect(sandbox.validateCommand('npm').allowed).toBe(false);
  });

  it('should handle removing a command that is not in the whitelist', () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    sandbox.removeFromWhitelist('nonexistent');
    expect(sandbox.getWhitelist()).toEqual(['npm']);
  });
});

// ============================================================================
// Sandbox.execute() - dry-run mode
// ============================================================================

describe('Sandbox.execute() - dry-run mode', () => {
  it('should return simulated result in dry-run mode', async () => {
    const sandbox = new Sandbox({ dryRun: true, whitelist: ['echo'] });
    const result = await sandbox.execute('echo', ['hello', 'world']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[dry-run]');
    expect(result.stdout).toContain('echo hello world');
    expect(result.stderr).toBe('');
    expect(result.duration).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('should return valid ExecResult shape in dry-run mode', async () => {
    const sandbox = new Sandbox({ dryRun: true, whitelist: ['npm'] });
    const result = await sandbox.execute('npm', ['install']);

    const parsed = ExecResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('should include command without args in dry-run output', async () => {
    const sandbox = new Sandbox({ dryRun: true, whitelist: ['node'] });
    const result = await sandbox.execute('node');
    expect(result.command).toBe('node');
    expect(result.stdout).toContain('node');
  });

  it('should still validate commands in dry-run mode', async () => {
    const sandbox = new Sandbox({ dryRun: true, whitelist: ['npm'] });
    await expect(sandbox.execute('rm', ['-rf', '/'])).rejects.toThrow('not in the whitelist');
  });
});

// ============================================================================
// Sandbox.execute() - user confirmation
// ============================================================================

describe('Sandbox.execute() - user confirmation', () => {
  it('should call confirmFn before execution', async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);
    const sandbox = new Sandbox({
      whitelist: ['echo'],
      confirmFn,
      dryRun: true,
    });

    await sandbox.execute('echo', ['test']);
    expect(confirmFn).toHaveBeenCalledWith('echo', ['test']);
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it('should throw when user denies execution', async () => {
    const confirmFn = vi.fn().mockResolvedValue(false);
    const sandbox = new Sandbox({ whitelist: ['npm'], confirmFn });

    await expect(sandbox.execute('npm', ['install'])).rejects.toThrow('User denied');
  });

  it('should proceed when user confirms execution', async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);
    const sandbox = new Sandbox({
      whitelist: ['echo'],
      confirmFn,
      dryRun: true,
    });

    const result = await sandbox.execute('echo', ['ok']);
    expect(result.exitCode).toBe(0);
  });

  it('should not call confirmFn if validation fails', async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);
    const sandbox = new Sandbox({ whitelist: ['npm'], confirmFn });

    await expect(sandbox.execute('rm', ['-rf'])).rejects.toThrow('not in the whitelist');
    expect(confirmFn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Sandbox.execute() - validation errors
// ============================================================================

describe('Sandbox.execute() - validation errors', () => {
  it('should throw for non-whitelisted command', async () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    await expect(sandbox.execute('rm', ['-rf', '/'])).rejects.toThrow('Sandbox');
  });

  it('should throw for path outside allowed paths', async () => {
    const sandbox = new Sandbox({
      whitelist: ['npm'],
      allowedPaths: ['/safe'],
    });
    await expect(
      sandbox.execute('npm', ['install'], { cwd: '/unsafe' }),
    ).rejects.toThrow('Sandbox');
  });

  it('should include descriptive error message', async () => {
    const sandbox = new Sandbox({ whitelist: ['npm'] });
    await expect(sandbox.execute('danger')).rejects.toThrow(
      'Sandbox: Command "danger" is not in the whitelist',
    );
  });
});

// ============================================================================
// Sandbox.execute() - actual execution
// ============================================================================

describe('Sandbox.execute() - actual execution', () => {
  it('should execute a whitelisted command', async () => {
    const sandbox = new Sandbox({ whitelist: ['echo'] });
    const result = await sandbox.execute('echo', ['sandbox-test']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('sandbox-test');
    expect(result.timedOut).toBe(false);
  });

  it('should return valid ExecResult for actual execution', async () => {
    const sandbox = new Sandbox({ whitelist: ['echo'] });
    const result = await sandbox.execute('echo', ['hello']);

    const parsed = ExecResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('should pass execution options to the executor', async () => {
    const sandbox = new Sandbox({ whitelist: ['echo'] });
    const onStdout = vi.fn();
    const result = await sandbox.execute('echo', ['streamed'], { onStdout });

    expect(result.exitCode).toBe(0);
    expect(onStdout).toHaveBeenCalled();
  });
});
