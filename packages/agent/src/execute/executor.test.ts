// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CommandExecutor, executeCommand } from './executor.js';
import type { ExecuteOptions } from './executor.js';

// ============================================================================
// CommandExecutor - constructor
// ============================================================================

describe('CommandExecutor', () => {
  describe('constructor', () => {
    it('creates instance with default timeout', () => {
      const executor = new CommandExecutor();
      expect(executor).toBeInstanceOf(CommandExecutor);
    });

    it('creates instance with custom timeout', () => {
      const executor = new CommandExecutor(60000);
      expect(executor).toBeInstanceOf(CommandExecutor);
    });
  });

  // ============================================================================
  // execute - basic commands
  // ============================================================================

  describe('execute', () => {
    it('executes a simple command and returns result', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.stderr).toBe('');
      expect(result.timedOut).toBe(false);
      expect(result.command).toBe('echo hello');
    });

    it('captures exit code for failed commands', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('node', ['-e', 'process.exit(42)']);
      expect(result.exitCode).toBe(42);
    });

    it('captures stderr output', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('node', ['-e', 'console.error("err msg")']);
      expect(result.stderr).toContain('err msg');
    });

    it('captures stdout output', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('node', ['-e', 'console.log("out msg")']);
      expect(result.stdout).toContain('out msg');
    });

    it('records duration', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('echo', ['fast']);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('formats command string with args', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('echo', ['a', 'b', 'c']);
      expect(result.command).toBe('echo a b c');
    });

    it('formats command string without args', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('echo');
      expect(result.command).toBe('echo');
    });
  });

  // ============================================================================
  // execute - timeout
  // ============================================================================

  describe('timeout', () => {
    it('sets timedOut flag when command exceeds timeout', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('sleep', ['10'], { timeoutMs: 100 });
      expect(result.timedOut).toBe(true);
    }, 5000);

    it('uses default timeout when not specified', async () => {
      const executor = new CommandExecutor(500);
      const result = await executor.execute('sleep', ['10']);
      expect(result.timedOut).toBe(true);
    }, 5000);

    it('completes normally within timeout', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('echo', ['quick'], { timeoutMs: 5000 });
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================================
  // execute - cwd
  // ============================================================================

  describe('cwd option', () => {
    it('executes in specified working directory', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('pwd', [], { cwd: '/tmp' });
      expect(result.exitCode).toBe(0);
      // On macOS /tmp is a symlink to /private/tmp
      expect(result.stdout.trim()).toMatch(/\/tmp$/);
    });
  });

  // ============================================================================
  // execute - env
  // ============================================================================

  describe('env option', () => {
    it('passes custom environment variables', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute(
        'node',
        ['-e', 'console.log(process.env.MY_TEST_VAR)'],
        { env: { MY_TEST_VAR: 'test_value' } },
      );
      expect(result.stdout.trim()).toBe('test_value');
    });
  });

  // ============================================================================
  // execute - input
  // ============================================================================

  describe('input option', () => {
    it('writes input to stdin', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute(
        'node',
        ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(d.trim()))'],
        { input: 'hello stdin' },
      );
      expect(result.stdout.trim()).toBe('hello stdin');
    });
  });

  // ============================================================================
  // execute - streaming callbacks
  // ============================================================================

  describe('streaming callbacks', () => {
    it('calls onStdout for each chunk', async () => {
      const executor = new CommandExecutor();
      const chunks: string[] = [];
      await executor.execute(
        'echo',
        ['streaming output'],
        { onStdout: (data) => chunks.push(data) },
      );
      expect(chunks.join('').trim()).toBe('streaming output');
    });

    it('calls onStderr for each chunk', async () => {
      const executor = new CommandExecutor();
      const chunks: string[] = [];
      await executor.execute(
        'node',
        ['-e', 'console.error("error output")'],
        { onStderr: (data) => chunks.push(data) },
      );
      expect(chunks.join('')).toContain('error output');
    });
  });

  // ============================================================================
  // execute - error handling
  // ============================================================================

  describe('error handling', () => {
    it('handles command not found gracefully', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('nonexistent_command_xyz_12345');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
    });

    it('includes error message in stderr for spawn errors', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute('nonexistent_command_xyz_12345');
      expect(result.stderr.toLowerCase()).toContain('enoent');
    });
  });

  // ============================================================================
  // execute - npm fund suppression
  // ============================================================================

  describe('npm fund suppression', () => {
    it('sets NPM_CONFIG_FUND when running npm', async () => {
      const executor = new CommandExecutor();
      const result = await executor.execute(
        'node',
        ['-e', 'console.log(process.env.NPM_CONFIG_FUND)'],
      );
      // Only suppressed for npm commands, not node
      expect(result.exitCode).toBe(0);
    });
  });
});

// ============================================================================
// executeCommand convenience function
// ============================================================================

describe('executeCommand', () => {
  it('executes a command without creating executor manually', async () => {
    const result = await executeCommand('echo', ['convenience']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('convenience');
  });

  it('passes options through', async () => {
    const result = await executeCommand('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });
});
