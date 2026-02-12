// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  parseArgs,
  buildHelpText,
  formatDuration,
  formatDryRunPreview,
  main,
  AGENT_NAME,
  AGENT_VERSION,
} from './index.js';
import type { CLIOptions, DryRunStep } from './index.js';

// ============================================================================
// parseArgs
// ============================================================================

describe('parseArgs', () => {
  it('returns default options with no arguments', () => {
    const opts = parseArgs(['node', 'index.js']);
    expect(opts).toEqual({
      software: 'openclaw',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: false,
      dryRun: false,
      offline: false,
      update: false,
      checkUpdate: false,
      help: false,
      version: false,
      token: '',
      serverId: '',
      daemon: false,
    });
  });

  it('parses positional software argument', () => {
    const opts = parseArgs(['node', 'index.js', 'myapp']);
    expect(opts.software).toBe('myapp');
  });

  it('parses --yes flag', () => {
    const opts = parseArgs(['node', 'index.js', '--yes']);
    expect(opts.yes).toBe(true);
  });

  it('parses -y shorthand', () => {
    const opts = parseArgs(['node', 'index.js', '-y']);
    expect(opts.yes).toBe(true);
  });

  it('parses --verbose flag', () => {
    const opts = parseArgs(['node', 'index.js', '--verbose']);
    expect(opts.verbose).toBe(true);
  });

  it('parses -v shorthand', () => {
    const opts = parseArgs(['node', 'index.js', '-v']);
    expect(opts.verbose).toBe(true);
  });

  it('parses --dry-run flag', () => {
    const opts = parseArgs(['node', 'index.js', '--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('parses --server with URL argument', () => {
    const opts = parseArgs(['node', 'index.js', '--server', 'ws://example.com:8080']);
    expect(opts.serverUrl).toBe('ws://example.com:8080');
  });

  it('throws when --server has no argument', () => {
    expect(() => parseArgs(['node', 'index.js', '--server'])).toThrow(
      '--server requires a URL argument',
    );
  });

  it('throws when --server is followed by a flag', () => {
    expect(() => parseArgs(['node', 'index.js', '--server', '--yes'])).toThrow(
      '--server requires a URL argument',
    );
  });

  it('parses --help flag', () => {
    const opts = parseArgs(['node', 'index.js', '--help']);
    expect(opts.help).toBe(true);
  });

  it('parses -h shorthand', () => {
    const opts = parseArgs(['node', 'index.js', '-h']);
    expect(opts.help).toBe(true);
  });

  it('parses --version flag', () => {
    const opts = parseArgs(['node', 'index.js', '--version']);
    expect(opts.version).toBe(true);
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['node', 'index.js', '--unknown'])).toThrow(
      'Unknown option: --unknown',
    );
  });

  it('parses multiple flags together', () => {
    const opts = parseArgs([
      'node',
      'index.js',
      'myapp',
      '--yes',
      '--verbose',
      '--dry-run',
      '--server',
      'ws://custom:5000',
    ]);
    expect(opts.software).toBe('myapp');
    expect(opts.yes).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.serverUrl).toBe('ws://custom:5000');
  });

  it('handles positional arg after flags', () => {
    const opts = parseArgs(['node', 'index.js', '--yes', 'myapp']);
    expect(opts.software).toBe('myapp');
    expect(opts.yes).toBe(true);
  });
});

// ============================================================================
// buildHelpText
// ============================================================================

describe('buildHelpText', () => {
  it('includes agent name and version', () => {
    const text = buildHelpText();
    expect(text).toContain(AGENT_NAME);
    expect(text).toContain(AGENT_VERSION);
  });

  it('includes usage line', () => {
    const text = buildHelpText();
    expect(text).toContain('Usage:');
    expect(text).toContain('ai-installer');
  });

  it('lists all options', () => {
    const text = buildHelpText();
    expect(text).toContain('--server');
    expect(text).toContain('--yes');
    expect(text).toContain('-y');
    expect(text).toContain('--verbose');
    expect(text).toContain('-v');
    expect(text).toContain('--dry-run');
    expect(text).toContain('--help');
    expect(text).toContain('-h');
    expect(text).toContain('--version');
  });

  it('shows default values', () => {
    const text = buildHelpText();
    expect(text).toContain('openclaw');
    expect(text).toContain('ws://localhost:3000');
  });
});

