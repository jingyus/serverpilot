// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import chalk from 'chalk';
import type { ErrorContext } from '@aiinstaller/shared';
import {
  formatPlainError,
  formatPlainErrorFromOutput,
  getCategoryLabel,
  getSeverityLabel,
  getNextSteps,
  getHelpLinks,
  renderPlainError,
  renderHighlightedError,
  getSeverityColor,
  highlightKeywords,
} from './error-messages.js';
import type {
  PlainErrorMessage,
  ErrorCategory,
  ErrorSeverity,
} from './error-messages.js';

// ============================================================================
// Helper: create a minimal ErrorContext
// ============================================================================

function makeErrorContext(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g pnpm',
    exitCode: 1,
    stdout: '',
    stderr: '',
    environment: {
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '14.0',
      nodeVersion: 'v22.0.0',
      shell: '/bin/zsh',
      packageManagers: { npm: '10.0.0' },
    },
    previousSteps: [],
    ...overrides,
  };
}

// ============================================================================
// formatPlainError — Network errors
// ============================================================================

describe('formatPlainError — network errors', () => {
  it('identifies ETIMEDOUT as connection timeout', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code ETIMEDOUT' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Connection timed out');
    expect(msg.explanation).toContain('package server');
    expect(msg.severity).toBe('medium');
  });

  it('identifies ERR_SOCKET_TIMEOUT as connection timeout', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ERR_SOCKET_TIMEOUT on registry.npmjs.org' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Connection timed out');
  });

  it('identifies ENOTFOUND as server address not found', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ENOTFOUND registry.npmjs.org' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Server address not found');
    expect(msg.explanation).toContain('DNS');
    expect(msg.severity).toBe('high');
  });

  it('identifies ECONNREFUSED as connection refused', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ECONNREFUSED 127.0.0.1:4873' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Connection was refused');
    expect(msg.explanation).toContain('proxy');
  });

  it('identifies ECONNRESET as connection interrupted', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ECONNRESET' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Connection was interrupted');
    expect(msg.explanation).toContain('unstable network');
  });

  it('identifies SSL certificate errors', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'unable to get local issuer certificate' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Security certificate problem');
    expect(msg.explanation).toContain('certificate');
  });

  it('identifies CERT_HAS_EXPIRED', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'CERT_HAS_EXPIRED' }),
    );
    expect(msg.title).toBe('Security certificate problem');
  });

  it('identifies generic network timeout', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'network timeout at some url' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Network timeout');
  });

  it('identifies fetch failed', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'fetch failed' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Download failed');
    expect(msg.explanation).toContain('internet');
  });

  it('identifies request to URL failed', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'request to https://registry.npmjs.org failed' }),
    );
    expect(msg.category).toBe('network');
    expect(msg.title).toBe('Download failed');
  });
});

// ============================================================================
// formatPlainError — Permission errors
// ============================================================================

describe('formatPlainError — permission errors', () => {
  it('identifies EACCES permission denied', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib/node_modules' }),
    );
    expect(msg.category).toBe('permission');
    expect(msg.title).toBe('Permission denied');
    expect(msg.explanation).toContain('does not have permission');
    expect(msg.severity).toBe('high');
  });

  it('identifies EPERM operation not permitted', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EPERM: operation not permitted' }),
    );
    expect(msg.category).toBe('permission');
    expect(msg.title).toBe('Operation not allowed');
    expect(msg.explanation).toContain('nvm');
  });

  it('identifies Missing write access', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Missing write access to /usr/local/lib/node_modules' }),
    );
    expect(msg.category).toBe('permission');
    expect(msg.title).toBe('Cannot write to install directory');
    expect(msg.explanation).toContain('pnpm setup');
  });
});

// ============================================================================
// formatPlainError — Dependency errors
// ============================================================================

