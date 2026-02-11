// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for network error handling in the AI Installer agent.
 *
 * Verifies that connection failures are properly detected, formatted,
 * and presented to users with actionable guidance.
 *
 * @module index-network-errors.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

import { parseArgs, runInstall, buildHelpText, AGENT_NAME, AGENT_VERSION } from './index.js';
import { InstallClient } from './client.js';
import { AuthenticatedClient } from './authenticated-client.js';
import { detectEnvironment } from './detect/index.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('./client.js');
vi.mock('./authenticated-client.js');
vi.mock('./detect/index.js');
vi.mock('./ui/table.js', () => ({
  displayEnvironmentInfo: vi.fn(() => 'Environment Info'),
  displayInstallPlan: vi.fn(() => 'Install Plan'),
}));
vi.mock('./ui/error-messages.js', () => ({
  formatPlainErrorFromOutput: vi.fn((stderr: string) => ({
    title: 'Connection failed',
    explanation: `Network error: ${stderr}`,
    severity: 'high' as const,
    category: 'network' as const,
    technicalDetail: stderr,
    nextSteps: [
      'Check your internet connection',
      'Verify the server URL is correct',
      'Try running with --offline for environment detection only',
    ],
    helpLinks: [],
  })),
  renderHighlightedError: vi.fn((msg) => `[ERROR] ${msg.title}: ${msg.explanation}`),
}));

// ============================================================================
// Test suites
// ============================================================================

describe('CLI argument parsing - offline mode', () => {
  it('should parse --offline flag', () => {
    const options = parseArgs(['node', 'script.js', 'openclaw', '--offline']);
    expect(options.offline).toBe(true);
    expect(options.software).toBe('openclaw');
  });

  it('should default offline to false', () => {
    const options = parseArgs(['node', 'script.js', 'openclaw']);
    expect(options.offline).toBe(false);
  });

  it('should combine --offline with other flags', () => {
    const options = parseArgs(['node', 'script.js', '--offline', '--verbose', '-y']);
    expect(options.offline).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.yes).toBe(true);
  });
});

describe('Help text - offline mode', () => {
  it('should include --offline flag in help text', () => {
    const helpText = buildHelpText();
    expect(helpText).toContain('--offline');
    expect(helpText).toContain('Offline mode');
  });
});