// ============================================================================
// formatDuration
// ============================================================================

describe('formatDuration', () => {
  it('formats milliseconds for sub-second durations', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds for durations under a minute', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(59000)).toBe('59s');
    expect(formatDuration(59499)).toBe('59s');
  });

  it('formats minutes and seconds for longer durations', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });
});

// ============================================================================
// AGENT_NAME and AGENT_VERSION exports
// ============================================================================

describe('module exports', () => {
  it('exports AGENT_NAME', () => {
    expect(AGENT_NAME).toBe('@aiinstaller/agent');
  });

  it('exports AGENT_VERSION', () => {
    expect(AGENT_VERSION).toBe('0.1.0');
  });
});

// ============================================================================
// main() - help and version
// ============================================================================

describe('main', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('returns 0 and prints help text with --help', async () => {
    const code = await main(['node', 'index.js', '--help']);
    expect(code).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Usage:');
    expect(output).toContain(AGENT_NAME);
  });

  it('returns 0 and prints help text with -h', async () => {
    const code = await main(['node', 'index.js', '-h']);
    expect(code).toBe(0);
  });

  it('returns 0 and prints version with --version', async () => {
    const code = await main(['node', 'index.js', '--version']);
    expect(code).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(AGENT_VERSION);
  });

  it('returns 1 on invalid arguments', async () => {
    const code = await main(['node', 'index.js', '--invalid-flag']);
    expect(code).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// CLIOptions type validation
// ============================================================================

describe('CLIOptions interface', () => {
  it('all default options have correct types', () => {
    const opts = parseArgs(['node', 'index.js']);
    expect(typeof opts.software).toBe('string');
    expect(typeof opts.serverUrl).toBe('string');
    expect(typeof opts.yes).toBe('boolean');
    expect(typeof opts.verbose).toBe('boolean');
    expect(typeof opts.dryRun).toBe('boolean');
    expect(typeof opts.help).toBe('boolean');
    expect(typeof opts.version).toBe('boolean');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('parseArgs edge cases', () => {
  it('last positional argument wins as software name', () => {
    const opts = parseArgs(['node', 'index.js', 'first', 'second']);
    expect(opts.software).toBe('second');
  });

  it('empty args after node and script returns defaults', () => {
    const opts = parseArgs(['node', 'script.js']);
    expect(opts.software).toBe('openclaw');
  });

  it('--server accepts various URL formats', () => {
    const opts1 = parseArgs(['node', 'index.js', '--server', 'wss://secure.example.com']);
    expect(opts1.serverUrl).toBe('wss://secure.example.com');

    const opts2 = parseArgs(['node', 'index.js', '--server', 'ws://127.0.0.1:9999']);
    expect(opts2.serverUrl).toBe('ws://127.0.0.1:9999');
  });

  it('flags can appear in any order', () => {
    const opts = parseArgs(['node', 'index.js', '-v', '-y', '--dry-run', 'myapp']);
    expect(opts.verbose).toBe(true);
    expect(opts.yes).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.software).toBe('myapp');
  });
});

// ============================================================================
// --verbose / -v verbose output behavior
// ============================================================================

describe('--verbose / -v verbose output behavior', () => {
  describe('parseArgs sets verbose flag correctly', () => {
    it('defaults verbose to false when not specified', () => {
      const opts = parseArgs(['node', 'index.js']);
      expect(opts.verbose).toBe(false);
    });

    it('--verbose sets verbose to true', () => {
      const opts = parseArgs(['node', 'index.js', '--verbose']);
      expect(opts.verbose).toBe(true);
    });

    it('-v sets verbose to true', () => {
      const opts = parseArgs(['node', 'index.js', '-v']);
      expect(opts.verbose).toBe(true);
    });

    it('--verbose combined with --yes preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--verbose', '--yes']);
      expect(opts.verbose).toBe(true);
      expect(opts.yes).toBe(true);
    });

    it('-v combined with -y preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '-v', '-y']);
      expect(opts.verbose).toBe(true);
      expect(opts.yes).toBe(true);
    });

    it('--verbose combined with --dry-run preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--verbose', '--dry-run']);
      expect(opts.verbose).toBe(true);
      expect(opts.dryRun).toBe(true);
    });

    it('--verbose with software argument preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--verbose', 'myapp']);
      expect(opts.verbose).toBe(true);
      expect(opts.software).toBe('myapp');
    });

    it('-v with --server preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '-v', '--server', 'ws://custom:8080']);
      expect(opts.verbose).toBe(true);
      expect(opts.serverUrl).toBe('ws://custom:8080');
    });

    it('all flags together', () => {
      const opts = parseArgs(['node', 'index.js', '-v', '-y', '--dry-run', '--server', 'ws://test:3000', 'myapp']);
      expect(opts.verbose).toBe(true);
      expect(opts.yes).toBe(true);
      expect(opts.dryRun).toBe(true);
      expect(opts.serverUrl).toBe('ws://test:3000');
      expect(opts.software).toBe('myapp');
    });
  });

  describe('help text documents --verbose/-v', () => {
    it('help text includes --verbose option', () => {
      const text = buildHelpText();
      expect(text).toContain('--verbose');
      expect(text).toContain('-v');
    });

    it('help text describes verbose behavior', () => {
      const text = buildHelpText();
      expect(text).toMatch(/verbose/i);
    });
  });

  describe('verbose mode sandbox streaming', () => {
    it('sandbox executes commands with stdout/stderr callbacks when verbose=true', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ confirmFn: undefined });
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const result = await sandbox.execute('echo', ['verbose-output'], {
        onStdout: (data) => stdoutChunks.push(data),
        onStderr: (data) => stderrChunks.push(data),
      });

      expect(result.exitCode).toBe(0);
      expect(stdoutChunks.join('')).toContain('verbose-output');
    });

    it('sandbox dry-run mode works with verbose', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true, confirmFn: undefined });
      const result = await sandbox.execute('npm', ['install']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain('npm install');
    });
  });

  describe('VerboseLogger integration in index', () => {
    it('VerboseLogger is importable from verbose module', async () => {
      const { VerboseLogger } = await import('./ui/verbose.js');
      expect(VerboseLogger).toBeDefined();
    });

    it('disabled VerboseLogger produces no output', async () => {
      const { VerboseLogger } = await import('./ui/verbose.js');
      const writer = vi.fn();
      const logger = new VerboseLogger({ enabled: false, writer });
      logger.log('general', 'should not appear');
      logger.logData('env', 'data', { x: 1 });
      logger.logTiming('step', 'test', 100);
      logger.logCommand('npm', ['install']);
      logger.logStep(0, 3, 'step one');
      expect(writer).not.toHaveBeenCalled();
    });

    it('enabled VerboseLogger outputs all categories', async () => {
      const { VerboseLogger } = await import('./ui/verbose.js');
      const writer = vi.fn();
      const logger = new VerboseLogger({ enabled: true, writer, timestamps: false });

      logger.log('env', 'env msg');
      logger.log('server', 'server msg');
      logger.log('ws', 'ws msg');
      logger.log('step', 'step msg');
      logger.log('sandbox', 'sandbox msg');
      logger.log('exec', 'exec msg');
      logger.log('plan', 'plan msg');
      logger.log('error', 'error msg');
      logger.log('general', 'general msg');

      expect(writer).toHaveBeenCalledTimes(9);
      const outputs = writer.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(outputs[0]).toContain('[ENV]');
      expect(outputs[1]).toContain('[SERVER]');
      expect(outputs[2]).toContain('[WS]');
      expect(outputs[3]).toContain('[STEP]');
      expect(outputs[4]).toContain('[SANDBOX]');
      expect(outputs[5]).toContain('[EXEC]');
      expect(outputs[6]).toContain('[PLAN]');
      expect(outputs[7]).toContain('[ERROR]');
      expect(outputs[8]).toContain('[VERBOSE]');
    });
  });
});