describe('formatPlainError — dependency errors', () => {
  it('identifies node command not found', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'node: command not found' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Node.js is not installed');
    expect(msg.severity).toBe('critical');
  });

  it('identifies pnpm command not found', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'pnpm: command not found' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('pnpm is not installed');
    expect(msg.explanation).toContain('corepack');
  });

  it('identifies generic command not found', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'git: command not found' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toContain('git');
    expect(msg.title).toContain('not installed');
  });

  it('identifies ERESOLVE dependency conflict', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! ERESOLVE unable to resolve dependency tree' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Package version conflict');
    expect(msg.explanation).toContain('legacy-peer-deps');
  });

  it('identifies Cannot find module', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: "Cannot find module 'express'" }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Missing module');
    expect(msg.explanation).toContain('express');
  });

  it('identifies node-gyp build errors', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'gyp ERR! build error' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Native code build failed');
    expect(msg.explanation).toContain('build tools');
  });

  it('identifies ENOSPC disk full', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ENOSPC: no space left on device' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Disk space is full');
    expect(msg.severity).toBe('critical');
  });

  it('identifies 404 Not Found package', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! 404 Not Found: some-package@latest' }),
    );
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Package not found');
  });
});

// ============================================================================
// formatPlainError — Version errors
// ============================================================================

describe('formatPlainError — version errors', () => {
  it('identifies unsupported engine', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Unsupported engine: wanted: {"node":">=22"} (current: {"node":"v18.19.0"})' }),
    );
    expect(msg.category).toBe('version');
    expect(msg.title).toBe('Node.js version is too old');
    expect(msg.explanation).toContain('22');
  });

  it('identifies requires Node.js >= 22', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'This package requires Node.js >= 22.0.0' }),
    );
    expect(msg.category).toBe('version');
    expect(msg.title).toBe('Node.js version is too old');
  });

  it('identifies SyntaxError: Unexpected token', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: "SyntaxError: Unexpected token '??='" }),
    );
    expect(msg.category).toBe('version');
    expect(msg.title).toBe('Code syntax not supported');
    expect(msg.explanation).toContain('newer version');
  });

  it('identifies ERR_REQUIRE_ESM', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ERR_REQUIRE_ESM' }),
    );
    expect(msg.category).toBe('version');
    expect(msg.title).toBe('Module format mismatch');
  });

  it('identifies version not found', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'version 99.0.0 not found' }),
    );
    expect(msg.category).toBe('version');
    expect(msg.title).toContain('99.0.0');
    expect(msg.title).toContain('not available');
  });
});

// ============================================================================
// formatPlainError — Configuration errors
// ============================================================================

describe('formatPlainError — configuration errors', () => {
  it('identifies EJSONPARSE', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code EJSONPARSE' }),
    );
    expect(msg.category).toBe('configuration');
    expect(msg.title).toBe('Configuration file is broken');
    expect(msg.explanation).toContain('JSON');
  });

  it('identifies proxy configuration error', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! proxy config is invalid, check .npmrc' }),
    );
    expect(msg.category).toBe('configuration');
    expect(msg.title).toBe('Proxy settings are incorrect');
  });

  it('identifies Invalid configuration', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Invalid configuration option found' }),
    );
    expect(msg.category).toBe('configuration');
    expect(msg.title).toBe('Invalid configuration');
  });
});

// ============================================================================
// formatPlainError — Fallback (unknown)
// ============================================================================

describe('formatPlainError — fallback', () => {
  it('returns generic message for unrecognized error', () => {
    const msg = formatPlainError(
      makeErrorContext({
        command: 'some-tool --run',
        exitCode: 42,
        stderr: 'Something completely unexpected happened',
      }),
    );
    expect(msg.category).toBe('unknown');
    expect(msg.title).toBe('Something went wrong');
    expect(msg.explanation).toContain('some-tool --run');
    expect(msg.explanation).toContain('42');
    expect(msg.severity).toBe('medium');
  });

  it('fallback with empty stderr/stdout still works', () => {
    const msg = formatPlainError(
      makeErrorContext({ command: 'fail-cmd', exitCode: 1, stderr: '', stdout: '' }),
    );
    expect(msg.category).toBe('unknown');
    expect(msg.title).toBe('Something went wrong');
    expect(msg.explanation).toContain('fail-cmd');
  });

  it('fallback without command uses generic wording', () => {
    const msg = formatPlainError(
      makeErrorContext({ command: '', exitCode: 1, stderr: 'obscure' }),
    );
    expect(msg.category).toBe('unknown');
    expect(msg.explanation).toContain('unexpected error');
  });

  it('fallback truncates long technical detail', () => {
    const longErr = 'x'.repeat(200);
    const msg = formatPlainError(
      makeErrorContext({ stderr: longErr }),
    );
    expect(msg.technicalDetail).toBeDefined();
    expect(msg.technicalDetail!.length).toBeLessThanOrEqual(124);
  });
});

