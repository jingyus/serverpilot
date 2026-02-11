// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

import { Sandbox, DEFAULT_WHITELIST } from './sandbox.js';
import type { SandboxConfig, ValidationResult } from './sandbox.js';

// ============================================================================
// DEFAULT_WHITELIST
// ============================================================================

describe('DEFAULT_WHITELIST', () => {
  it('is a non-empty array', () => {
    expect(DEFAULT_WHITELIST.length).toBeGreaterThan(0);
  });

  it('includes common package managers', () => {
    expect(DEFAULT_WHITELIST).toContain('npm');
    expect(DEFAULT_WHITELIST).toContain('pnpm');
    expect(DEFAULT_WHITELIST).toContain('yarn');
  });

  it('includes common tools', () => {
    expect(DEFAULT_WHITELIST).toContain('node');
    expect(DEFAULT_WHITELIST).toContain('git');
    expect(DEFAULT_WHITELIST).toContain('curl');
  });

  it('includes verification commands', () => {
    expect(DEFAULT_WHITELIST).toContain('which');
    expect(DEFAULT_WHITELIST).toContain('ls');
    expect(DEFAULT_WHITELIST).toContain('echo');
  });
});

// ============================================================================
// Sandbox - constructor
// ============================================================================

describe('Sandbox', () => {
  describe('constructor', () => {
    it('creates instance with defaults', () => {
      const sandbox = new Sandbox();
      expect(sandbox).toBeInstanceOf(Sandbox);
      expect(sandbox.isDryRun()).toBe(false);
    });

    it('creates instance with custom whitelist', () => {
      const sandbox = new Sandbox({ whitelist: ['node', 'npm'] });
      expect(sandbox.getWhitelist()).toContain('node');
      expect(sandbox.getWhitelist()).toContain('npm');
      expect(sandbox.getWhitelist()).not.toContain('git');
    });

    it('creates instance with dry-run mode', () => {
      const sandbox = new Sandbox({ dryRun: true });
      expect(sandbox.isDryRun()).toBe(true);
    });
  });

  // ============================================================================
  // validateCommand
  // ============================================================================

  describe('validateCommand', () => {
    it('allows whitelisted commands', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validateCommand('npm');
      expect(result.allowed).toBe(true);
    });

    it('denies non-whitelisted commands', () => {
      const sandbox = new Sandbox({ whitelist: ['npm'] });
      const result = sandbox.validateCommand('rm');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rm');
      expect(result.reason).toContain('not in the whitelist');
    });

    it('strips path to extract base command name', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validateCommand('/usr/local/bin/npm');
      expect(result.allowed).toBe(true);
    });

    it('strips .cmd extension on Windows-style commands', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validateCommand('npm.cmd');
      expect(result.allowed).toBe(true);
    });

    it('strips .exe extension', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validateCommand('node.exe');
      expect(result.allowed).toBe(true);
    });

    it('strips .bat extension', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validateCommand('npm.bat');
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // validatePath
  // ============================================================================

  describe('validatePath', () => {
    it('allows any path when no allowedPaths configured', () => {
      const sandbox = new Sandbox();
      const result = sandbox.validatePath('/some/random/path');
      expect(result.allowed).toBe(true);
    });

    it('allows when no cwd provided', () => {
      const sandbox = new Sandbox({ allowedPaths: ['/home/user'] });
      const result = sandbox.validatePath(undefined);
      expect(result.allowed).toBe(true);
    });

    it('allows paths within allowed directories', () => {
      const sandbox = new Sandbox({ allowedPaths: ['/home/user/project'] });
      const result = sandbox.validatePath('/home/user/project/src');
      expect(result.allowed).toBe(true);
    });

    it('allows exact allowed path', () => {
      const sandbox = new Sandbox({ allowedPaths: ['/home/user/project'] });
      const result = sandbox.validatePath('/home/user/project');
      expect(result.allowed).toBe(true);
    });

    it('denies paths outside allowed directories', () => {
      const sandbox = new Sandbox({ allowedPaths: ['/home/user/project'] });
      const result = sandbox.validatePath('/etc/secrets');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not within allowed paths');
    });
  });

  // ============================================================================
  // validate (combined)
  // ============================================================================

  describe('validate', () => {
    it('passes when both command and path are valid', () => {
      const sandbox = new Sandbox({
        whitelist: ['npm'],
        allowedPaths: ['/home/user'],
      });
      const result = sandbox.validate('npm', '/home/user/project');
      expect(result.allowed).toBe(true);
    });

    it('fails if command not whitelisted', () => {
      const sandbox = new Sandbox({
        whitelist: ['npm'],
        allowedPaths: ['/home/user'],
      });
      const result = sandbox.validate('rm', '/home/user/project');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rm');
    });

    it('fails if path not allowed', () => {
      const sandbox = new Sandbox({
        whitelist: ['npm'],
        allowedPaths: ['/home/user'],
      });
      const result = sandbox.validate('npm', '/etc/secrets');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not within allowed paths');
    });
  });

  // ============================================================================
  // whitelist management
  // ============================================================================

  describe('whitelist management', () => {
    it('getWhitelist returns current whitelist', () => {
      const sandbox = new Sandbox({ whitelist: ['npm', 'node'] });
      const whitelist = sandbox.getWhitelist();
      expect(whitelist).toContain('npm');
      expect(whitelist).toContain('node');
    });

    it('addToWhitelist adds new command', () => {
      const sandbox = new Sandbox({ whitelist: ['npm'] });
      sandbox.addToWhitelist('custom-tool');
      expect(sandbox.getWhitelist()).toContain('custom-tool');
      expect(sandbox.validateCommand('custom-tool').allowed).toBe(true);
    });

    it('removeFromWhitelist removes command', () => {
      const sandbox = new Sandbox({ whitelist: ['npm', 'node'] });
      sandbox.removeFromWhitelist('npm');
      expect(sandbox.getWhitelist()).not.toContain('npm');
      expect(sandbox.validateCommand('npm').allowed).toBe(false);
    });
  });

  // ============================================================================
  // execute - validation errors
  // ============================================================================

  describe('execute - validation', () => {
    it('throws when command not whitelisted', async () => {
      const sandbox = new Sandbox({ whitelist: ['npm'] });
      await expect(sandbox.execute('rm', ['-rf', '/'])).rejects.toThrow('Sandbox');
      await expect(sandbox.execute('rm', ['-rf', '/'])).rejects.toThrow('not in the whitelist');
    });

    it('throws when path not allowed', async () => {
      const sandbox = new Sandbox({
        whitelist: ['npm'],
        allowedPaths: ['/home/user'],
      });
      await expect(sandbox.execute('npm', ['install'], { cwd: '/etc' })).rejects.toThrow('not within allowed paths');
    });
  });

  // ============================================================================
  // execute - confirmation
  // ============================================================================

  describe('execute - confirmation', () => {
    it('calls confirmFn and proceeds when confirmed', async () => {
      const confirmFn = vi.fn().mockResolvedValue(true);
      const sandbox = new Sandbox({ confirmFn });
      const result = await sandbox.execute('echo', ['confirmed']);
      expect(confirmFn).toHaveBeenCalledWith('echo', ['confirmed']);
      expect(result.exitCode).toBe(0);
    });

    it('throws when user denies execution', async () => {
      const confirmFn = vi.fn().mockResolvedValue(false);
      const sandbox = new Sandbox({ confirmFn });
      await expect(sandbox.execute('echo', ['denied'])).rejects.toThrow('User denied');
    });

    it('skips confirmation when confirmFn not set', async () => {
      const sandbox = new Sandbox();
      const result = await sandbox.execute('echo', ['no confirm']);
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================================
  // execute - dry-run mode
  // ============================================================================

  describe('execute - dry-run', () => {
    it('returns simulated result without executing', async () => {
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('npm', ['install']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain('npm install');
      expect(result.duration).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('still validates command in dry-run mode', async () => {
      const sandbox = new Sandbox({ dryRun: true, whitelist: ['npm'] });
      await expect(sandbox.execute('rm', ['-rf'])).rejects.toThrow('not in the whitelist');
    });

    it('dry-run result includes full command', async () => {
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('git', ['status']);
      expect(result.command).toBe('git status');
    });

    it('dry-run result for command without args', async () => {
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('ls');
      expect(result.command).toBe('ls');
      expect(result.stdout).toContain('[dry-run] Would execute: ls');
    });
  });

  // ============================================================================
  // execute - actual execution
  // ============================================================================

  describe('execute - actual execution', () => {
    it('executes whitelisted command successfully', async () => {
      const sandbox = new Sandbox();
      const result = await sandbox.execute('echo', ['sandbox test']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('sandbox test');
    });

    it('passes execution options through', async () => {
      const sandbox = new Sandbox();
      const result = await sandbox.execute('node', ['-e', 'console.log(process.cwd())'], { cwd: '/tmp' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/\/tmp$/);
    });
  });
});