// ============================================================================
// --yes / -y auto-confirm behavior
// ============================================================================

describe('--yes / -y auto-confirm behavior', () => {
  describe('parseArgs sets yes flag correctly', () => {
    it('defaults yes to false when not specified', () => {
      const opts = parseArgs(['node', 'index.js']);
      expect(opts.yes).toBe(false);
    });

    it('--yes sets yes to true', () => {
      const opts = parseArgs(['node', 'index.js', '--yes']);
      expect(opts.yes).toBe(true);
    });

    it('-y sets yes to true', () => {
      const opts = parseArgs(['node', 'index.js', '-y']);
      expect(opts.yes).toBe(true);
    });

    it('--yes combined with other flags preserves all', () => {
      const opts = parseArgs(['node', 'index.js', '--yes', '--verbose', '--dry-run']);
      expect(opts.yes).toBe(true);
      expect(opts.verbose).toBe(true);
      expect(opts.dryRun).toBe(true);
    });

    it('-y combined with -v preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '-y', '-v']);
      expect(opts.yes).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('--yes with software argument preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--yes', 'myapp']);
      expect(opts.yes).toBe(true);
      expect(opts.software).toBe('myapp');
    });

    it('-y with --server preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '-y', '--server', 'ws://custom:8080']);
      expect(opts.yes).toBe(true);
      expect(opts.serverUrl).toBe('ws://custom:8080');
    });
  });

  describe('sandbox confirmation skipping', () => {
    it('sandbox without confirmFn does not prompt for confirmation', async () => {
      // When --yes is true, confirmFn is set to undefined, so sandbox skips confirmation
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ confirmFn: undefined });
      // Should execute without any confirmation prompt
      const result = await sandbox.execute('echo', ['auto-confirmed']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('auto-confirmed');
    });

    it('sandbox with confirmFn prompts for confirmation', async () => {
      // When --yes is false, confirmFn is set, so sandbox prompts
      const { Sandbox } = await import('./execute/sandbox.js');
      const confirmFn = vi.fn().mockResolvedValue(true);
      const sandbox = new Sandbox({ confirmFn });
      await sandbox.execute('echo', ['need-confirm']);
      expect(confirmFn).toHaveBeenCalledWith('echo', ['need-confirm']);
    });

    it('sandbox with confirmFn blocks when user denies', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const confirmFn = vi.fn().mockResolvedValue(false);
      const sandbox = new Sandbox({ confirmFn });
      await expect(sandbox.execute('echo', ['denied'])).rejects.toThrow('User denied');
    });

    it('--yes mode: sandbox executes multiple commands without prompting', async () => {
      // Simulate --yes mode where no confirmFn is set
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ confirmFn: undefined });
      const r1 = await sandbox.execute('echo', ['step1']);
      const r2 = await sandbox.execute('echo', ['step2']);
      const r3 = await sandbox.execute('echo', ['step3']);
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
      expect(r3.exitCode).toBe(0);
    });
  });

  describe('prompt autoConfirm integration', () => {
    it('confirmStep with autoConfirm skips backend call', async () => {
      const {
        confirmStep,
        _setPromptBackend,
        _resetPromptBackend,
      } = await import('./ui/prompt.js');

      const backend = {
        confirm: vi.fn().mockResolvedValue(true),
        text: vi.fn().mockResolvedValue(''),
        select: vi.fn().mockResolvedValue(''),
        isCancel: vi.fn().mockReturnValue(false),
      };
      _setPromptBackend(backend);

      const result = await confirmStep({ message: 'Proceed?', autoConfirm: true });
      expect(result.confirmed).toBe(true);
      expect(result.wasAutoConfirmed).toBe(true);
      expect(backend.confirm).not.toHaveBeenCalled();

      _resetPromptBackend();
    });

    it('promptText with autoConfirm returns defaultValue immediately', async () => {
      const {
        promptText,
        _setPromptBackend,
        _resetPromptBackend,
      } = await import('./ui/prompt.js');

      const backend = {
        confirm: vi.fn().mockResolvedValue(true),
        text: vi.fn().mockResolvedValue('should not be called'),
        select: vi.fn().mockResolvedValue(''),
        isCancel: vi.fn().mockReturnValue(false),
      };
      _setPromptBackend(backend);

      const result = await promptText({
        message: 'Enter URL:',
        defaultValue: 'http://localhost',
        autoConfirm: true,
      });
      expect(result).toBe('http://localhost');
      expect(backend.text).not.toHaveBeenCalled();

      _resetPromptBackend();
    });

    it('promptSelect with autoConfirm returns first option', async () => {
      const {
        promptSelect,
        _setPromptBackend,
        _resetPromptBackend,
      } = await import('./ui/prompt.js');

      const backend = {
        confirm: vi.fn().mockResolvedValue(true),
        text: vi.fn().mockResolvedValue(''),
        select: vi.fn().mockResolvedValue('should not be called'),
        isCancel: vi.fn().mockReturnValue(false),
      };
      _setPromptBackend(backend);

      const result = await promptSelect({
        message: 'Choose:',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Manual' },
        ],
        autoConfirm: true,
      });
      expect(result).toBe('auto');
      expect(backend.select).not.toHaveBeenCalled();

      _resetPromptBackend();
    });
  });

  describe('--yes with --dry-run combination', () => {
    it('both flags can be set simultaneously', () => {
      const opts = parseArgs(['node', 'index.js', '--yes', '--dry-run']);
      expect(opts.yes).toBe(true);
      expect(opts.dryRun).toBe(true);
    });

    it('sandbox in dry-run mode with no confirmFn returns simulated result', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true, confirmFn: undefined });
      const result = await sandbox.execute('npm', ['install', 'openclaw']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain('npm install openclaw');
      expect(result.duration).toBe(0);
    });

    it('-y with --dry-run uses shorthand correctly', () => {
      const opts = parseArgs(['node', 'index.js', '-y', '--dry-run']);
      expect(opts.yes).toBe(true);
      expect(opts.dryRun).toBe(true);
    });
  });

  describe('help text documents --yes/-y', () => {
    it('help text includes --yes option', () => {
      const text = buildHelpText();
      expect(text).toContain('--yes');
      expect(text).toContain('-y');
    });

    it('help text describes auto-confirm behavior', () => {
      const text = buildHelpText();
      expect(text).toMatch(/auto.?confirm/i);
    });
  });
});