// ============================================================================
// formatPlainErrorFromOutput
// ============================================================================

describe('formatPlainErrorFromOutput', () => {
  it('matches known pattern from stderr only', () => {
    const msg = formatPlainErrorFromOutput('EACCES: permission denied /usr/lib');
    expect(msg.category).toBe('permission');
    expect(msg.title).toBe('Permission denied');
  });

  it('matches pattern from stdout when stderr is empty', () => {
    const msg = formatPlainErrorFromOutput('', 'ENOSPC: no space left on device');
    expect(msg.category).toBe('dependency');
    expect(msg.title).toBe('Disk space is full');
  });

  it('returns fallback for unrecognized output', () => {
    const msg = formatPlainErrorFromOutput('totally unknown');
    expect(msg.category).toBe('unknown');
    expect(msg.title).toBe('Something went wrong');
  });

  it('uses command in fallback explanation when provided', () => {
    const msg = formatPlainErrorFromOutput('obscure', '', 'run-cmd');
    expect(msg.explanation).toContain('run-cmd');
  });
});

// ============================================================================
// getCategoryLabel
// ============================================================================

describe('getCategoryLabel', () => {
  const cases: [ErrorCategory, string][] = [
    ['network', 'Network problem'],
    ['permission', 'Permission problem'],
    ['dependency', 'Missing dependency'],
    ['version', 'Version mismatch'],
    ['configuration', 'Configuration problem'],
    ['unknown', 'Unexpected error'],
  ];

  for (const [category, expected] of cases) {
    it(`returns "${expected}" for "${category}"`, () => {
      expect(getCategoryLabel(category)).toBe(expected);
    });
  }
});

// ============================================================================
// getSeverityLabel
// ============================================================================

describe('getSeverityLabel', () => {
  const cases: [ErrorSeverity, string][] = [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['critical', 'Critical'],
  ];

  for (const [severity, expected] of cases) {
    it(`returns "${expected}" for "${severity}"`, () => {
      expect(getSeverityLabel(severity)).toBe(expected);
    });
  }
});

// ============================================================================
// renderPlainError
// ============================================================================

describe('renderPlainError', () => {
  it('renders severity, title, explanation, and technical detail', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your user account does not have permission.',
      severity: 'high',
      category: 'permission',
      technicalDetail: 'EACCES: permission denied /usr/local',
      nextSteps: ['Run pnpm setup', 'Retry the command'],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('[High]');
    expect(rendered).toContain('Permission denied');
    expect(rendered).toContain('Your user account does not have permission.');
    expect(rendered).toContain('(EACCES: permission denied /usr/local)');
  });

  it('omits technical detail line when not provided', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An unexpected error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    const lines = rendered.split('\n');
    expect(lines).toHaveLength(2);
    expect(rendered).toContain('[Medium]');
    expect(rendered).not.toContain('(');
  });

  it('renders critical severity correctly', () => {
    const msg: PlainErrorMessage = {
      title: 'Disk space is full',
      explanation: 'Not enough free space.',
      severity: 'critical',
      category: 'dependency',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('[Critical]');
  });
});

// ============================================================================
// Plain-language quality checks
// ============================================================================