describe('Network error handling', () => {
  let mockClient: {
    connectAndAuth: Mock;
    disconnect: Mock;
    send: Mock;
    waitFor: Mock;
    on: Mock;
    getAuthState: Mock;
  };

  let mockEnvironment: ReturnType<typeof detectEnvironment>;
  let consoleLogSpy: Mock;
  let consoleErrorSpy: Mock;

  beforeEach(() => {
    // Mock AuthenticatedClient (used by runInstall instead of InstallClient)
    mockClient = {
      connectAndAuth: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      waitFor: vi.fn(),
      on: vi.fn(),
      getAuthState: vi.fn(() => ({ authenticated: true })),
    };
    (AuthenticatedClient as unknown as Mock).mockImplementation(() => mockClient);

    // Mock detectEnvironment
    mockEnvironment = {
      os: { platform: 'darwin', arch: 'arm64', version: '14.0.0' },
      shell: { type: 'zsh', path: '/bin/zsh' },
      runtime: { node: '22.0.0', npm: '10.0.0' },
      packageManagers: { npm: { version: '10.0.0', path: '/usr/local/bin/npm' } },
      network: { canAccessNpm: true, canAccessGithub: true },
    };
    (detectEnvironment as Mock).mockReturnValue(mockEnvironment);

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Connection timeout (ETIMEDOUT)', () => {
    it('should display detailed error for connection timeout', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('Connection timeout after 10000ms'));

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://localhost:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      // Check that error formatting was called
      const { formatPlainErrorFromOutput, renderHighlightedError } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalled();
      expect(renderHighlightedError).toHaveBeenCalled();
    });
  });

  describe('Server not found (ENOTFOUND)', () => {
    it('should display detailed error for DNS resolution failure', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('getaddrinfo ENOTFOUND invalid-server.local'));

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://invalid-server.local:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();

      // Verify error was formatted with server URL
      const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalledWith(
        expect.stringContaining('ENOTFOUND'),
        expect.any(String),
        'WebSocket connect'
      );
    });
  });

  describe('Connection refused (ECONNREFUSED)', () => {
    it('should display detailed error for connection refused', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3000'));

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://localhost:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();

      const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalledWith(
        expect.stringContaining('ECONNREFUSED'),
        expect.any(String),
        'WebSocket connect'
      );
    });
  });

  describe('Connection reset (ECONNRESET)', () => {
    it('should display detailed error for connection reset', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('socket hang up ECONNRESET'));

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://localhost:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();

      const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalledWith(
        expect.stringContaining('ECONNRESET'),
        expect.any(String),
        'WebSocket connect'
      );
    });
  });

  describe('SSL certificate error', () => {
    it('should display detailed error for SSL certificate issues', async () => {
      mockClient.connectAndAuth.mockRejectedValue(
        new Error('unable to get local issuer certificate')
      );

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'wss://secure.example.com:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();

      const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalledWith(
        expect.stringContaining('certificate'),
        expect.any(String),
        'WebSocket connect'
      );
    });
  });

  describe('Generic connection error', () => {
    it('should handle unknown connection errors', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('Unknown network error'));

      const exitCode = await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://localhost:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      expect(exitCode).toBe(1);
      expect(mockClient.connectAndAuth).toHaveBeenCalled();

      const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
      expect(formatPlainErrorFromOutput).toHaveBeenCalledWith(
        expect.stringContaining('Unknown network error'),
        expect.any(String),
        'WebSocket connect'
      );
    });
  });

  describe('Offline mode suggestion', () => {
    it('should suggest --offline mode after connection failure', async () => {
      mockClient.connectAndAuth.mockRejectedValue(new Error('Connection timeout'));

      await runInstall({
        software: 'openclaw',
        serverUrl: 'ws://localhost:3000',
        yes: false,
        verbose: false,
        dryRun: false,
        offline: false,
        help: false,
        version: false,
      });

      // Verify that offline mode suggestion was displayed
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
      const hasOfflineSuggestion = logCalls.some((log) =>
        log.includes('--offline') || log.includes('offline')
      );
      expect(hasOfflineSuggestion).toBe(true);
    });
  });
});

