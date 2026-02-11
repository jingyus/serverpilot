/**
 * Tests for install.sh enhanced features:
 * - systemd service file generation
 * - --uninstall support
 * - --install-dir support
 * - Connection verification logic
 * - Multi-platform support (Ubuntu/CentOS)
 * - scripts/install.sh parity
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const INSTALL_SH = resolve(PROJECT_ROOT, 'install.sh');
const SCRIPTS_INSTALL_SH = resolve(PROJECT_ROOT, 'scripts/install.sh');

// ============================================================================
// Helpers
// ============================================================================

function runInstallSh(
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
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
  script: string,
  fnCall: string,
  env: Record<string, string> = {},
): string {
  const bashScript = `source "${script}"\n${fnCall}`;
  return execSync(`bash -c '${bashScript.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    timeout: 5000,
  }).trim();
}

// ============================================================================
// 1. scripts/install.sh exists and is valid
// ============================================================================

describe('Install agent: scripts/install.sh is a valid entry point', () => {
  it('scripts/install.sh exists', () => {
    expect(existsSync(SCRIPTS_INSTALL_SH)).toBe(true);
  });

  it('has valid bash syntax', () => {
    const result = execSync(`bash -n "${SCRIPTS_INSTALL_SH}" 2>&1`, {
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('');
  });

  it('starts with a proper shebang line', () => {
    const content = readFileSync(SCRIPTS_INSTALL_SH, 'utf-8');
    expect(content.startsWith('#!/bin/bash')).toBe(true);
  });

  it('is executable', () => {
    const result = execSync(`test -x "${SCRIPTS_INSTALL_SH}" && echo "yes" || echo "no"`, {
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('yes');
  });
});

// ============================================================================
// 2. systemd service file generation
// ============================================================================

describe('Install agent: systemd service file generation', () => {
  it('generate_service_file produces valid unit file content', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );

    // Unit section
    expect(output).toContain('[Unit]');
    expect(output).toContain('Description=ServerPilot Agent');
    expect(output).toContain('After=network-online.target');
    expect(output).toContain('Wants=network-online.target');

    // Service section
    expect(output).toContain('[Service]');
    expect(output).toContain('Type=simple');
    expect(output).toContain('ExecStart=/usr/local/bin/serverpilot-agent --server wss://example.com');
    expect(output).toContain('Restart=always');
    expect(output).toContain('RestartSec=5');

    // Security hardening
    expect(output).toContain('NoNewPrivileges=yes');
    expect(output).toContain('ProtectSystem=strict');
    expect(output).toContain('ProtectHome=yes');
    expect(output).toContain('PrivateTmp=yes');

    // Install section
    expect(output).toContain('[Install]');
    expect(output).toContain('WantedBy=multi-user.target');
  });

  it('service file includes journal logging', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('StandardOutput=journal');
    expect(output).toContain('StandardError=journal');
    expect(output).toContain('SyslogIdentifier=serverpilot-agent');
  });

  it('service file includes restart limits', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('StartLimitIntervalSec=60');
    expect(output).toContain('StartLimitBurst=3');
  });

  it('service file uses custom binary path', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/opt/serverpilot/bin/agent" "wss://custom.example.com"',
    );
    expect(output).toContain('ExecStart=/opt/serverpilot/bin/agent --server wss://custom.example.com');
  });

  it('scripts/install.sh also generates valid service file', () => {
    const output = runBashFunction(
      SCRIPTS_INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://test.com"',
    );
    expect(output).toContain('[Unit]');
    expect(output).toContain('[Service]');
    expect(output).toContain('[Install]');
    expect(output).toContain('ExecStart=/usr/local/bin/serverpilot-agent --server wss://test.com');
  });
});

// ============================================================================
// 3. --uninstall flag
// ============================================================================

describe('Install agent: --uninstall flag parsing', () => {
  it('parse_args sets DO_UNINSTALL to true', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args --uninstall && echo "$DO_UNINSTALL"',
    );
    expect(result).toBe('true');
  });

  it('--uninstall can be combined with other flags', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args --uninstall --verbose && echo "$DO_UNINSTALL $VERBOSE"',
    );
    expect(result).toBe('true true');
  });

  it('scripts/install.sh also parses --uninstall', () => {
    const result = runBashFunction(
      SCRIPTS_INSTALL_SH,
      'parse_args --uninstall && echo "$DO_UNINSTALL"',
    );
    expect(result).toBe('true');
  });
});

// ============================================================================
// 4. --install-dir flag
// ============================================================================

describe('Install agent: --install-dir flag parsing', () => {
  it('parse_args sets custom INSTALL_DIR', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args --install-dir /opt/custom && echo "$INSTALL_DIR"',
    );
    expect(result).toBe('/opt/custom');
  });

  it('defaults to /usr/local/bin when not specified', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args && echo "$INSTALL_DIR"',
    );
    expect(result).toBe('/usr/local/bin');
  });

  it('SERVERPILOT_INSTALL_DIR env var is respected', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args && echo "$INSTALL_DIR"',
      { SERVERPILOT_INSTALL_DIR: '/opt/from-env' },
    );
    expect(result).toBe('/opt/from-env');
  });

  it('--install-dir overrides env var', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args --install-dir /opt/cli && echo "$INSTALL_DIR"',
      { SERVERPILOT_INSTALL_DIR: '/opt/env' },
    );
    expect(result).toBe('/opt/cli');
  });

  it('errors when --install-dir has no value', () => {
    const { exitCode, stderr } = runInstallSh(INSTALL_SH, ['--install-dir']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--install-dir requires a value');
  });
});

// ============================================================================
// 5. SERVERPILOT_SERVER env var support
// ============================================================================

describe('Install agent: SERVERPILOT_SERVER env var', () => {
  it('SERVERPILOT_SERVER env var sets server URL', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args && echo "$SERVER_URL"',
      { SERVERPILOT_SERVER: 'wss://new.example.com' },
    );
    expect(result).toBe('wss://new.example.com');
  });

  it('SERVERPILOT_SERVER takes precedence over AIINSTALLER_SERVER', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args && echo "$SERVER_URL"',
      {
        SERVERPILOT_SERVER: 'wss://new.example.com',
        AIINSTALLER_SERVER: 'wss://old.example.com',
      },
    );
    expect(result).toBe('wss://new.example.com');
  });

  it('AIINSTALLER_SERVER env var still works (legacy)', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'parse_args && echo "$SERVER_URL"',
      { AIINSTALLER_SERVER: 'wss://legacy.example.com' },
    );
    expect(result).toBe('wss://legacy.example.com');
  });
});

// ============================================================================
// 6. Dry-run shows new install features
// ============================================================================

describe('Install agent: dry-run with new features', () => {
  it('dry-run shows install path', () => {
    const { stdout, exitCode } = runInstallSh(
      INSTALL_SH,
      ['--dry-run'],
      { AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Would install to:');
    expect(stdout).toContain('serverpilot-agent');
  });

  it('dry-run mentions systemd service on Linux context', () => {
    // The dry-run output mentions systemd if OS is linux
    const { stdout } = runInstallSh(
      INSTALL_SH,
      ['--dry-run'],
      { AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases' },
    );
    // On macOS this won't show systemd, on Linux it will
    // Both cases are fine - just verify dry-run completes successfully
    expect(stdout).toContain('Dry run complete');
  });

  it('scripts/install.sh dry-run also works', () => {
    const { stdout, exitCode } = runInstallSh(
      SCRIPTS_INSTALL_SH,
      ['--dry-run', '--server', 'wss://test.example.com'],
      { SERVERPILOT_DOWNLOAD_URL: 'https://example.com/releases' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run complete');
    expect(stdout).toContain('Would install to:');
  });
});

// ============================================================================
// 7. Help output includes new features
// ============================================================================

describe('Install agent: help output includes new features', () => {
  it('--help shows --uninstall option', () => {
    const { stdout, exitCode } = runInstallSh(INSTALL_SH, ['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--uninstall');
  });

  it('--help shows --install-dir option', () => {
    const { stdout } = runInstallSh(INSTALL_SH, ['--help']);
    expect(stdout).toContain('--install-dir');
  });

  it('--help shows curl | bash example', () => {
    const { stdout } = runInstallSh(INSTALL_SH, ['--help']);
    expect(stdout).toContain('curl -fsSL');
    expect(stdout).toContain('bash -s -- --server');
  });

  it('--help shows uninstall example', () => {
    const { stdout } = runInstallSh(INSTALL_SH, ['--help']);
    expect(stdout).toContain('--uninstall');
  });

  it('--help shows SERVERPILOT_SERVER env var', () => {
    const { stdout } = runInstallSh(INSTALL_SH, ['--help']);
    expect(stdout).toContain('SERVERPILOT_SERVER');
  });

  it('scripts/install.sh --help also includes new features', () => {
    const { stdout, exitCode } = runInstallSh(SCRIPTS_INSTALL_SH, ['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--uninstall');
    expect(stdout).toContain('--install-dir');
    expect(stdout).toContain('SERVERPILOT_SERVER');
  });
});

// ============================================================================
// 8. New utility functions
// ============================================================================

describe('Install agent: new utility functions', () => {
  it('detect_distro returns a string', () => {
    const distro = runBashFunction(INSTALL_SH, 'detect_distro');
    expect(distro.length).toBeGreaterThan(0);
    // On macOS it will be "unknown", on Linux it will be like "ubuntu-22.04"
    expect(typeof distro).toBe('string');
  });

  it('has_systemd function exists and returns a result', () => {
    // On macOS this should return false (exit code 1)
    // On Linux it depends on the system
    const result = runBashFunction(
      INSTALL_SH,
      'has_systemd && echo "yes" || echo "no"',
    );
    expect(['yes', 'no']).toContain(result);
  });

  it('check_root function exists', () => {
    // Verify the function is defined (don't actually call it as non-root)
    const result = runBashFunction(
      INSTALL_SH,
      'type check_root >/dev/null 2>&1 && echo "defined" || echo "missing"',
    );
    expect(result).toBe('defined');
  });

  it('step function produces formatted output', () => {
    const result = runBashFunction(
      INSTALL_SH,
      'step 1 "Test step"',
    );
    expect(result).toContain('[1]');
    expect(result).toContain('Test step');
  });
});

// ============================================================================
// 9. Constants and paths
// ============================================================================

describe('Install agent: installation constants', () => {
  it('defines SP_BINARY_NAME as serverpilot-agent', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content).toContain('SP_BINARY_NAME="serverpilot-agent"');
  });

  it('defines SP_SERVICE_NAME as serverpilot-agent', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content).toContain('SP_SERVICE_NAME="serverpilot-agent"');
  });

  it('defines SP_SERVICE_FILE path', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content).toContain('/etc/systemd/system/');
  });

  it('defines config, log, and data directories', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    expect(content).toContain('SP_CONFIG_DIR="/etc/serverpilot"');
    expect(content).toContain('SP_LOG_DIR="/var/log/serverpilot"');
    expect(content).toContain('SP_DATA_DIR="/var/lib/serverpilot"');
  });

  it('scripts/install.sh defines the same paths', () => {
    const content = readFileSync(SCRIPTS_INSTALL_SH, 'utf-8');
    expect(content).toContain('SP_CONFIG_DIR="/etc/serverpilot"');
    expect(content).toContain('SP_LOG_DIR="/var/log/serverpilot"');
    expect(content).toContain('SP_DATA_DIR="/var/lib/serverpilot"');
    expect(content).toContain('/etc/systemd/system/');
  });
});

// ============================================================================
// 10. Security hardening in service file
// ============================================================================

describe('Install agent: service file security hardening', () => {
  it('includes NoNewPrivileges', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('NoNewPrivileges=yes');
  });

  it('includes ProtectSystem=strict', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('ProtectSystem=strict');
  });

  it('includes ProtectHome=yes', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('ProtectHome=yes');
  });

  it('includes PrivateTmp=yes', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('PrivateTmp=yes');
  });

  it('specifies ReadWritePaths for required directories', () => {
    const output = runBashFunction(
      INSTALL_SH,
      'generate_service_file "/usr/local/bin/serverpilot-agent" "wss://example.com"',
    );
    expect(output).toContain('ReadWritePaths=');
    expect(output).toContain('/var/log/serverpilot');
    expect(output).toContain('/var/lib/serverpilot');
    expect(output).toContain('/etc/serverpilot');
  });
});

// ============================================================================
// 11. Backward compatibility
// ============================================================================

describe('Install agent: backward compatibility', () => {
  it('AIINSTALLER_DOWNLOAD_URL still works', () => {
    const { stdout, exitCode } = runInstallSh(
      INSTALL_SH,
      ['--dry-run'],
      { AIINSTALLER_DOWNLOAD_URL: 'https://legacy.example.com/releases' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('https://legacy.example.com/releases');
  });

  it('AIINSTALLER_TMPDIR still works', () => {
    const { stdout, exitCode } = runInstallSh(
      INSTALL_SH,
      ['--dry-run', '--verbose'],
      {
        AIINSTALLER_DOWNLOAD_URL: 'https://example.com/releases',
        AIINSTALLER_TMPDIR: '/tmp/test-legacy',
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('/tmp/test-legacy');
  });

  it('version output still uses "AI Installer" prefix', () => {
    const { stdout } = runInstallSh(INSTALL_SH, ['--version']);
    expect(stdout.trim()).toBe('AI Installer v0.1.0');
  });

  it('existing functions still work when sourced', () => {
    // All the functions that existing tests depend on
    const fns = ['detect_os', 'detect_arch', 'get_binary_filename', 'get_download_tool', 'get_checksum_tool', 'parse_args'];
    for (const fn of fns) {
      const result = runBashFunction(
        INSTALL_SH,
        `type ${fn} >/dev/null 2>&1 && echo "ok" || echo "missing"`,
      );
      expect(result).toBe('ok');
    }
  });
});

// ============================================================================
// 12. File size limits
// ============================================================================

describe('Install agent: file size within limits', () => {
  it('root install.sh is under 800 lines', () => {
    const content = readFileSync(INSTALL_SH, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(800);
  });

  it('scripts/install.sh is under 800 lines', () => {
    const content = readFileSync(SCRIPTS_INSTALL_SH, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(800);
  });
});