describe('plain-language quality', () => {
  it('messages do not contain raw error codes in titles', () => {
    const testCases = [
      { stderr: 'EACCES: permission denied' },
      { stderr: 'ETIMEDOUT' },
      { stderr: 'ENOTFOUND host' },
      { stderr: 'ERESOLVE unable to resolve' },
      { stderr: 'EJSONPARSE' },
    ];

    for (const tc of testCases) {
      const msg = formatPlainError(makeErrorContext(tc));
      // Titles should not contain raw error codes like EACCES, ETIMEDOUT, etc.
      expect(msg.title).not.toMatch(/^E[A-Z]{3,}/);
    }
  });

  it('all explanations are at least 30 characters (meaningful text)', () => {
    const testCases = [
      { stderr: 'EACCES: permission denied' },
      { stderr: 'ETIMEDOUT' },
      { stderr: 'ENOTFOUND host' },
      { stderr: 'node: command not found' },
      { stderr: 'Unsupported engine' },
      { stderr: 'EJSONPARSE' },
      { stderr: 'totally unknown error xyz' },
    ];

    for (const tc of testCases) {
      const msg = formatPlainError(makeErrorContext(tc));
      expect(msg.explanation.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('explanations use plain language (no raw codes)', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );
    // The explanation should not start with an error code
    expect(msg.explanation).not.toMatch(/^E[A-Z]{3,}/);
    // It should contain understandable words
    expect(msg.explanation.toLowerCase()).toMatch(/permission|access|write|directory/);
  });
});

// ============================================================================
// renderHighlightedError
// ============================================================================

describe('renderHighlightedError', () => {
  it('includes severity badge with color', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your user account does not have permission.',
      severity: 'high',
      category: 'permission',
      technicalDetail: 'EACCES',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    // Should contain the severity label text
    expect(rendered).toContain('High');
    // Should contain the title
    expect(rendered).toContain('Permission denied');
    // Should contain the category label
    expect(rendered).toContain('Permission problem');
    // Should contain the technical detail
    expect(rendered).toContain('EACCES');
  });

  it('uses ✖ icon for critical severity', () => {
    const msg: PlainErrorMessage = {
      title: 'Disk space is full',
      explanation: 'Not enough free space.',
      severity: 'critical',
      category: 'dependency',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('✖');
    expect(rendered).toContain('Critical');
  });

  it('uses ✖ icon for high severity', () => {
    const msg: PlainErrorMessage = {
      title: 'Node.js is not installed',
      explanation: 'Node.js was not found.',
      severity: 'high',
      category: 'dependency',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('✖');
  });

  it('uses ▲ icon for medium severity', () => {
    const msg: PlainErrorMessage = {
      title: 'Connection timed out',
      explanation: 'Could not reach the server.',
      severity: 'medium',
      category: 'network',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('▲');
  });

  it('uses ▲ icon for low severity', () => {
    const msg: PlainErrorMessage = {
      title: 'Minor issue',
      explanation: 'Something minor happened.',
      severity: 'low',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('▲');
  });

  it('omits technical detail line when not provided', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An unexpected error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    const lines = rendered.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('includes technical detail when provided', () => {
    const msg: PlainErrorMessage = {
      title: 'Connection refused',
      explanation: 'The server refused the connection.',
      severity: 'high',
      category: 'network',
      technicalDetail: 'ECONNREFUSED 127.0.0.1:4873',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    const lines = rendered.split('\n');
    expect(lines).toHaveLength(3);
    expect(rendered).toContain('ECONNREFUSED 127.0.0.1:4873');
  });

  it('renders all categories correctly', () => {
    const categories: ErrorCategory[] = [
      'network', 'permission', 'dependency', 'version', 'configuration', 'unknown',
    ];
    const expectedLabels = [
      'Network problem', 'Permission problem', 'Missing dependency',
      'Version mismatch', 'Configuration problem', 'Unexpected error',
    ];

    for (let i = 0; i < categories.length; i++) {
      const msg: PlainErrorMessage = {
        title: 'Test',
        explanation: 'Test explanation text here.',
        severity: 'medium',
        category: categories[i],
        nextSteps: [],
        helpLinks: [],
      };
      const rendered = renderHighlightedError(msg);
      expect(rendered).toContain(expectedLabels[i]);
    }
  });
});

// ============================================================================
// getSeverityColor
// ============================================================================

describe('getSeverityColor', () => {
  it('returns a function for each severity level', () => {
    const severities: ErrorSeverity[] = ['low', 'medium', 'high', 'critical'];
    for (const sev of severities) {
      const colorFn = getSeverityColor(sev);
      expect(typeof colorFn).toBe('function');
      const result = colorFn('test');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('produces different output for different severities when colors are enabled', () => {
    // Force colors for this test
    const level = chalk.level;
    chalk.level = 3;
    try {
      const outputs = (['low', 'medium', 'high', 'critical'] as ErrorSeverity[]).map(
        (sev) => getSeverityColor(sev)('test'),
      );
      // At least critical and low should differ (red bold vs cyan)
      expect(outputs[0]).not.toBe(outputs[3]);
    } finally {
      chalk.level = level;
    }
  });
});

// ============================================================================
// highlightKeywords
// ============================================================================

describe('highlightKeywords', () => {
  let savedLevel: number;

  beforeAll(() => {
    savedLevel = chalk.level;
    chalk.level = 3; // Force color output for highlight tests
  });

  afterAll(() => {
    chalk.level = savedLevel;
  });

  it('highlights quoted strings', () => {
    const input = 'Run "npm install" to install dependencies.';
    const result = highlightKeywords(input);
    // The quoted content should be modified (contain ANSI codes)
    expect(result).not.toBe(input);
    // The quotes themselves should still be present
    expect(result).toContain('"');
  });

  it('highlights multiple quoted strings', () => {
    const input = 'Use "corepack enable" followed by "corepack prepare pnpm@latest --activate".';
    const result = highlightKeywords(input);
    expect(result).not.toBe(input);
    // Both quoted strings should be processed
    expect(result).toContain('"');
  });

  it('highlights version numbers', () => {
    const input = 'Upgrade to Node.js 22.0.0 or later.';
    const result = highlightKeywords(input);
    expect(result).not.toBe(input);
  });

  it('highlights version numbers with v prefix', () => {
    const input = 'Current version is v18.19.0 but v22.0.0 is required.';
    const result = highlightKeywords(input);
    expect(result).not.toBe(input);
  });

  it('returns text unchanged when no keywords match', () => {
    const input = 'An unexpected error occurred.';
    const result = highlightKeywords(input);
    // No quoted strings, paths, or version numbers, so should be unchanged
    expect(result).toBe(input);
  });

  it('highlights file paths', () => {
    const input = 'Cannot write to /usr/local/lib/node_modules directory.';
    const result = highlightKeywords(input);
    expect(result).not.toBe(input);
  });

  it('does not break when text contains special characters', () => {
    const input = 'Error: permission denied (code=42) [retries=0]';
    const result = highlightKeywords(input);
    expect(typeof result).toBe('string');
  });

  it('handles empty string', () => {
    expect(highlightKeywords('')).toBe('');
  });
});

// ============================================================================
// Next-step suggestions — formatPlainError returns nextSteps
// ============================================================================

describe('nextSteps — every error category provides suggestions', () => {
  it('network errors (ETIMEDOUT) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code ETIMEDOUT' }),
    );
    expect(msg.nextSteps).toBeDefined();
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('network errors (ENOTFOUND) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ENOTFOUND registry.npmjs.org' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /internet|connection|DNS/i.test(s))).toBe(true);
  });

  it('network errors (ECONNREFUSED) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ECONNREFUSED 127.0.0.1:4873' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /proxy/i.test(s))).toBe(true);
  });

  it('network errors (ECONNRESET) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ECONNRESET' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('network errors (SSL certificate) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'unable to get local issuer certificate' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /certificate/i.test(s))).toBe(true);
  });

  it('network errors (network timeout) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'network timeout at some url' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('network errors (fetch failed) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'fetch failed' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /internet|connection/i.test(s))).toBe(true);
  });

  it('permission errors (EACCES) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /pnpm setup|sudo|nvm/i.test(s))).toBe(true);
  });

  it('permission errors (EPERM) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EPERM: operation not permitted' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /nvm/i.test(s))).toBe(true);
  });

  it('permission errors (Missing write access) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Missing write access to /usr/local/lib' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /pnpm setup/i.test(s))).toBe(true);
  });

  it('dependency errors (node not found) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'node: command not found' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /nvm|nodejs/i.test(s))).toBe(true);
  });

  it('dependency errors (pnpm not found) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'pnpm: command not found' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /corepack|npm install/i.test(s))).toBe(true);
  });

  it('dependency errors (generic command not found) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'git: command not found' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /git/i.test(s))).toBe(true);
  });

  it('dependency errors (ERESOLVE) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ERESOLVE unable to resolve dependency tree' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /legacy-peer-deps|force/i.test(s))).toBe(true);
  });

  it('dependency errors (Cannot find module) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: "Cannot find module 'express'" }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /npm install|pnpm install/i.test(s))).toBe(true);
  });

  it('dependency errors (gyp ERR!) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'gyp ERR! build error' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /xcode|build-essential/i.test(s))).toBe(true);
  });

  it('dependency errors (ENOSPC) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ENOSPC: no space left on device' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /cache|space|prune/i.test(s))).toBe(true);
  });

  it('dependency errors (404) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! 404 Not Found: some-pkg@latest' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /typo|name/i.test(s))).toBe(true);
  });

  it('version errors (Unsupported engine) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Unsupported engine' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /nvm|22|nodejs/i.test(s))).toBe(true);
  });

  it('version errors (SyntaxError) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: "SyntaxError: Unexpected token '??='" }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(1);
    expect(msg.nextSteps.some((s) => /nvm|22|upgrade/i.test(s))).toBe(true);
  });

  it('version errors (ERR_REQUIRE_ESM) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ERR_REQUIRE_ESM' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /reinstall|cache|module/i.test(s))).toBe(true);
  });

  it('version errors (version not found) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'version 99.0.0 not found' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /version/i.test(s))).toBe(true);
  });

  it('configuration errors (EJSONPARSE) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code EJSONPARSE' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /JSON|package\.json|syntax/i.test(s))).toBe(true);
  });

  it('configuration errors (proxy config) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! proxy config is invalid, check .npmrc' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /proxy|npmrc/i.test(s))).toBe(true);
  });

  it('configuration errors (Invalid configuration) include next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Invalid configuration option found' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /typo|help|configuration/i.test(s))).toBe(true);
  });

  it('fallback errors include generic next steps', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Something completely unexpected happened' }),
    );
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(msg.nextSteps.some((s) => /retry|search|review/i.test(s))).toBe(true);
  });
});

