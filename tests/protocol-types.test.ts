import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ExecResultSchema,
  SessionStatus,
  SessionStatusSchema,
  SessionInfoSchema,
  StepStatus,
  StepStatusSchema,
  StepProgressSchema,
  parseExecResult,
  safeParseExecResult,
  parseSessionInfo,
  parseStepProgress,
} from '../packages/shared/src/protocol/types.js';
import {
  EnvironmentInfoSchema,
  InstallPlanSchema,
  InstallStepSchema,
  ErrorContextSchema,
  FixStrategySchema,
  ErrorHandlingStrategySchema,
  StepResultSchema,
} from '../packages/shared/src/protocol/messages.js';

// ============================================================================
// ExecResult Schema
// ============================================================================

describe('ExecResultSchema', () => {
  const validExecResult = {
    command: 'npm install',
    exitCode: 0,
    stdout: 'added 10 packages',
    stderr: '',
    duration: 3200,
    timedOut: false,
  };

  it('should parse a valid ExecResult', () => {
    const result = ExecResultSchema.parse(validExecResult);
    expect(result.command).toBe('npm install');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('added 10 packages');
    expect(result.stderr).toBe('');
    expect(result.duration).toBe(3200);
    expect(result.timedOut).toBe(false);
  });

  it('should parse a failed execution result', () => {
    const failed = {
      command: 'node --version',
      exitCode: 127,
      stdout: '',
      stderr: 'command not found: node',
      duration: 50,
      timedOut: false,
    };
    const result = ExecResultSchema.parse(failed);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('command not found: node');
  });

  it('should parse a timed-out execution result', () => {
    const timedOut = {
      command: 'pnpm install -g openclaw',
      exitCode: -1,
      stdout: 'Downloading...',
      stderr: '',
      duration: 120000,
      timedOut: true,
    };
    const result = ExecResultSchema.parse(timedOut);
    expect(result.timedOut).toBe(true);
    expect(result.duration).toBe(120000);
  });

  it('should reject missing command field', () => {
    const invalid = { ...validExecResult };
    delete (invalid as Record<string, unknown>).command;
    expect(() => ExecResultSchema.parse(invalid)).toThrow();
  });

  it('should reject missing exitCode field', () => {
    const invalid = { ...validExecResult };
    delete (invalid as Record<string, unknown>).exitCode;
    expect(() => ExecResultSchema.parse(invalid)).toThrow();
  });

  it('should reject missing timedOut field', () => {
    const invalid = { ...validExecResult };
    delete (invalid as Record<string, unknown>).timedOut;
    expect(() => ExecResultSchema.parse(invalid)).toThrow();
  });

  it('should reject non-number exitCode', () => {
    expect(() =>
      ExecResultSchema.parse({ ...validExecResult, exitCode: 'zero' }),
    ).toThrow();
  });

  it('should reject non-boolean timedOut', () => {
    expect(() =>
      ExecResultSchema.parse({ ...validExecResult, timedOut: 'no' }),
    ).toThrow();
  });
});

// ============================================================================
// SessionStatus
// ============================================================================

describe('SessionStatus', () => {
  it('should define all expected status values', () => {
    expect(SessionStatus.CREATED).toBe('created');
    expect(SessionStatus.DETECTING).toBe('detecting');
    expect(SessionStatus.PLANNING).toBe('planning');
    expect(SessionStatus.EXECUTING).toBe('executing');
    expect(SessionStatus.ERROR).toBe('error');
    expect(SessionStatus.COMPLETED).toBe('completed');
  });

  it('should have exactly 6 statuses', () => {
    expect(Object.keys(SessionStatus)).toHaveLength(6);
  });
});

describe('SessionStatusSchema', () => {
  it('should accept all valid status values', () => {
    const statuses = ['created', 'detecting', 'planning', 'executing', 'error', 'completed'];
    for (const status of statuses) {
      expect(SessionStatusSchema.parse(status)).toBe(status);
    }
  });

  it('should reject invalid status value', () => {
    expect(() => SessionStatusSchema.parse('unknown')).toThrow();
    expect(() => SessionStatusSchema.parse('running')).toThrow();
  });
});

// ============================================================================
// SessionInfo Schema
// ============================================================================

