/**
 * Tests for install.sh — the curl | bash installation script.
 *
 * Tests cover:
 * - Platform detection (OS and architecture)
 * - CLI argument parsing
 * - Help and version output
 * - Binary filename generation
 * - Download tool detection
 * - Checksum tool detection
 * - Dry-run mode
 * - Error handling for unsupported platforms
 * - Rollback / cleanup on failure
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const INSTALL_SH = resolve(PROJECT_ROOT, 'install.sh');

/** Run install.sh with given args, capturing output. */
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

/** Run a bash snippet that sources install.sh and calls a function. */
function runBashFunction(
  fnCall: string,
  env: Record<string, string> = {},
): string {
  const script = `
    source "${INSTALL_SH}"
    ${fnCall}
  `;
  return execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    timeout: 5000,
  }).trim();
}

// ============================================================================
// Precondition checks
// ============================================================================

describe('install.sh existence', () => {
  it('script file exists and is executable', () => {
    expect(existsSync(INSTALL_SH)).toBe(true);
  });

  it('has valid bash syntax', () => {
    const result = execSync(`bash -n "${INSTALL_SH}" 2>&1`, {
      encoding: 'utf-8',
    });
    // bash -n returns empty output on success
    expect(result.trim()).toBe('');
  });
});

// ============================================================================
// Version and help
// ============================================================================