// ============================================================================
// getNextSteps
// ============================================================================

describe('getNextSteps', () => {
  it('returns next steps for a known error', () => {
    const steps = getNextSteps(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.some((s) => /pnpm setup|sudo|nvm/i.test(s))).toBe(true);
  });

  it('returns next steps for an unknown error', () => {
    const steps = getNextSteps(
      makeErrorContext({ stderr: 'very obscure error' }),
    );
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it('returns the same steps as formatPlainError', () => {
    const ctx = makeErrorContext({ stderr: 'node: command not found' });
    const msg = formatPlainError(ctx);
    const steps = getNextSteps(ctx);
    expect(steps).toEqual(msg.nextSteps);
  });
});

// ============================================================================
// renderPlainError — nextSteps rendering
// ============================================================================

describe('renderPlainError — nextSteps', () => {
  it('renders next steps when present', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your account does not have permission.',
      severity: 'high',
      category: 'permission',
      nextSteps: ['Run pnpm setup', 'Retry the command'],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('Next steps:');
    expect(rendered).toContain('  - Run pnpm setup');
    expect(rendered).toContain('  - Retry the command');
  });

  it('does not render next steps section when nextSteps is empty', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).not.toContain('Next steps:');
  });

  it('renders all steps in order', () => {
    const msg: PlainErrorMessage = {
      title: 'Test',
      explanation: 'Test explanation.',
      severity: 'low',
      category: 'unknown',
      nextSteps: ['First step', 'Second step', 'Third step'],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    const firstIdx = rendered.indexOf('First step');
    const secondIdx = rendered.indexOf('Second step');
    const thirdIdx = rendered.indexOf('Third step');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});

// ============================================================================
// renderHighlightedError — nextSteps rendering
// ============================================================================

describe('renderHighlightedError — nextSteps', () => {
  it('renders next steps with arrow bullets when present', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your account does not have permission.',
      severity: 'high',
      category: 'permission',
      nextSteps: ['Run pnpm setup', 'Retry the command'],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('Next steps:');
    expect(rendered).toContain('→');
    expect(rendered).toContain('Run pnpm setup');
    expect(rendered).toContain('Retry the command');
  });

  it('does not render next steps section when nextSteps is empty', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).not.toContain('Next steps:');
    expect(rendered).not.toContain('→');
  });

  it('renders next steps from a real error with highlighted keywords', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('Next steps:');
    expect(rendered).toContain('→');
  });
});