describe('SessionInfoSchema', () => {
  const validSession = {
    id: 'sess_abc123',
    software: 'openclaw',
    version: '1.0.0',
    status: 'created' as const,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('should parse a valid SessionInfo', () => {
    const result = SessionInfoSchema.parse(validSession);
    expect(result.id).toBe('sess_abc123');
    expect(result.software).toBe('openclaw');
    expect(result.version).toBe('1.0.0');
    expect(result.status).toBe('created');
    expect(result.createdAt).toBe(1700000000000);
    expect(result.updatedAt).toBe(1700000000000);
  });

  it('should allow optional version field', () => {
    const noVersion = { ...validSession };
    delete (noVersion as Record<string, unknown>).version;
    const result = SessionInfoSchema.parse(noVersion);
    expect(result.version).toBeUndefined();
  });

  it('should accept all valid status values', () => {
    for (const status of Object.values(SessionStatus)) {
      const session = { ...validSession, status };
      expect(() => SessionInfoSchema.parse(session)).not.toThrow();
    }
  });

  it('should reject invalid status', () => {
    expect(() =>
      SessionInfoSchema.parse({ ...validSession, status: 'invalid' }),
    ).toThrow();
  });

  it('should reject missing id', () => {
    const invalid = { ...validSession };
    delete (invalid as Record<string, unknown>).id;
    expect(() => SessionInfoSchema.parse(invalid)).toThrow();
  });

  it('should reject missing software', () => {
    const invalid = { ...validSession };
    delete (invalid as Record<string, unknown>).software;
    expect(() => SessionInfoSchema.parse(invalid)).toThrow();
  });

  it('should reject missing createdAt', () => {
    const invalid = { ...validSession };
    delete (invalid as Record<string, unknown>).createdAt;
    expect(() => SessionInfoSchema.parse(invalid)).toThrow();
  });

  it('should reject missing updatedAt', () => {
    const invalid = { ...validSession };
    delete (invalid as Record<string, unknown>).updatedAt;
    expect(() => SessionInfoSchema.parse(invalid)).toThrow();
  });
});

// ============================================================================
// StepStatus
// ============================================================================

describe('StepStatus', () => {
  it('should define all expected status values', () => {
    expect(StepStatus.PENDING).toBe('pending');
    expect(StepStatus.RUNNING).toBe('running');
    expect(StepStatus.SUCCESS).toBe('success');
    expect(StepStatus.FAILED).toBe('failed');
    expect(StepStatus.SKIPPED).toBe('skipped');
  });

  it('should have exactly 5 statuses', () => {
    expect(Object.keys(StepStatus)).toHaveLength(5);
  });
});

describe('StepStatusSchema', () => {
  it('should accept all valid status values', () => {
    const statuses = ['pending', 'running', 'success', 'failed', 'skipped'];
    for (const status of statuses) {
      expect(StepStatusSchema.parse(status)).toBe(status);
    }
  });

  it('should reject invalid status value', () => {
    expect(() => StepStatusSchema.parse('cancelled')).toThrow();
    expect(() => StepStatusSchema.parse('completed')).toThrow();
  });
});

// ============================================================================
// StepProgress Schema
// ============================================================================

describe('StepProgressSchema', () => {
  const validProgress = {
    stepId: 'check-node',
    status: 'running' as const,
    startedAt: 1700000000000,
    retryCount: 0,
  };

  it('should parse a valid StepProgress (running step)', () => {
    const result = StepProgressSchema.parse(validProgress);
    expect(result.stepId).toBe('check-node');
    expect(result.status).toBe('running');
    expect(result.startedAt).toBe(1700000000000);
    expect(result.retryCount).toBe(0);
  });

  it('should parse a completed step with result', () => {
    const completed = {
      stepId: 'install-pnpm',
      status: 'success' as const,
      startedAt: 1700000000000,
      completedAt: 1700000003200,
      retryCount: 0,
      result: {
        command: 'npm install -g pnpm',
        exitCode: 0,
        stdout: 'added 1 package',
        stderr: '',
        duration: 3200,
        timedOut: false,
      },
    };
    const result = StepProgressSchema.parse(completed);
    expect(result.status).toBe('success');
    expect(result.completedAt).toBe(1700000003200);
    expect(result.result?.command).toBe('npm install -g pnpm');
    expect(result.result?.exitCode).toBe(0);
  });

  it('should parse a failed step with retry count', () => {
    const failed = {
      stepId: 'install-openclaw',
      status: 'failed' as const,
      startedAt: 1700000000000,
      completedAt: 1700000060000,
      retryCount: 3,
      result: {
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'network timeout',
        duration: 60000,
        timedOut: true,
      },
    };
    const result = StepProgressSchema.parse(failed);
    expect(result.retryCount).toBe(3);
    expect(result.result?.timedOut).toBe(true);
  });

  it('should allow optional startedAt and completedAt', () => {
    const pending = {
      stepId: 'verify-installation',
      status: 'pending' as const,
      retryCount: 0,
    };
    const result = StepProgressSchema.parse(pending);
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });

  it('should allow optional result', () => {
    const result = StepProgressSchema.parse(validProgress);
    expect(result.result).toBeUndefined();
  });

  it('should reject missing stepId', () => {
    const invalid = { ...validProgress };
    delete (invalid as Record<string, unknown>).stepId;
    expect(() => StepProgressSchema.parse(invalid)).toThrow();
  });

  it('should reject missing status', () => {
    const invalid = { ...validProgress };
    delete (invalid as Record<string, unknown>).status;
    expect(() => StepProgressSchema.parse(invalid)).toThrow();
  });

  it('should reject missing retryCount', () => {
    const invalid = { ...validProgress };
    delete (invalid as Record<string, unknown>).retryCount;
    expect(() => StepProgressSchema.parse(invalid)).toThrow();
  });

  it('should reject invalid status value in progress', () => {
    expect(() =>
      StepProgressSchema.parse({ ...validProgress, status: 'invalid' }),
    ).toThrow();
  });
});

// ============================================================================
// Validation helpers
// ============================================================================

describe('parseExecResult', () => {
  it('should parse valid data', () => {
    const data = {
      command: 'node --version',
      exitCode: 0,
      stdout: 'v22.1.0',
      stderr: '',
      duration: 100,
      timedOut: false,
    };
    const result = parseExecResult(data);
    expect(result.command).toBe('node --version');
    expect(result.exitCode).toBe(0);
  });

  it('should throw ZodError on invalid data', () => {
    expect(() => parseExecResult({})).toThrow(z.ZodError);
    expect(() => parseExecResult(null)).toThrow(z.ZodError);
    expect(() => parseExecResult('invalid')).toThrow(z.ZodError);
  });
});

describe('safeParseExecResult', () => {
  it('should return success for valid data', () => {
    const data = {
      command: 'pnpm --version',
      exitCode: 0,
      stdout: '9.0.0',
      stderr: '',
      duration: 80,
      timedOut: false,
    };
    const result = safeParseExecResult(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('pnpm --version');
    }
  });

  it('should return failure for invalid data', () => {
    const result = safeParseExecResult({ command: 'test' });
    expect(result.success).toBe(false);
  });

  it('should not throw on invalid data', () => {
    expect(() => safeParseExecResult(null)).not.toThrow();
    expect(() => safeParseExecResult(undefined)).not.toThrow();
  });
});

describe('parseSessionInfo', () => {
  it('should parse valid session info', () => {
    const data = {
      id: 'sess_001',
      software: 'openclaw',
      status: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const result = parseSessionInfo(data);
    expect(result.id).toBe('sess_001');
    expect(result.software).toBe('openclaw');
  });

  it('should throw ZodError on invalid data', () => {
    expect(() => parseSessionInfo({})).toThrow(z.ZodError);
  });
});

describe('parseStepProgress', () => {
  it('should parse valid step progress', () => {
    const data = {
      stepId: 'check-node',
      status: 'pending',
      retryCount: 0,
    };
    const result = parseStepProgress(data);
    expect(result.stepId).toBe('check-node');
    expect(result.status).toBe('pending');
  });

  it('should throw ZodError on invalid data', () => {
    expect(() => parseStepProgress({})).toThrow(z.ZodError);
  });
});

// ============================================================================
// Re-exported types consistency checks
// ============================================================================

describe('Re-exported types from messages.ts', () => {
  it('EnvironmentInfo should be importable and usable from types.ts', async () => {
    const types = await import('../packages/shared/src/protocol/types.js');
    // Verify the re-export exists (types are erased at runtime, but we can check that
    // the module exports are reachable)
    expect(types).toBeDefined();
  });

  it('EnvironmentInfoSchema should be consistent with types.ts re-export', () => {
    const validEnv = {
      os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: ['/usr/local'] },
    };
    expect(() => EnvironmentInfoSchema.parse(validEnv)).not.toThrow();
  });

  it('InstallStepSchema should remain consistent', () => {
    const validStep = {
      id: 'check-node',
      description: 'Check Node.js version',
      command: 'node --version',
      timeout: 30000,
      canRollback: false,
      onError: 'abort',
    };
    expect(() => InstallStepSchema.parse(validStep)).not.toThrow();
  });

  it('InstallPlanSchema should remain consistent', () => {
    const validPlan = {
      steps: [
        {
          id: 'step1',
          description: 'Test step',
          command: 'echo test',
          timeout: 5000,
          canRollback: false,
          onError: 'abort',
        },
      ],
      estimatedTime: 60000,
      risks: [],
    };
    expect(() => InstallPlanSchema.parse(validPlan)).not.toThrow();
  });

  it('ErrorContextSchema should remain consistent', () => {
    const validCtx = {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: {
        os: { platform: 'linux', version: '22.04', arch: 'x64' },
        shell: { type: 'bash', version: '5.1' },
        runtime: { node: '22.0.0' },
        packageManagers: { npm: '10.0.0' },
        network: { canAccessNpm: true, canAccessGithub: true },
        permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
      },
      previousSteps: [],
    };
    expect(() => ErrorContextSchema.parse(validCtx)).not.toThrow();
  });

  it('FixStrategySchema should remain consistent', () => {
    const validFix = {
      id: 'use-sudo',
      description: 'Use sudo for installation',
      commands: ['sudo npm install -g pnpm'],
      confidence: 0.85,
    };
    expect(() => FixStrategySchema.parse(validFix)).not.toThrow();
  });

  it('ErrorHandlingStrategySchema should accept all valid values', () => {
    const strategies = ['retry', 'skip', 'abort', 'fallback'];
    for (const s of strategies) {
      expect(() => ErrorHandlingStrategySchema.parse(s)).not.toThrow();
    }
  });

  it('StepResultSchema should remain consistent', () => {
    const validResult = {
      stepId: 'check-node',
      success: true,
      exitCode: 0,
      stdout: 'v22.1.0',
      stderr: '',
      duration: 100,
    };
    expect(() => StepResultSchema.parse(validResult)).not.toThrow();
  });
});

// ============================================================================
// Export completeness
// ============================================================================

describe('Export completeness from types.ts', () => {
  it('should export all required schemas', async () => {
    const types = await import('../packages/shared/src/protocol/types.js');
    expect(types.ExecResultSchema).toBeDefined();
    expect(types.SessionStatusSchema).toBeDefined();
    expect(types.SessionInfoSchema).toBeDefined();
    expect(types.StepStatusSchema).toBeDefined();
    expect(types.StepProgressSchema).toBeDefined();
  });

  it('should export all required constants', async () => {
    const types = await import('../packages/shared/src/protocol/types.js');
    expect(types.SessionStatus).toBeDefined();
    expect(types.StepStatus).toBeDefined();
  });

  it('should export all validation helpers', async () => {
    const types = await import('../packages/shared/src/protocol/types.js');
    expect(typeof types.parseExecResult).toBe('function');
    expect(typeof types.safeParseExecResult).toBe('function');
    expect(typeof types.parseSessionInfo).toBe('function');
    expect(typeof types.parseStepProgress).toBe('function');
  });
});

// ============================================================================
// Integration: types.ts accessible via index.ts
// ============================================================================

describe('types.ts accessible via shared index', () => {
  it('should export ExecResultSchema from the shared package index', async () => {
    const shared = await import('../packages/shared/src/index.js');
    expect(shared.ExecResultSchema).toBeDefined();
  });

  it('should export SessionStatus from the shared package index', async () => {
    const shared = await import('../packages/shared/src/index.js');
    expect(shared.SessionStatus).toBeDefined();
  });

  it('should export StepStatus from the shared package index', async () => {
    const shared = await import('../packages/shared/src/index.js');
    expect(shared.StepStatus).toBeDefined();
  });

  it('should export parseExecResult from the shared package index', async () => {
    const shared = await import('../packages/shared/src/index.js');
    expect(typeof shared.parseExecResult).toBe('function');
  });
});
