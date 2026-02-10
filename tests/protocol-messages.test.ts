import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MessageType,
  MessageSchema,
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  EnvironmentInfoSchema,
  InstallPlanSchema,
  InstallStepSchema,
  StepResultSchema,
  ErrorContextSchema,
  FixStrategySchema,
  ErrorHandlingStrategySchema,
  parseMessage,
  safeParseMessage,
  createMessage,
} from '../packages/shared/src/protocol/messages.js';
import type {
  Message,
  SessionCreateMessage,
  EnvReportMessage,
  PlanReceiveMessage,
  StepExecuteMessage,
  StepOutputMessage,
  StepCompleteMessage,
  ErrorOccurredMessage,
  FixSuggestMessage,
  SessionCompleteMessage,
  EnvironmentInfo,
  InstallPlan,
  InstallStep,
  StepResult,
  ErrorContext,
  FixStrategy,
  ErrorHandlingStrategy,
} from '../packages/shared/src/protocol/messages.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const now = Date.now();

const sampleEnvironmentInfo: EnvironmentInfo = {
  os: { platform: 'darwin', version: '24.6.0', arch: 'arm64' },
  shell: { type: 'zsh', version: '5.9' },
  runtime: { node: '22.1.0', python: '3.12.0' },
  packageManagers: { npm: '10.2.0', pnpm: '9.0.0' },
  network: { canAccessNpm: true, canAccessGithub: true },
  permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
};

const sampleInstallStep: InstallStep = {
  id: 'check-node',
  description: '检查 Node.js 版本',
  command: 'node --version',
  expectedOutput: 'v22',
  timeout: 30000,
  canRollback: false,
  onError: 'abort',
};

const sampleInstallPlan: InstallPlan = {
  steps: [sampleInstallStep],
  estimatedTime: 120000,
  risks: [{ level: 'low', description: 'Network may be slow' }],
};

const sampleStepResult: StepResult = {
  stepId: 'check-node',
  success: true,
  exitCode: 0,
  stdout: 'v22.1.0\n',
  stderr: '',
  duration: 150,
};

const sampleErrorContext: ErrorContext = {
  stepId: 'install-pnpm',
  command: 'npm install -g pnpm',
  exitCode: 1,
  stdout: '',
  stderr: 'EACCES: permission denied',
  environment: sampleEnvironmentInfo,
  previousSteps: [sampleStepResult],
};

const sampleFixStrategy: FixStrategy = {
  id: 'use-sudo',
  description: '使用 sudo 权限安装',
  commands: ['sudo npm install -g pnpm'],
  confidence: 0.9,
};

// ============================================================================
// MessageType Constants
// ============================================================================

describe('MessageType Constants', () => {
  it('should define all 20 message type strings', () => {
    // 11 original + 4 AI streaming + 4 snapshot/rollback + 1 metrics = 20
    expect(Object.keys(MessageType)).toHaveLength(20);
  });

  it('should have correct type values', () => {
    expect(MessageType.SESSION_CREATE).toBe('session.create');
    expect(MessageType.ENV_REPORT).toBe('env.report');
    expect(MessageType.PLAN_RECEIVE).toBe('plan.receive');
    expect(MessageType.STEP_EXECUTE).toBe('step.execute');
    expect(MessageType.STEP_OUTPUT).toBe('step.output');
    expect(MessageType.STEP_COMPLETE).toBe('step.complete');
    expect(MessageType.ERROR_OCCURRED).toBe('error.occurred');
    expect(MessageType.FIX_SUGGEST).toBe('fix.suggest');
    expect(MessageType.SESSION_COMPLETE).toBe('session.complete');
    expect(MessageType.AI_STREAM_START).toBe('ai.stream.start');
    expect(MessageType.AI_STREAM_TOKEN).toBe('ai.stream.token');
    expect(MessageType.AI_STREAM_COMPLETE).toBe('ai.stream.complete');
    expect(MessageType.AI_STREAM_ERROR).toBe('ai.stream.error');
  });
});

// ============================================================================
// Sub-Schema Validation
// ============================================================================