// ============================================================================
// Next-step quality checks
// ============================================================================

describe('next-step quality', () => {
  it('all nextSteps are non-empty strings', () => {
    const testCases = [
      { stderr: 'EACCES: permission denied' },
      { stderr: 'ETIMEDOUT' },
      { stderr: 'ENOTFOUND host' },
      { stderr: 'node: command not found' },
      { stderr: 'Unsupported engine' },
      { stderr: 'EJSONPARSE' },
      { stderr: 'totally unknown error xyz' },
    ];

    for (const tc of testCases) {
      const msg = formatPlainError(makeErrorContext(tc));
      for (const step of msg.nextSteps) {
        expect(typeof step).toBe('string');
        expect(step.length).toBeGreaterThan(5);
      }
    }
  });

  it('nextSteps contain actionable language', () => {
    const testCases = [
      { stderr: 'EACCES: permission denied' },
      { stderr: 'node: command not found' },
      { stderr: 'ENOSPC: no space left on device' },
    ];

    for (const tc of testCases) {
      const msg = formatPlainError(makeErrorContext(tc));
      // At least one step should contain an actionable verb
      const hasAction = msg.nextSteps.some((s) =>
        /run|install|check|try|upgrade|delete|clear|remove|retry|download|verify|free/i.test(s),
      );
      expect(hasAction).toBe(true);
    }
  });

  it('formatPlainErrorFromOutput also includes nextSteps', () => {
    const msg = formatPlainErrorFromOutput('EACCES: permission denied /usr/lib');
    expect(msg.nextSteps).toBeDefined();
    expect(msg.nextSteps.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Help links — formatPlainError returns helpLinks
// ============================================================================

describe('helpLinks — error categories provide help links', () => {
  it('network errors (ETIMEDOUT) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code ETIMEDOUT' }),
    );
    expect(msg.helpLinks).toBeDefined();
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks[0].url).toMatch(/^https?:\/\//);
    expect(msg.helpLinks[0].label.length).toBeGreaterThan(0);
  });

  it('network errors (ENOTFOUND) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ENOTFOUND registry.npmjs.org' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /dns|network/i.test(l.label))).toBe(true);
  });

  it('network errors (ECONNREFUSED) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ECONNREFUSED 127.0.0.1:4873' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /proxy/i.test(l.label))).toBe(true);
  });

  it('network errors (SSL certificate) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'unable to get local issuer certificate' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /ssl|certificate/i.test(l.label))).toBe(true);
  });

  it('permission errors (EACCES) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /permission|nvm/i.test(l.label))).toBe(true);
  });

  it('permission errors (EPERM) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EPERM: operation not permitted' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /nvm/i.test(l.label))).toBe(true);
  });

  it('permission errors (Missing write access) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Missing write access to /usr/local/lib' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /pnpm/i.test(l.label))).toBe(true);
  });

  it('dependency errors (node not found) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'node: command not found' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /node|nvm/i.test(l.label))).toBe(true);
  });

  it('dependency errors (pnpm not found) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'pnpm: command not found' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /pnpm/i.test(l.label))).toBe(true);
  });

  it('dependency errors (gyp ERR!) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'gyp ERR! build error' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /node-gyp/i.test(l.label))).toBe(true);
  });

  it('version errors (Unsupported engine) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Unsupported engine' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /node|nvm/i.test(l.label))).toBe(true);
  });

  it('version errors (ERR_REQUIRE_ESM) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'ERR_REQUIRE_ESM' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /esm/i.test(l.label))).toBe(true);
  });

  it('configuration errors (EJSONPARSE) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! code EJSONPARSE' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /json/i.test(l.label))).toBe(true);
  });

  it('configuration errors (proxy config) include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'npm ERR! proxy config is invalid' }),
    );
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
    expect(msg.helpLinks.some((l) => /proxy/i.test(l.label))).toBe(true);
  });

  it('fallback errors include help links', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'Something completely unexpected happened' }),
    );
    expect(msg.helpLinks).toBeDefined();
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('errors with empty helpLinks array are valid', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'git: command not found' }),
    );
    expect(Array.isArray(msg.helpLinks)).toBe(true);
  });
});

