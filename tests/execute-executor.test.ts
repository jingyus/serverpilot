/**
 * Tests for packages/agent/src/execute/executor.ts
 *
 * Command execution module - CommandExecutor class, execute(), and
 * real-time output stream handling.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandExecutor,
  executeCommand,
} from '../packages/agent/src/execute/executor.js';
import type { ExecuteOptions } from '../packages/agent/src/execute/executor.js';
import { ExecResultSchema } from '../packages/shared/src/protocol/types.js';

// ============================================================================
// File Existence
// ============================================================================

describe('execute/executor.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/execute/executor.ts');

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

describe('execute/executor.ts - exports', () => {
  it('should export CommandExecutor class', () => {
    expect(CommandExecutor).toBeDefined();
    expect(typeof CommandExecutor).toBe('function');
  });

  it('should export executeCommand function', () => {
    expect(typeof executeCommand).toBe('function');
  });
});

// ============================================================================
// CommandExecutor - constructor
// ============================================================================

describe('CommandExecutor - constructor', () => {
  it('should create an instance with default timeout', () => {
    const executor = new CommandExecutor();
    expect(executor).toBeInstanceOf(CommandExecutor);
  });

  it('should create an instance with custom timeout', () => {
    const executor = new CommandExecutor(60_000);
    expect(executor).toBeInstanceOf(CommandExecutor);
  });
});

// ============================================================================
// CommandExecutor.execute() - basic command execution
// ============================================================================

describe('CommandExecutor.execute() - basic execution', () => {
  const executor = new CommandExecutor();

  it('should execute a simple command and return ExecResult', async () => {
    const result = await executor.execute('echo', ['hello']);
    expect(result).toHaveProperty('command');
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('timedOut');
  });

  it('should return exitCode 0 for a successful command', async () => {
    const result = await executor.execute('echo', ['hello']);
    expect(result.exitCode).toBe(0);
  });

  it('should capture stdout output', async () => {
    const result = await executor.execute('echo', ['hello world']);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should return the full command string', async () => {
    const result = await executor.execute('echo', ['hello', 'world']);
    expect(result.command).toBe('echo hello world');
  });

  it('should return command string without args when no args provided', async () => {
    const result = await executor.execute('echo');
    expect(result.command).toBe('echo');
  });

  it('should measure duration in milliseconds', async () => {
    const result = await executor.execute('echo', ['fast']);
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should not time out for a fast command', async () => {
    const result = await executor.execute('echo', ['fast']);
    expect(result.timedOut).toBe(false);
  });

  it('should conform to ExecResult schema', async () => {
    const result = await executor.execute('echo', ['schema test']);
    const parsed = ExecResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

// ============================================================================
// CommandExecutor.execute() - stderr capture
// ============================================================================

describe('CommandExecutor.execute() - stderr', () => {
  const executor = new CommandExecutor();

  it('should capture stderr output', async () => {
    // Redirect to stderr using node -e
    const result = await executor.execute('node', ['-e', 'console.error("err msg")']);
    expect(result.stderr.trim()).toBe('err msg');
  });

  it('should capture both stdout and stderr', async () => {
    const result = await executor.execute('node', [
      '-e',
      'console.log("out"); console.error("err");',
    ]);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
  });
});

// ============================================================================
// CommandExecutor.execute() - exit codes
// ============================================================================

describe('CommandExecutor.execute() - exit codes', () => {
  const executor = new CommandExecutor();

  it('should return non-zero exit code for failed commands', async () => {
    const result = await executor.execute('node', ['-e', 'process.exit(42)']);
    expect(result.exitCode).toBe(42);
  });

  it('should return exit code 1 for a command that throws', async () => {
    const result = await executor.execute('node', ['-e', 'throw new Error("boom")']);
    expect(result.exitCode).toBe(1);
  });
});

// ============================================================================
// CommandExecutor.execute() - timeout
// ============================================================================

describe('CommandExecutor.execute() - timeout', () => {
  it('should time out a long-running command', async () => {
    const executor = new CommandExecutor();
    const result = await executor.execute('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
  }, 10_000);

  it('should use default timeout from constructor', async () => {
    const executor = new CommandExecutor(500);
    const result = await executor.execute('node', ['-e', 'setTimeout(() => {}, 60000)']);
    expect(result.timedOut).toBe(true);
  }, 10_000);

  it('should allow per-call timeout to override constructor default', async () => {
    const executor = new CommandExecutor(60_000);
    const result = await executor.execute('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
  }, 10_000);
});

// ============================================================================
// CommandExecutor.execute() - cwd option
// ============================================================================

describe('CommandExecutor.execute() - cwd option', () => {
  const executor = new CommandExecutor();

  it('should execute command in specified working directory', async () => {
    const result = await executor.execute('pwd', [], { cwd: '/tmp' });
    // On macOS /tmp is a symlink to /private/tmp
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
    expect(result.exitCode).toBe(0);
  });
});

// ============================================================================
// CommandExecutor.execute() - env option
// ============================================================================

describe('CommandExecutor.execute() - env option', () => {
  const executor = new CommandExecutor();

  it('should pass custom environment variables', async () => {
    const result = await executor.execute('node', ['-e', 'console.log(process.env.MY_TEST_VAR)'], {
      env: { MY_TEST_VAR: 'test_value_123' },
    });
    expect(result.stdout.trim()).toBe('test_value_123');
  });

  it('should inherit existing env variables', async () => {
    const result = await executor.execute('node', ['-e', 'console.log(process.env.PATH)']);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CommandExecutor.execute() - input option
// ============================================================================

describe('CommandExecutor.execute() - input option', () => {
  const executor = new CommandExecutor();

  it('should write input to stdin', async () => {
    const result = await executor.execute('node', ['-e', `
      let data = '';
      process.stdin.on('data', (chunk) => data += chunk);
      process.stdin.on('end', () => console.log(data.trim()));
    `], {
      input: 'hello from stdin',
    });
    expect(result.stdout.trim()).toBe('hello from stdin');
  });
});

// ============================================================================
// CommandExecutor.execute() - real-time output streaming
// ============================================================================

describe('CommandExecutor.execute() - output streaming', () => {
  const executor = new CommandExecutor();

  it('should call onStdout callback with output chunks', async () => {
    const chunks: string[] = [];
    await executor.execute('echo', ['streaming test'], {
      onStdout: (data) => chunks.push(data),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('').trim()).toBe('streaming test');
  });

  it('should call onStderr callback with error chunks', async () => {
    const chunks: string[] = [];
    await executor.execute('node', ['-e', 'console.error("err chunk")'], {
      onStderr: (data) => chunks.push(data),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('').trim()).toBe('err chunk');
  });

  it('should call both onStdout and onStderr for mixed output', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    await executor.execute('node', ['-e', 'console.log("out"); console.error("err");'], {
      onStdout: (data) => stdoutChunks.push(data),
      onStderr: (data) => stderrChunks.push(data),
    });
    expect(stdoutChunks.join('').trim()).toBe('out');
    expect(stderrChunks.join('').trim()).toBe('err');
  });

  it('should still capture full output when callbacks are used', async () => {
    const result = await executor.execute('echo', ['captured'], {
      onStdout: () => {},
    });
    expect(result.stdout.trim()).toBe('captured');
  });
});

// ============================================================================
// CommandExecutor.execute() - command not found
// ============================================================================

describe('CommandExecutor.execute() - error handling', () => {
  const executor = new CommandExecutor();

  it('should handle command not found gracefully', async () => {
    const result = await executor.execute('nonexistent_command_xyz_123');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// executeCommand() convenience function
// ============================================================================

describe('executeCommand() - convenience function', () => {
  it('should execute a command and return ExecResult', async () => {
    const result = await executeCommand('echo', ['convenience']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('convenience');
  });

  it('should accept options', async () => {
    const chunks: string[] = [];
    const result = await executeCommand('echo', ['with opts'], {
      onStdout: (data) => chunks.push(data),
    });
    expect(result.exitCode).toBe(0);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should conform to ExecResult schema', async () => {
    const result = await executeCommand('echo', ['schema']);
    const parsed = ExecResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('execute/executor.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/execute/executor.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should use node:child_process import', () => {
    expect(content).toContain('from "node:child_process"');
  });

  it('should use node:path import', () => {
    expect(content).toContain('from "node:path"');
  });

  it('should import ExecResult type from @aiinstaller/shared', () => {
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('ExecResult');
  });

  it('should use type import for ExecResult', () => {
    expect(content).toMatch(/import\s+type\s+/);
  });

  it('should export CommandExecutor class', () => {
    expect(content).toMatch(/export\s+class\s+CommandExecutor/);
  });

  it('should export executeCommand function', () => {
    expect(content).toMatch(/export\s+async\s+function\s+executeCommand/);
  });

  it('should export ExecuteOptions interface', () => {
    expect(content).toMatch(/export\s+interface\s+ExecuteOptions/);
  });

  it('should have JSDoc comments for exported members', () => {
    expect(content).toContain('Execute a command and return the result.');
    expect(content).toContain('Convenience function');
  });

  it('should have a module docblock', () => {
    expect(content).toContain('@module execute/executor');
  });

  it('should handle Windows command resolution', () => {
    expect(content).toContain('resolveCommand');
    expect(content).toContain('win32');
  });

  it('should implement timeout with SIGKILL', () => {
    expect(content).toContain('SIGKILL');
    expect(content).toContain('setTimeout');
  });

  it('should support real-time output callbacks', () => {
    expect(content).toContain('onStdout');
    expect(content).toContain('onStderr');
  });

  it('should suppress npm fund messages', () => {
    expect(content).toContain('NPM_CONFIG_FUND');
  });
});