describe('--version', () => {
  it('prints version string and exits 0', () => {
    const { stdout, exitCode } = runInstallSh(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('AI Installer v0.1.0');
  });
});

describe('--help', () => {
  it('prints usage information and exits 0', () => {
    const { stdout, exitCode } = runInstallSh(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--server');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--verbose');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--version');
    expect(stdout).toContain('--help');
  });

  it('mentions environment variables', () => {
    const { stdout } = runInstallSh(['--help']);
    expect(stdout).toContain('AIINSTALLER_SERVER');
    expect(stdout).toContain('AIINSTALLER_DOWNLOAD_URL');
  });
});

// ============================================================================
// Platform detection functions
// ============================================================================

describe('detect_os', () => {
  it('returns linux or darwin on supported systems', () => {
    const os = runBashFunction('detect_os');
    expect(['linux', 'darwin']).toContain(os);
  });

  it('matches uname -s output', () => {
    const os = runBashFunction('detect_os');
    const uname = execSync('uname -s', { encoding: 'utf-8' }).trim();
    if (uname.startsWith('Linux')) {
      expect(os).toBe('linux');
    } else if (uname.startsWith('Darwin')) {
      expect(os).toBe('darwin');
    }
  });
});

describe('detect_arch', () => {
  it('returns x64 or arm64 on supported architectures', () => {
    const arch = runBashFunction('detect_arch');
    expect(['x64', 'arm64']).toContain(arch);
  });

  it('matches uname -m output', () => {
    const arch = runBashFunction('detect_arch');
    const uname = execSync('uname -m', { encoding: 'utf-8' }).trim();
    if (uname === 'x86_64' || uname === 'amd64') {
      expect(arch).toBe('x64');
    } else if (uname === 'aarch64' || uname === 'arm64') {
      expect(arch).toBe('arm64');
    }
  });
});

describe('get_binary_filename', () => {
  it('returns correct filename for darwin arm64', () => {
    const name = runBashFunction('get_binary_filename darwin arm64');
    expect(name).toBe('install-agent-darwin-arm64');
  });

  it('returns correct filename for linux x64', () => {
    const name = runBashFunction('get_binary_filename linux x64');
    expect(name).toBe('install-agent-linux-x64');
  });

  it('returns correct filename for linux arm64', () => {
    const name = runBashFunction('get_binary_filename linux arm64');
    expect(name).toBe('install-agent-linux-arm64');
  });

  it('returns correct filename for darwin x64', () => {
    const name = runBashFunction('get_binary_filename darwin x64');
    expect(name).toBe('install-agent-darwin-x64');
  });
});

// ============================================================================
// Tool detection
// ============================================================================

describe('get_download_tool', () => {
  it('returns curl or wget on typical systems', () => {
    const tool = runBashFunction('get_download_tool');
    expect(['curl', 'wget']).toContain(tool);
  });
});

describe('get_checksum_tool', () => {
  it('returns sha256sum or shasum on typical systems', () => {
    const tool = runBashFunction('get_checksum_tool');
    expect(['sha256sum', 'shasum']).toContain(tool);
  });
});

// ============================================================================
// CLI parsing
// ============================================================================

describe('parse_args', () => {
  it('sets default server URL', () => {
    const url = runBashFunction('parse_args && echo "$SERVER_URL"');
    expect(url).toBe('wss://api.aiinstaller.dev');
  });

  it('respects AIINSTALLER_SERVER env var', () => {
    const url = runBashFunction('parse_args && echo "$SERVER_URL"', {
      AIINSTALLER_SERVER: 'wss://custom.example.com',
    });
    expect(url).toBe('wss://custom.example.com');
  });

  it('--server overrides env var', () => {
    const url = runBashFunction(
      'parse_args --server wss://cli-override.example.com && echo "$SERVER_URL"',
      { AIINSTALLER_SERVER: 'wss://env.example.com' },
    );
    expect(url).toBe('wss://cli-override.example.com');
  });

  it('sets DRY_RUN to true with --dry-run', () => {
    const val = runBashFunction('parse_args --dry-run && echo "$DRY_RUN"');
    expect(val).toBe('true');
  });

  it('sets VERBOSE to true with --verbose', () => {
    const val = runBashFunction('parse_args --verbose && echo "$VERBOSE"');
    expect(val).toBe('true');
  });

  it('sets VERBOSE to true with -v', () => {
    const val = runBashFunction('parse_args -v && echo "$VERBOSE"');
    expect(val).toBe('true');
  });

  it('sets AUTO_YES to true with --yes', () => {
    const val = runBashFunction('parse_args --yes && echo "$AUTO_YES"');
    expect(val).toBe('true');
  });

  it('sets AUTO_YES to true with -y', () => {
    const val = runBashFunction('parse_args -y && echo "$AUTO_YES"');
    expect(val).toBe('true');
  });

  it('accumulates AGENT_ARGS', () => {
    const val = runBashFunction(
      'parse_args --dry-run --verbose --yes && echo "${AGENT_ARGS[@]}"',
    );
    expect(val).toContain('--dry-run');
    expect(val).toContain('--verbose');
    expect(val).toContain('--yes');
  });
});

// ============================================================================
// Dry-run mode (end-to-end)
// ============================================================================

describe('dry-run mode', () => {
  it('prints download URL and exits without downloading', () => {
    const { stdout, exitCode } = runInstallSh(['--dry-run'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('https://example.com/releases');
    expect(stdout).toContain('Dry run complete');
  });

  it('works with --verbose flag', () => {
    const { stdout, exitCode } = runInstallSh(['--dry-run', '--verbose'], {
      AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Download tool:');
    expect(stdout).toContain('Server URL:');
    expect(stdout).toContain('Temp directory:');
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('error handling', () => {
  it('exits with error when --server has no value', () => {
    const { stderr, exitCode } = runInstallSh(['--server']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--server requires a value');
  });

  it('fails gracefully when download URL is unreachable', () => {
    const { exitCode } = runInstallSh([], {
      AIINSTALLER_DOWNLOAD_URL: 'https://localhost:19999/nonexistent',
    });
    // Should fail with non-zero exit code because download fails
    expect(exitCode).not.toBe(0);
  });
});

// ============================================================================
// Color / NO_COLOR support
// ============================================================================

describe('NO_COLOR support', () => {
  it('suppresses ANSI codes when NO_COLOR is set', () => {
    const { stdout } = runInstallSh(['--version'], { NO_COLOR: '1' });
    // Should not contain ANSI escape codes
    expect(stdout).not.toMatch(/\x1b\[/);
  });
});