// ============================================================================
// getHelpLinks
// ============================================================================

describe('getHelpLinks', () => {
  it('returns help links for a known error', () => {
    const links = getHelpLinks(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );
    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveProperty('label');
    expect(links[0]).toHaveProperty('url');
  });

  it('returns help links for an unknown error', () => {
    const links = getHelpLinks(
      makeErrorContext({ stderr: 'very obscure error' }),
    );
    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the same links as formatPlainError', () => {
    const ctx = makeErrorContext({ stderr: 'node: command not found' });
    const msg = formatPlainError(ctx);
    const links = getHelpLinks(ctx);
    expect(links).toEqual(msg.helpLinks);
  });
});

// ============================================================================
// renderPlainError — helpLinks rendering
// ============================================================================

describe('renderPlainError — helpLinks', () => {
  it('renders help links when present', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your account does not have permission.',
      severity: 'high',
      category: 'permission',
      nextSteps: [],
      helpLinks: [
        { label: 'Fixing npm permissions', url: 'https://docs.npmjs.com/resolving-eacces-permissions-errors' },
      ],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('Help links:');
    expect(rendered).toContain('Fixing npm permissions');
    expect(rendered).toContain('https://docs.npmjs.com/resolving-eacces-permissions-errors');
  });

  it('renders multiple help links', () => {
    const msg: PlainErrorMessage = {
      title: 'Node.js is not installed',
      explanation: 'Node.js was not found on your system.',
      severity: 'critical',
      category: 'dependency',
      nextSteps: [],
      helpLinks: [
        { label: 'Node.js downloads', url: 'https://nodejs.org/en/download/' },
        { label: 'nvm guide', url: 'https://github.com/nvm-sh/nvm' },
      ],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('Help links:');
    expect(rendered).toContain('Node.js downloads');
    expect(rendered).toContain('nvm guide');
  });

  it('does not render help links section when helpLinks is empty', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderPlainError(msg);
    expect(rendered).not.toContain('Help links:');
  });

  it('renders help links from a real error', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );

    const rendered = renderPlainError(msg);
    expect(rendered).toContain('Help links:');
    expect(rendered).toContain('https://');
  });
});