describe('EnvironmentInfo Schema', () => {
  it('should validate a complete environment info', () => {
    const result = EnvironmentInfoSchema.safeParse(sampleEnvironmentInfo);
    expect(result.success).toBe(true);
  });

  it('should accept all valid OS platforms', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const data = { ...sampleEnvironmentInfo, os: { ...sampleEnvironmentInfo.os, platform } };
      expect(EnvironmentInfoSchema.safeParse(data).success).toBe(true);
    }
  });

  it('should reject invalid OS platform', () => {
    const data = {
      ...sampleEnvironmentInfo,
      os: { ...sampleEnvironmentInfo.os, platform: 'freebsd' },
    };
    expect(EnvironmentInfoSchema.safeParse(data).success).toBe(false);
  });

  it('should accept all valid shell types', () => {
    for (const type of ['bash', 'zsh', 'fish', 'powershell', 'unknown'] as const) {
      const data = { ...sampleEnvironmentInfo, shell: { ...sampleEnvironmentInfo.shell, type } };
      expect(EnvironmentInfoSchema.safeParse(data).success).toBe(true);
    }
  });

  it('should accept optional runtime fields', () => {
    const data = { ...sampleEnvironmentInfo, runtime: {} };
    expect(EnvironmentInfoSchema.safeParse(data).success).toBe(true);
  });

  it('should accept optional package manager fields', () => {
    const data = { ...sampleEnvironmentInfo, packageManagers: {} };
    expect(EnvironmentInfoSchema.safeParse(data).success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const { os: _, ...noOs } = sampleEnvironmentInfo;
    expect(EnvironmentInfoSchema.safeParse(noOs).success).toBe(false);
  });
});

describe('InstallStep Schema', () => {
  it('should validate a complete install step', () => {
    expect(InstallStepSchema.safeParse(sampleInstallStep).success).toBe(true);
  });

  it('should accept step without expectedOutput', () => {
    const { expectedOutput: _, ...step } = sampleInstallStep;
    expect(InstallStepSchema.safeParse(step).success).toBe(true);
  });

  it('should validate all error handling strategies', () => {
    for (const strategy of ['retry', 'skip', 'abort', 'fallback'] as const) {
      const step = { ...sampleInstallStep, onError: strategy };
      expect(InstallStepSchema.safeParse(step).success).toBe(true);
    }
  });

  it('should reject invalid error handling strategy', () => {
    const step = { ...sampleInstallStep, onError: 'panic' };
    expect(InstallStepSchema.safeParse(step).success).toBe(false);
  });
});