describe('Offline mode', () => {
  let mockClient: {
    connectAndAuth: Mock;
    disconnect: Mock;
    send: Mock;
    waitFor: Mock;
    on: Mock;
    getAuthState: Mock;
  };

  let mockEnvironment: ReturnType<typeof detectEnvironment>;
  let consoleLogSpy: Mock;

  beforeEach(() => {
    mockClient = {
      connectAndAuth: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      waitFor: vi.fn(),
      on: vi.fn(),
      getAuthState: vi.fn(() => ({ authenticated: true })),
    };
    (AuthenticatedClient as unknown as Mock).mockImplementation(() => mockClient);

    mockEnvironment = {
      os: { platform: 'darwin', arch: 'arm64', version: '14.0.0' },
      shell: { type: 'zsh', path: '/bin/zsh' },
      runtime: { node: '22.0.0', npm: '10.0.0' },
      packageManagers: { npm: { version: '10.0.0', path: '/usr/local/bin/npm' } },
      network: { canAccessNpm: true, canAccessGithub: true },
    };
    (detectEnvironment as Mock).mockReturnValue(mockEnvironment);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
  });

  it('should detect environment and exit without connecting in offline mode', async () => {
    const exitCode = await runInstall({
      software: 'openclaw',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: false,
      dryRun: false,
      offline: true,
      help: false,
      version: false,
    });

    expect(exitCode).toBe(0);
    expect(detectEnvironment).toHaveBeenCalled();
    expect(mockClient.connectAndAuth).not.toHaveBeenCalled();
    expect(mockClient.disconnect).not.toHaveBeenCalled();

    // Check that offline mode banner was displayed
    const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
    const hasOfflineBanner = logCalls.some((log) =>
      log.includes('OFFLINE MODE') || log.includes('Environment detection complete')
    );
    expect(hasOfflineBanner).toBe(true);
  });

  it('should display environment info in offline mode with verbose flag', async () => {
    await runInstall({
      software: 'openclaw',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: true, // Enable verbose to show environment info
      dryRun: false,
      offline: true,
      help: false,
      version: false,
    });

    const { displayEnvironmentInfo } = await import('./ui/table.js');
    expect(displayEnvironmentInfo).toHaveBeenCalledWith(mockEnvironment);
  });

  it('should suggest how to install in offline mode', async () => {
    await runInstall({
      software: 'myapp',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: false,
      dryRun: false,
      offline: true,
      help: false,
      version: false,
    });

    const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
    const hasSuggestion = logCalls.some((log) =>
      log.includes('ai-installer myapp') || log.includes('without the --offline flag')
    );
    expect(hasSuggestion).toBe(true);
  });

  it('should work with --offline and --verbose flags together', async () => {
    const exitCode = await runInstall({
      software: 'openclaw',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: true,
      dryRun: false,
      offline: true,
      help: false,
      version: false,
    });

    expect(exitCode).toBe(0);
    expect(detectEnvironment).toHaveBeenCalled();
    expect(mockClient.connectAndAuth).not.toHaveBeenCalled();
  });
});

describe('Network error recovery', () => {
  let mockClient: {
    connectAndAuth: Mock;
    disconnect: Mock;
    send: Mock;
    waitFor: Mock;
    on: Mock;
    getAuthState: Mock;
  };

  let mockEnvironment: ReturnType<typeof detectEnvironment>;

  beforeEach(() => {
    mockClient = {
      connectAndAuth: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      waitFor: vi.fn(),
      on: vi.fn(),
      getAuthState: vi.fn(() => ({ authenticated: true })),
    };
    (AuthenticatedClient as unknown as Mock).mockImplementation(() => mockClient);

    mockEnvironment = {
      os: { platform: 'darwin', arch: 'arm64', version: '14.0.0' },
      shell: { type: 'zsh', path: '/bin/zsh' },
      runtime: { node: '22.0.0', npm: '10.0.0' },
      packageManagers: { npm: { version: '10.0.0', path: '/usr/local/bin/npm' } },
      network: { canAccessNpm: true, canAccessGithub: true },
    };
    (detectEnvironment as Mock).mockReturnValue(mockEnvironment);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('should provide actionable next steps for network failures', async () => {
    mockClient.connectAndAuth.mockRejectedValue(new Error('ENOTFOUND server.example.com'));

    const exitCode = await runInstall({
      software: 'openclaw',
      serverUrl: 'ws://server.example.com:3000',
      yes: false,
      verbose: false,
      dryRun: false,
      offline: false,
      help: false,
      version: false,
    });

    expect(exitCode).toBe(1);

    const { formatPlainErrorFromOutput } = await import('./ui/error-messages.js');
    const formatCall = (formatPlainErrorFromOutput as Mock).mock.calls[0];
    expect(formatCall).toBeDefined();

    // The formatted error should include the server URL
    expect(formatCall[0]).toContain('server.example.com');
  });

  it('should exit with code 1 on connection failure', async () => {
    mockClient.connectAndAuth.mockRejectedValue(new Error('Connection failed'));

    const exitCode = await runInstall({
      software: 'openclaw',
      serverUrl: 'ws://localhost:3000',
      yes: false,
      verbose: false,
      dryRun: false,
      offline: false,
      help: false,
      version: false,
    });

    expect(exitCode).toBe(1);
  });
});
