/**
 * Acceptance test: "用户能通过一键命令安装软件"
 *
 * Validates the complete one-click install flow:
 * 1. install.sh is a valid, executable bash script
 * 2. install.sh detects the platform and constructs the correct binary URL
 * 3. install.sh supports dry-run mode for safe preview
 * 4. install.sh passes CLI arguments through to the agent binary
 * 5. The agent CLI can parse arguments and run the install flow
 * 6. The agent can connect to a server, receive a plan, and execute steps
 *
 * The one-click command:
 *   curl -fsSL https://get.aiinstaller.dev/install.sh | bash
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const INSTALL_SH = resolve(PROJECT_ROOT, 'install.sh');

// ============================================================================
// Helper: run install.sh
// ============================================================================

function runInstallSh(
  args: string[] = [],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('bash', [INSTALL_SH, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1', ...env },
      timeout: 10000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

function runBashFunction(
  fnCall: string,
  env: Record<string, string> = {},
): string {
  const script = `source "${INSTALL_SH}"\n${fnCall}`;
  return execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    timeout: 5000,
  }).trim();
}

// ============================================================================
// 1. install.sh exists and is valid
// ============================================================================

describe('One-click install: install.sh is a valid entry point', () => {
  it('install.sh exists at the project root', () => {
    expect(existsSync(INSTALL_SH)).toBe(true);
  });

  it('has valid bash syntax (no parse errors)', () => {
    const result = execSync(`bash -n "${INSTALL_SH}" 2>&1`, {
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('');
  });

  it('starts with a proper shebang line', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content.startsWith('#!/bin/bash')).toBe(true);
  });

  it('contains the one-click usage instruction in comments', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content).toContain('curl -fsSL');
    expect(content).toContain('install.sh');
    expect(content).toContain('bash');
  });
});

// ============================================================================
// 2. Platform detection works correctly
// ============================================================================

describe('One-click install: platform detection', () => {
  it('detects current OS as linux or darwin', () => {
    const os = runBashFunction('detect_os');
    expect(['linux', 'darwin']).toContain(os);
  });

  it('detects current architecture as x64 or arm64', () => {
    const arch = runBashFunction('detect_arch');
    expect(['x64', 'arm64']).toContain(arch);
  });

  it('constructs the correct binary filename for current platform', () => {
    const os = runBashFunction('detect_os');
    const arch = runBashFunction('detect_arch');
    const filename = runBashFunction(`get_binary_filename "${os}" "${arch}"`);
    expect(filename).toBe(`install-agent-${os}-${arch}`);
  });

  it('generates filenames for all supported platforms', () => {
    const platforms = [
      { os: 'darwin', arch: 'arm64' },
      { os: 'darwin', arch: 'x64' },
      { os: 'linux', arch: 'x64' },
      { os: 'linux', arch: 'arm64' },
    ];

    for (const { os, arch } of platforms) {
      const filename = runBashFunction(`get_binary_filename "${os}" "${arch}"`);
      expect(filename).toBe(`install-agent-${os}-${arch}`);
    }
  });
});

// ============================================================================
// 3. Download tool detection
// ============================================================================

describe('One-click install: download tool availability', () => {
  it('detects curl or wget as the download tool', () => {
    const tool = runBashFunction('get_download_tool');
    expect(['curl', 'wget']).toContain(tool);
  });

  it('detects sha256sum or shasum for checksum verification', () => {
    const tool = runBashFunction('get_checksum_tool');
    expect(['sha256sum', 'shasum']).toContain(tool);
  });
});

// ============================================================================
// 4. Dry-run mode: safe preview without side effects
// ============================================================================

describe('One-click install: dry-run mode', () => {
  it('exits 0 and prints preview in dry-run mode', () => {
    const { stdout, exitCode } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('Dry run complete');
  });

  it('shows the download URL that would be used', () => {
    const { stdout } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
    });
    expect(stdout).toContain('https://example.com/releases');
  });

  it('shows platform detection result', () => {
    const { stdout } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
    });
    expect(stdout).toContain('Detected platform:');
  });

  it('does not actually download anything', () => {
    // Use an unreachable URL; if it tried to download, it would fail
    const { exitCode } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://localhost:19999/does-not-exist',
    });
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// 5. CLI argument passthrough
// ============================================================================

describe('One-click install: CLI argument handling', () => {
  it('--version prints version and exits 0', () => {
    const { stdout, exitCode } = runInstallSh(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('AI Installer v');
  });

  it('--help prints usage info and exits 0', () => {
    const { stdout, exitCode } = runInstallSh(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--server');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--verbose');
    expect(stdout).toContain('--yes');
  });

  it('--server flag is parsed correctly', () => {
    const url = runBashFunction(
      'parse_args --server wss://custom.example.com && echo "$SERVER_URL"',
    );
    expect(url).toBe('wss://custom.example.com');
  });

  it('AIINSTALLER_SERVER env var is respected', () => {
    const url = runBashFunction('parse_args && echo "$SERVER_URL"', {
      AIINSTALLER_SERVER: 'wss://env.example.com',
    });
    expect(url).toBe('wss://env.example.com');
  });

  it('--dry-run, --verbose, --yes flags are accumulated into AGENT_ARGS', () => {
    const result = runBashFunction(
      'parse_args --dry-run --verbose --yes && echo "${AGENT_ARGS[@]}"',
    );
    expect(result).toContain('--dry-run');
    expect(result).toContain('--verbose');
    expect(result).toContain('--yes');
  });

  it('errors when --server has no value', () => {
    const { stderr, exitCode } = runInstallSh(['--server']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--server requires a value');
  });
});

// ============================================================================
// 6. Agent CLI integration
// ============================================================================

describe('One-click install: agent CLI integration', () => {
  it('agent parseArgs returns correct defaults', async () => {
    const { parseArgs } = await import('../packages/agent/src/index.js');
    const opts = parseArgs(['node', 'index.js']);
    expect(opts.software).toBe('openclaw');
    expect(opts.serverUrl).toBe('ws://localhost:3000');
    expect(opts.yes).toBe(false);
    expect(opts.verbose).toBe(false);
    expect(opts.dryRun).toBe(false);
    expect(opts.offline).toBe(false);
  });

  it('agent parseArgs supports all install.sh passthrough flags', async () => {
    const { parseArgs } = await import('../packages/agent/src/index.js');
    const opts = parseArgs([
      'node', 'index.js',
      '--server', 'wss://api.aiinstaller.dev',
      '--dry-run',
      '--verbose',
      '--yes',
    ]);
    expect(opts.serverUrl).toBe('wss://api.aiinstaller.dev');
    expect(opts.dryRun).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.yes).toBe(true);
  });

  it('agent --help returns 0', async () => {
    const { main } = await import('../packages/agent/src/index.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['node', 'index.js', '--help']);
    expect(code).toBe(0);
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Usage:');
    consoleSpy.mockRestore();
  });

  it('agent --version returns 0', async () => {
    const { main, AGENT_VERSION } = await import('../packages/agent/src/index.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['node', 'index.js', '--version']);
    expect(code).toBe(0);
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(AGENT_VERSION);
    consoleSpy.mockRestore();
  });

  it('agent --offline mode performs environment detection without server', async () => {
    const { main } = await import('../packages/agent/src/index.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['node', 'index.js', '--offline']);
    expect(code).toBe(0);
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('OFFLINE MODE');
    consoleSpy.mockRestore();
  });
});

// ============================================================================
// 7. Environment detection
// ============================================================================

describe('One-click install: environment detection', () => {
  it('detectEnvironment returns valid EnvironmentInfo', async () => {
    const { detectEnvironment } = await import('../packages/agent/src/detect/index.js');
    const env = detectEnvironment();

    expect(env).toBeDefined();
    expect(env.os).toBeDefined();
    expect(env.os.platform).toBeDefined();
    expect(env.os.arch).toBeDefined();
    expect(env.shell).toBeDefined();
    expect(env.runtime).toBeDefined();
    expect(env.packageManagers).toBeDefined();
    expect(env.network).toBeDefined();
  });

  it('detects the current platform correctly', async () => {
    const { detectEnvironment } = await import('../packages/agent/src/detect/index.js');
    const env = detectEnvironment();

    expect(['darwin', 'linux', 'win32']).toContain(env.os.platform);
    expect(['x64', 'arm64', 'ia32']).toContain(env.os.arch);
  });
});

// ============================================================================
// 8. End-to-end: install.sh → agent flow (simulated)
// ============================================================================

describe('One-click install: end-to-end flow validation', () => {
  it('install.sh dry-run shows the complete flow: detect → download → run', () => {
    const { stdout, exitCode } = runInstallSh(['--dry-run', '--verbose'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://github.com/aiinstaller/aiinstaller/releases/latest/download',
    });

    expect(exitCode).toBe(0);

    // Step 1: Platform detection
    expect(stdout).toContain('Detected platform:');

    // Step 2: Download tool detection
    expect(stdout).toContain('Download tool:');

    // Step 3: Server URL shown
    expect(stdout).toContain('Server URL:');

    // Step 4: Temp directory shown
    expect(stdout).toContain('Temp directory:');

    // Step 5: Download URL shown
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('Would download:');

    // Step 6: Dry-run complete
    expect(stdout).toContain('Dry run complete');
  });

  it('install.sh constructs correct GitHub Releases download URL', () => {
    const { stdout } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://github.com/aiinstaller/aiinstaller/releases/latest/download',
    });

    const os = runBashFunction('detect_os');
    const arch = runBashFunction('detect_arch');
    const expectedFilename = `install-agent-${os}-${arch}`;

    expect(stdout).toContain(expectedFilename);
    expect(stdout).toContain('github.com/aiinstaller/aiinstaller/releases');
  });

  it('default server URL is wss://api.aiinstaller.dev', () => {
    const { stdout } = runInstallSh(['--dry-run', '--verbose']);
    expect(stdout).toContain('wss://api.aiinstaller.dev');
  });

  it('supports custom server URL via --server flag', () => {
    const url = runBashFunction(
      'parse_args --server wss://custom.example.com && echo "$SERVER_URL"',
    );
    expect(url).toBe('wss://custom.example.com');
  });

  it('formatDryRunPreview shows numbered steps with commands', async () => {
    const { formatDryRunPreview } = await import('../packages/agent/src/index.js');
    const steps = [
      { description: 'Check prerequisites', command: 'node --version' },
      { description: 'Install package manager', command: 'npm install -g pnpm' },
      { description: 'Install OpenClaw', command: 'pnpm install -g openclaw' },
    ];
    const preview = formatDryRunPreview(steps);

    expect(preview).toContain('[DRY-RUN]');
    expect(preview).toContain('1. Check prerequisites');
    expect(preview).toContain('$ node --version');
    expect(preview).toContain('2. Install package manager');
    expect(preview).toContain('$ npm install -g pnpm');
    expect(preview).toContain('3. Install OpenClaw');
    expect(preview).toContain('$ pnpm install -g openclaw');
  });
});

// ============================================================================
// 9. Error handling
// ============================================================================

describe('One-click install: error handling', () => {
  it('gracefully fails when binary URL is unreachable', () => {
    const { exitCode } = runInstallSh([], {
      AIINSTALLER_DOWNLOAD_URL: 'https://localhost:19999/nonexistent',
    });
    expect(exitCode).not.toBe(0);
  });

  it('agent returns exit code 1 on invalid arguments', async () => {
    const { main } = await import('../packages/agent/src/index.js');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['node', 'index.js', '--invalid-flag']);
    expect(code).toBe(1);
    consoleErrorSpy.mockRestore();
  });

  it('agent returns exit code 1 when --server is missing URL value', async () => {
    const { main } = await import('../packages/agent/src/index.js');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // --server without a URL triggers an immediate error (no network wait)
    const code = await main(['node', 'index.js', '--server']);
    expect(code).toBe(1);

    consoleErrorSpy.mockRestore();
  });
});

// ============================================================================
// 10. NO_COLOR support
// ============================================================================

describe('One-click install: terminal compatibility', () => {
  it('suppresses ANSI escape codes when NO_COLOR is set', () => {
    const { stdout } = runInstallSh(['--version'], { NO_COLOR: '1' });
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  });

  it('version output is clean without color codes', () => {
    const { stdout } = runInstallSh(['--version'], { NO_COLOR: '1' });
    expect(stdout.trim()).toBe('AI Installer v0.1.0');
  });
});