describe('InstallPlan Schema', () => {
  it('should validate a complete install plan', () => {
    expect(InstallPlanSchema.safeParse(sampleInstallPlan).success).toBe(true);
  });

  it('should accept plan with multiple steps', () => {
    const plan = {
      ...sampleInstallPlan,
      steps: [sampleInstallStep, { ...sampleInstallStep, id: 'install-pnpm' }],
    };
    expect(InstallPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('should accept plan with empty risks', () => {
    const plan = { ...sampleInstallPlan, risks: [] };
    expect(InstallPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('should validate risk levels', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const plan = { ...sampleInstallPlan, risks: [{ level, description: 'test' }] };
      expect(InstallPlanSchema.safeParse(plan).success).toBe(true);
    }
  });
});

describe('StepResult Schema', () => {
  it('should validate a complete step result', () => {
    expect(StepResultSchema.safeParse(sampleStepResult).success).toBe(true);
  });

  it('should accept failed step result', () => {
    const result = { ...sampleStepResult, success: false, exitCode: 1 };
    expect(StepResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('ErrorContext Schema', () => {
  it('should validate a complete error context', () => {
    expect(ErrorContextSchema.safeParse(sampleErrorContext).success).toBe(true);
  });

  it('should accept error context with no previous steps', () => {
    const ctx = { ...sampleErrorContext, previousSteps: [] };
    expect(ErrorContextSchema.safeParse(ctx).success).toBe(true);
  });
});

describe('FixStrategy Schema', () => {
  it('should validate a complete fix strategy', () => {
    expect(FixStrategySchema.safeParse(sampleFixStrategy).success).toBe(true);
  });

  it('should reject confidence below 0', () => {
    const strategy = { ...sampleFixStrategy, confidence: -0.1 };
    expect(FixStrategySchema.safeParse(strategy).success).toBe(false);
  });

  it('should reject confidence above 1', () => {
    const strategy = { ...sampleFixStrategy, confidence: 1.1 };
    expect(FixStrategySchema.safeParse(strategy).success).toBe(false);
  });

  it('should accept boundary confidence values', () => {
    expect(FixStrategySchema.safeParse({ ...sampleFixStrategy, confidence: 0 }).success).toBe(true);
    expect(FixStrategySchema.safeParse({ ...sampleFixStrategy, confidence: 1 }).success).toBe(true);
  });
});

describe('ErrorHandlingStrategy Schema', () => {
  it('should accept valid strategies', () => {
    for (const s of ['retry', 'skip', 'abort', 'fallback']) {
      expect(ErrorHandlingStrategySchema.safeParse(s).success).toBe(true);
    }
  });

  it('should reject invalid strategy', () => {
    expect(ErrorHandlingStrategySchema.safeParse('ignore').success).toBe(false);
  });
});

// ============================================================================
// Individual Message Schema Validation
// ============================================================================

describe('SessionCreateMessage', () => {
  it('should validate a session.create message', () => {
    const msg: SessionCreateMessage = {
      type: 'session.create',
      payload: { software: 'openclaw' },
      timestamp: now,
    };
    expect(SessionCreateMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept optional version', () => {
    const msg = {
      type: 'session.create',
      payload: { software: 'openclaw', version: '1.0.0' },
      timestamp: now,
    };
    expect(SessionCreateMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept optional requestId', () => {
    const msg = {
      type: 'session.create',
      payload: { software: 'openclaw' },
      timestamp: now,
      requestId: 'req-001',
    };
    expect(SessionCreateMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should reject wrong type literal', () => {
    const msg = {
      type: 'session.close',
      payload: { software: 'openclaw' },
      timestamp: now,
    };
    expect(SessionCreateMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('EnvReportMessage', () => {
  it('should validate an env.report message', () => {
    const msg: EnvReportMessage = {
      type: 'env.report',
      payload: sampleEnvironmentInfo,
      timestamp: now,
    };
    expect(EnvReportMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should reject invalid environment info payload', () => {
    const msg = {
      type: 'env.report',
      payload: { os: 'invalid' },
      timestamp: now,
    };
    expect(EnvReportMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('PlanReceiveMessage', () => {
  it('should validate a plan.receive message', () => {
    const msg: PlanReceiveMessage = {
      type: 'plan.receive',
      payload: sampleInstallPlan,
      timestamp: now,
    };
    expect(PlanReceiveMessageSchema.safeParse(msg).success).toBe(true);
  });
});

describe('StepExecuteMessage', () => {
  it('should validate a step.execute message', () => {
    const msg: StepExecuteMessage = {
      type: 'step.execute',
      payload: sampleInstallStep,
      timestamp: now,
    };
    expect(StepExecuteMessageSchema.safeParse(msg).success).toBe(true);
  });
});

describe('StepOutputMessage', () => {
  it('should validate a step.output message', () => {
    const msg: StepOutputMessage = {
      type: 'step.output',
      payload: { stepId: 'check-node', output: 'v22.1.0\n' },
      timestamp: now,
    };
    expect(StepOutputMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should reject missing stepId', () => {
    const msg = {
      type: 'step.output',
      payload: { output: 'v22.1.0\n' },
      timestamp: now,
    };
    expect(StepOutputMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('StepCompleteMessage', () => {
  it('should validate a step.complete message', () => {
    const msg: StepCompleteMessage = {
      type: 'step.complete',
      payload: sampleStepResult,
      timestamp: now,
    };
    expect(StepCompleteMessageSchema.safeParse(msg).success).toBe(true);
  });
});

describe('ErrorOccurredMessage', () => {
  it('should validate an error.occurred message', () => {
    const msg: ErrorOccurredMessage = {
      type: 'error.occurred',
      payload: sampleErrorContext,
      timestamp: now,
    };
    expect(ErrorOccurredMessageSchema.safeParse(msg).success).toBe(true);
  });
});

describe('FixSuggestMessage', () => {
  it('should validate a fix.suggest message', () => {
    const msg: FixSuggestMessage = {
      type: 'fix.suggest',
      payload: [sampleFixStrategy],
      timestamp: now,
    };
    expect(FixSuggestMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept empty fix array', () => {
    const msg = {
      type: 'fix.suggest',
      payload: [],
      timestamp: now,
    };
    expect(FixSuggestMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept multiple fix strategies', () => {
    const msg = {
      type: 'fix.suggest',
      payload: [
        sampleFixStrategy,
        { ...sampleFixStrategy, id: 'use-mirror', description: '使用镜像', confidence: 0.7 },
      ],
      timestamp: now,
    };
    expect(FixSuggestMessageSchema.safeParse(msg).success).toBe(true);
  });
});

describe('SessionCompleteMessage', () => {
  it('should validate a session.complete message', () => {
    const msg: SessionCompleteMessage = {
      type: 'session.complete',
      payload: { success: true },
      timestamp: now,
    };
    expect(SessionCompleteMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept optional summary', () => {
    const msg = {
      type: 'session.complete',
      payload: { success: true, summary: 'Installation completed successfully' },
      timestamp: now,
    };
    expect(SessionCompleteMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('should accept failed session', () => {
    const msg = {
      type: 'session.complete',
      payload: { success: false, summary: 'Installation failed at step 3' },
      timestamp: now,
    };
    expect(SessionCompleteMessageSchema.safeParse(msg).success).toBe(true);
  });
});

// ============================================================================
// Discriminated Union (MessageSchema)
// ============================================================================

describe('MessageSchema (Discriminated Union)', () => {
  it('should parse each message type correctly', () => {
    const messages: Message[] = [
      { type: 'session.create', payload: { software: 'openclaw' }, timestamp: now },
      { type: 'env.report', payload: sampleEnvironmentInfo, timestamp: now },
      { type: 'plan.receive', payload: sampleInstallPlan, timestamp: now },
      { type: 'step.execute', payload: sampleInstallStep, timestamp: now },
      { type: 'step.output', payload: { stepId: 's1', output: 'ok' }, timestamp: now },
      { type: 'step.complete', payload: sampleStepResult, timestamp: now },
      { type: 'error.occurred', payload: sampleErrorContext, timestamp: now },
      { type: 'fix.suggest', payload: [sampleFixStrategy], timestamp: now },
      { type: 'session.complete', payload: { success: true }, timestamp: now },
    ];

    for (const msg of messages) {
      const result = MessageSchema.safeParse(msg);
      expect(result.success, `Failed for type: ${msg.type}`).toBe(true);
    }
  });

  it('should reject unknown message type', () => {
    const msg = { type: 'unknown.type', payload: {}, timestamp: now };
    expect(MessageSchema.safeParse(msg).success).toBe(false);
  });

  it('should reject message without timestamp', () => {
    const msg = { type: 'session.create', payload: { software: 'openclaw' } };
    expect(MessageSchema.safeParse(msg).success).toBe(false);
  });

  it('should reject message without payload', () => {
    const msg = { type: 'session.create', timestamp: now };
    expect(MessageSchema.safeParse(msg).success).toBe(false);
  });

  it('should reject null input', () => {
    expect(MessageSchema.safeParse(null).success).toBe(false);
  });

  it('should reject non-object input', () => {
    expect(MessageSchema.safeParse('string').success).toBe(false);
    expect(MessageSchema.safeParse(123).success).toBe(false);
    expect(MessageSchema.safeParse(undefined).success).toBe(false);
  });
});

// ============================================================================
// Validation Helper Functions
// ============================================================================

describe('parseMessage', () => {
  it('should return parsed message for valid input', () => {
    const raw = {
      type: 'session.create',
      payload: { software: 'openclaw' },
      timestamp: now,
    };
    const msg = parseMessage(raw);
    expect(msg.type).toBe('session.create');
    expect(msg.payload).toEqual({ software: 'openclaw' });
    expect(msg.timestamp).toBe(now);
  });

  it('should throw ZodError for invalid input', () => {
    expect(() => parseMessage({ type: 'invalid' })).toThrow(z.ZodError);
  });

  it('should throw ZodError for null', () => {
    expect(() => parseMessage(null)).toThrow(z.ZodError);
  });
});

describe('safeParseMessage', () => {
  it('should return success result for valid input', () => {
    const raw = {
      type: 'session.complete',
      payload: { success: true },
      timestamp: now,
    };
    const result = safeParseMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('session.complete');
    }
  });

  it('should return error result for invalid input', () => {
    const result = safeParseMessage({ type: 'invalid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });
});

describe('createMessage', () => {
  it('should create session.create message with timestamp', () => {
    const msg = createMessage('session.create', { software: 'openclaw' });
    expect(msg.type).toBe('session.create');
    expect(msg.payload.software).toBe('openclaw');
    expect(typeof msg.timestamp).toBe('number');
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('should create message with requestId', () => {
    const msg = createMessage('session.create', { software: 'openclaw' }, 'req-123');
    expect(msg.requestId).toBe('req-123');
  });

  it('should not include requestId when not provided', () => {
    const msg = createMessage('session.create', { software: 'openclaw' });
    expect(msg.requestId).toBeUndefined();
  });

  it('should create valid env.report message', () => {
    const msg = createMessage('env.report', sampleEnvironmentInfo);
    expect(msg.type).toBe('env.report');
    const result = EnvReportMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid plan.receive message', () => {
    const msg = createMessage('plan.receive', sampleInstallPlan);
    expect(msg.type).toBe('plan.receive');
    const result = PlanReceiveMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid step.execute message', () => {
    const msg = createMessage('step.execute', sampleInstallStep);
    expect(msg.type).toBe('step.execute');
    const result = StepExecuteMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid step.output message', () => {
    const msg = createMessage('step.output', { stepId: 's1', output: 'data' });
    expect(msg.type).toBe('step.output');
    const result = StepOutputMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid step.complete message', () => {
    const msg = createMessage('step.complete', sampleStepResult);
    const result = StepCompleteMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid error.occurred message', () => {
    const msg = createMessage('error.occurred', sampleErrorContext);
    const result = ErrorOccurredMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid fix.suggest message', () => {
    const msg = createMessage('fix.suggest', [sampleFixStrategy]);
    const result = FixSuggestMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should create valid session.complete message', () => {
    const msg = createMessage('session.complete', { success: true });
    const result = SessionCompleteMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should produce messages that pass parseMessage', () => {
    const msg = createMessage('session.create', { software: 'test' });
    expect(() => parseMessage(msg)).not.toThrow();
  });
});

// ============================================================================
// Type Exports Verification
// ============================================================================

describe('Type Exports', () => {
  it('should export all message types', () => {
    // Verify types exist at runtime by checking schema exports
    expect(SessionCreateMessageSchema).toBeDefined();
    expect(EnvReportMessageSchema).toBeDefined();
    expect(PlanReceiveMessageSchema).toBeDefined();
    expect(StepExecuteMessageSchema).toBeDefined();
    expect(StepOutputMessageSchema).toBeDefined();
    expect(StepCompleteMessageSchema).toBeDefined();
    expect(ErrorOccurredMessageSchema).toBeDefined();
    expect(FixSuggestMessageSchema).toBeDefined();
    expect(SessionCompleteMessageSchema).toBeDefined();
  });

  it('should export all sub-type schemas', () => {
    expect(EnvironmentInfoSchema).toBeDefined();
    expect(InstallPlanSchema).toBeDefined();
    expect(InstallStepSchema).toBeDefined();
    expect(StepResultSchema).toBeDefined();
    expect(ErrorContextSchema).toBeDefined();
    expect(FixStrategySchema).toBeDefined();
    expect(ErrorHandlingStrategySchema).toBeDefined();
  });

  it('should export MessageSchema as discriminated union', () => {
    expect(MessageSchema).toBeDefined();
    // Verify it's a ZodDiscriminatedUnion
    expect(MessageSchema._def.typeName).toBe('ZodDiscriminatedUnion');
  });

  it('should export helper functions', () => {
    expect(typeof parseMessage).toBe('function');
    expect(typeof safeParseMessage).toBe('function');
    expect(typeof createMessage).toBe('function');
  });
});