// ============================================================================
// --dry-run preview mode
// ============================================================================

describe('--dry-run preview mode', () => {
  describe('parseArgs sets dryRun flag correctly', () => {
    it('defaults dryRun to false when not specified', () => {
      const opts = parseArgs(['node', 'index.js']);
      expect(opts.dryRun).toBe(false);
    });

    it('--dry-run sets dryRun to true', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run']);
      expect(opts.dryRun).toBe(true);
    });

    it('--dry-run combined with --yes preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', '--yes']);
      expect(opts.dryRun).toBe(true);
      expect(opts.yes).toBe(true);
    });

    it('--dry-run combined with --verbose preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', '--verbose']);
      expect(opts.dryRun).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('--dry-run with software argument preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', 'myapp']);
      expect(opts.dryRun).toBe(true);
      expect(opts.software).toBe('myapp');
    });

    it('--dry-run with --server preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', '--server', 'ws://custom:8080']);
      expect(opts.dryRun).toBe(true);
      expect(opts.serverUrl).toBe('ws://custom:8080');
    });

    it('all flags together with --dry-run', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', '-y', '-v', '--server', 'ws://test:3000', 'myapp']);
      expect(opts.dryRun).toBe(true);
      expect(opts.yes).toBe(true);
      expect(opts.verbose).toBe(true);
      expect(opts.serverUrl).toBe('ws://test:3000');
      expect(opts.software).toBe('myapp');
    });
  });

  describe('help text documents --dry-run', () => {
    it('help text includes --dry-run option', () => {
      const text = buildHelpText();
      expect(text).toContain('--dry-run');
    });

    it('help text describes preview behavior', () => {
      const text = buildHelpText();
      expect(text).toMatch(/preview|dry.?run/i);
    });
  });

  describe('sandbox dry-run behavior', () => {
    it('sandbox in dry-run mode returns simulated result', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('npm', ['install']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain('npm install');
      expect(result.duration).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('sandbox in dry-run mode simulates multiple commands', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true });

      const r1 = await sandbox.execute('node', ['--version']);
      const r2 = await sandbox.execute('npm', ['install', '-g', 'pnpm']);
      const r3 = await sandbox.execute('pnpm', ['install', '-g', 'openclaw']);

      expect(r1.exitCode).toBe(0);
      expect(r1.stdout).toContain('[dry-run] Would execute: node --version');
      expect(r2.stdout).toContain('[dry-run] Would execute: npm install -g pnpm');
      expect(r3.stdout).toContain('[dry-run] Would execute: pnpm install -g openclaw');
    });

    it('sandbox dry-run still validates commands against whitelist', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true, whitelist: ['npm'] });
      await expect(sandbox.execute('rm', ['-rf', '/'])).rejects.toThrow('not in the whitelist');
    });

    it('sandbox dry-run with confirmFn still calls confirmFn', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const confirmFn = vi.fn().mockResolvedValue(true);
      const sandbox = new Sandbox({ dryRun: true, confirmFn });
      const result = await sandbox.execute('npm', ['install']);
      expect(confirmFn).toHaveBeenCalledWith('npm', ['install']);
      expect(result.stdout).toContain('[dry-run]');
    });

    it('sandbox dry-run with denied confirmation throws', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const confirmFn = vi.fn().mockResolvedValue(false);
      const sandbox = new Sandbox({ dryRun: true, confirmFn });
      await expect(sandbox.execute('npm', ['install'])).rejects.toThrow('User denied');
    });

    it('sandbox isDryRun() reflects dry-run state', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const dryRunSandbox = new Sandbox({ dryRun: true });
      const normalSandbox = new Sandbox({ dryRun: false });
      expect(dryRunSandbox.isDryRun()).toBe(true);
      expect(normalSandbox.isDryRun()).toBe(false);
    });

    it('dry-run result command field matches input', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('git', ['clone', 'https://github.com/example/repo.git']);
      expect(result.command).toBe('git clone https://github.com/example/repo.git');
    });

    it('dry-run result for command without args', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('ls');
      expect(result.command).toBe('ls');
      expect(result.stdout).toContain('[dry-run] Would execute: ls');
    });

    it('dry-run result stderr is empty', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true });
      const result = await sandbox.execute('npm', ['install']);
      expect(result.stderr).toBe('');
    });
  });

  describe('formatDryRunPreview', () => {
    it('formats a list of steps with numbered lines', () => {
      const steps: DryRunStep[] = [
        { description: 'Check Node.js version', command: 'node --version' },
        { description: 'Install pnpm', command: 'npm install -g pnpm' },
        { description: 'Install OpenClaw', command: 'pnpm install -g openclaw' },
      ];
      const output = formatDryRunPreview(steps);
      expect(output).toContain('[DRY-RUN]');
      expect(output).toContain('1. Check Node.js version');
      expect(output).toContain('$ node --version');
      expect(output).toContain('2. Install pnpm');
      expect(output).toContain('$ npm install -g pnpm');
      expect(output).toContain('3. Install OpenClaw');
      expect(output).toContain('$ pnpm install -g openclaw');
      expect(output).toContain('No changes were made');
    });

    it('formats empty steps list', () => {
      const output = formatDryRunPreview([]);
      expect(output).toContain('[DRY-RUN]');
      expect(output).toContain('No changes were made');
    });

    it('formats single step', () => {
      const steps: DryRunStep[] = [
        { description: 'Verify installation', command: 'openclaw --version' },
      ];
      const output = formatDryRunPreview(steps);
      expect(output).toContain('1. Verify installation');
      expect(output).toContain('$ openclaw --version');
    });

    it('includes header and footer markers', () => {
      const steps: DryRunStep[] = [
        { description: 'Step A', command: 'echo a' },
      ];
      const output = formatDryRunPreview(steps);
      const lines = output.split('\n');
      expect(lines[0]).toContain('[DRY-RUN] Commands that would be executed');
      expect(lines[lines.length - 1]).toContain('[DRY-RUN] End of preview');
    });
  });

  describe('--dry-run combined with --yes', () => {
    it('sandbox in dry-run mode with no confirmFn returns simulated result', async () => {
      const { Sandbox } = await import('./execute/sandbox.js');
      const sandbox = new Sandbox({ dryRun: true, confirmFn: undefined });
      const result = await sandbox.execute('npm', ['install', 'openclaw']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[dry-run]');
      expect(result.stdout).toContain('npm install openclaw');
      expect(result.duration).toBe(0);
    });
  });

  describe('--dry-run combined with --verbose', () => {
    it('both modes can be active together', () => {
      const opts = parseArgs(['node', 'index.js', '--dry-run', '--verbose']);
      expect(opts.dryRun).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('verbose logger works alongside dry-run sandbox', async () => {
      const { VerboseLogger } = await import('./ui/verbose.js');
      const { Sandbox } = await import('./execute/sandbox.js');

      const writer = vi.fn();
      const logger = new VerboseLogger({ enabled: true, writer, timestamps: false });
      const sandbox = new Sandbox({ dryRun: true });

      const result = await sandbox.execute('npm', ['install']);
      logger.log('sandbox', `Dry-run result: ${result.stdout}`);

      expect(result.stdout).toContain('[dry-run]');
      expect(writer).toHaveBeenCalledTimes(1);
      const output = writer.mock.calls[0][0] as string;
      expect(output).toContain('[SANDBOX]');
      expect(output).toContain('[dry-run]');
    });
  });
});

// ============================================================================
// --version version information
// ============================================================================

describe('--version version information', () => {
  describe('parseArgs sets version flag correctly', () => {
    it('defaults version to false when not specified', () => {
      const opts = parseArgs(['node', 'index.js']);
      expect(opts.version).toBe(false);
    });

    it('--version sets version to true', () => {
      const opts = parseArgs(['node', 'index.js', '--version']);
      expect(opts.version).toBe(true);
    });

    it('--version combined with other flags preserves all', () => {
      const opts = parseArgs(['node', 'index.js', '--version', '--verbose']);
      expect(opts.version).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('--version with software argument preserves both', () => {
      const opts = parseArgs(['node', 'index.js', '--version', 'myapp']);
      expect(opts.version).toBe(true);
      expect(opts.software).toBe('myapp');
    });
  });

  describe('main() --version output', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('returns 0 with --version', async () => {
      const code = await main(['node', 'index.js', '--version']);
      expect(code).toBe(0);
    });

    it('prints agent name and version string', async () => {
      await main(['node', 'index.js', '--version']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toBe(`${AGENT_NAME} v${AGENT_VERSION}`);
    });

    it('version output matches package version', async () => {
      await main(['node', 'index.js', '--version']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('0.1.0');
    });

    it('does not print error output', async () => {
      await main(['node', 'index.js', '--version']);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('--version takes priority over install flow', async () => {
      // --version should exit immediately without connecting to server
      const code = await main(['node', 'index.js', '--version', '--server', 'ws://nonexistent:9999']);
      expect(code).toBe(0);
    });

    it('--help takes priority over --version when both specified', async () => {
      const code = await main(['node', 'index.js', '--help', '--version']);
      expect(code).toBe(0);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      // --help is checked first in main(), so help text should be printed
      expect(output).toContain('Usage:');
    });
  });

  describe('help text documents --version', () => {
    it('help text includes --version option', () => {
      const text = buildHelpText();
      expect(text).toContain('--version');
    });

    it('help text describes version behavior', () => {
      const text = buildHelpText();
      expect(text).toMatch(/version/i);
    });
  });
});