// ============================================================================
// renderHighlightedError — helpLinks rendering
// ============================================================================

describe('renderHighlightedError — helpLinks', () => {
  it('renders help links with diamond bullets when present', () => {
    const msg: PlainErrorMessage = {
      title: 'Permission denied',
      explanation: 'Your account does not have permission.',
      severity: 'high',
      category: 'permission',
      nextSteps: [],
      helpLinks: [
        { label: 'Fixing npm permissions', url: 'https://docs.npmjs.com/resolving-eacces-permissions-errors' },
      ],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('Help links:');
    expect(rendered).toContain('◆');
    expect(rendered).toContain('Fixing npm permissions');
    expect(rendered).toContain('https://docs.npmjs.com/resolving-eacces-permissions-errors');
  });

  it('does not render help links section when helpLinks is empty', () => {
    const msg: PlainErrorMessage = {
      title: 'Something went wrong',
      explanation: 'An error occurred.',
      severity: 'medium',
      category: 'unknown',
      nextSteps: [],
      helpLinks: [],
    };

    const rendered = renderHighlightedError(msg);
    expect(rendered).not.toContain('Help links:');
    expect(rendered).not.toContain('◆');
  });

  it('renders help links from a real error with highlighted output', () => {
    const msg = formatPlainError(
      makeErrorContext({ stderr: 'EACCES: permission denied /usr/local/lib' }),
    );

    const rendered = renderHighlightedError(msg);
    expect(rendered).toContain('Help links:');
    expect(rendered).toContain('◆');
  });
});

// ============================================================================
// Help link quality checks
// ============================================================================

describe('help link quality', () => {
  it('all helpLinks have non-empty labels and valid URLs', () => {
    const testCases = [
      { stderr: 'EACCES: permission denied' },
      { stderr: 'ETIMEDOUT' },
      { stderr: 'ENOTFOUND host' },
      { stderr: 'node: command not found' },
      { stderr: 'Unsupported engine' },
      { stderr: 'EJSONPARSE' },
      { stderr: 'totally unknown error xyz' },
    ];

    for (const tc of testCases) {
      const msg = formatPlainError(makeErrorContext(tc));
      for (const link of msg.helpLinks) {
        expect(typeof link.label).toBe('string');
        expect(link.label.length).toBeGreaterThan(0);
        expect(typeof link.url).toBe('string');
        expect(link.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('formatPlainErrorFromOutput also includes helpLinks', () => {
    const msg = formatPlainErrorFromOutput('EACCES: permission denied /usr/lib');
    expect(msg.helpLinks).toBeDefined();
    expect(Array.isArray(msg.helpLinks)).toBe(true);
    expect(msg.helpLinks.length).toBeGreaterThanOrEqual(1);
  });
});
