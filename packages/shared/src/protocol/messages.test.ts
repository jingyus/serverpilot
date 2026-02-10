/**
 * Unit tests for WebSocket message protocol serialization and deserialization.
 *
 * Tests all message types to ensure Zod validation works correctly,
 * including valid cases, required/optional fields, and boundary conditions.
 *
 * @module protocol/messages.test
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  MessageType,
  MessageSchema,
  parseMessage,
  safeParseMessage,
  createMessage,
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  AIStreamStartMessageSchema,
  AIStreamTokenMessageSchema,
  AIStreamCompleteMessageSchema,
  AIStreamErrorMessageSchema,
  EnvironmentInfoSchema,
  InstallPlanSchema,
  InstallStepSchema,
  StepResultSchema,
  ErrorContextSchema,
  FixStrategySchema,
} from './messages.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a valid EnvironmentInfo object for testing
 */
function createValidEnvironmentInfo() {
  return {
    os: {
      platform: 'darwin' as const,
      version: '14.0.0',
      arch: 'arm64',
    },
    shell: {
      type: 'zsh' as const,
      version: '5.9',
    },
    runtime: {
      node: 'v18.0.0',
      python: '3.11.0',
    },
    packageManagers: {
      npm: '9.0.0',
      pnpm: '8.0.0',
      brew: '4.0.0',
    },
    network: {
      canAccessNpm: true,
      canAccessGithub: true,
    },
    permissions: {
      hasSudo: true,
      canWriteTo: ['/usr/local', '/opt'],
    },
  };
}

/**
 * Create a valid InstallStep object for testing
 */
function createValidInstallStep() {
  return {
    id: 'step-1',
    description: 'Install dependencies',
    command: 'npm install',
    expectedOutput: 'added 123 packages',
    timeout: 60000,
    canRollback: true,
    onError: 'retry' as const,
  };
}

/**
 * Create a valid InstallPlan object for testing
 */
function createValidInstallPlan() {
  return {
    steps: [createValidInstallStep()],
    estimatedTime: 120,
    risks: [
      {
        level: 'low' as const,
        description: 'May require sudo access',
      },
    ],
  };
}

// ============================================================================
// Sub-Schema Tests
// ============================================================================

describe('EnvironmentInfoSchema', () => {
  it('should validate a complete environment info', () => {
    const env = createValidEnvironmentInfo();
    const result = EnvironmentInfoSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('should accept optional runtime fields as undefined', () => {
    const env = {
      ...createValidEnvironmentInfo(),
      runtime: {},
    };
    const result = EnvironmentInfoSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('should accept optional package managers as undefined', () => {
    const env = {
      ...createValidEnvironmentInfo(),
      packageManagers: {},
    };
    const result = EnvironmentInfoSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('should reject invalid platform values', () => {
    const env = {
      ...createValidEnvironmentInfo(),
      os: {
        platform: 'invalid',
        version: '14.0.0',
        arch: 'arm64',
      },
    };
    const result = EnvironmentInfoSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const env = {
      os: {
        platform: 'darwin',
        version: '14.0.0',
        // missing arch
      },
      shell: {
        type: 'zsh',
        version: '5.9',
      },
    };
    const result = EnvironmentInfoSchema.safeParse(env);
    expect(result.success).toBe(false);
  });
});

describe('InstallStepSchema', () => {
  it('should validate a complete install step', () => {
    const step = createValidInstallStep();
    const result = InstallStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should accept optional expectedOutput as undefined', () => {
    const step = {
      ...createValidInstallStep(),
      expectedOutput: undefined,
    };
    const result = InstallStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should reject invalid onError values', () => {
    const step = {
      ...createValidInstallStep(),
      onError: 'invalid',
    };
    const result = InstallStepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const step = {
      id: 'step-1',
      description: 'Install dependencies',
      // missing command
      timeout: 60000,
      canRollback: true,
      onError: 'retry',
    };
    const result = InstallStepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });
});

describe('InstallPlanSchema', () => {
  it('should validate a complete install plan', () => {
    const plan = createValidInstallPlan();
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('should accept empty steps array', () => {
    const plan = {
      ...createValidInstallPlan(),
      steps: [],
    };
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('should accept empty risks array', () => {
    const plan = {
      ...createValidInstallPlan(),
      risks: [],
    };
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('should reject invalid risk level', () => {
    const plan = {
      ...createValidInstallPlan(),
      risks: [
        {
          level: 'critical',
          description: 'Very dangerous',
        },
      ],
    };
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});

describe('StepResultSchema', () => {
  it('should validate a complete step result', () => {
    const result = {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'Installation successful',
      stderr: '',
      duration: 5000,
    };
    const parseResult = StepResultSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
  });

  it('should accept failure result with error output', () => {
    const result = {
      stepId: 'step-2',
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: command not found',
      duration: 100,
    };
    const parseResult = StepResultSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const result = {
      stepId: 'step-1',
      success: true,
      // missing exitCode
      stdout: 'Output',
      stderr: '',
      duration: 5000,
    };
    const parseResult = StepResultSchema.safeParse(result);
    expect(parseResult.success).toBe(false);
  });
});

describe('ErrorContextSchema', () => {
  it('should validate a complete error context', () => {
    const context = {
      stepId: 'step-1',
      command: 'npm install',
      exitCode: 1,
      stdout: '',
      stderr: 'Error: command not found',
      environment: createValidEnvironmentInfo(),
      previousSteps: [],
    };
    const result = ErrorContextSchema.safeParse(context);
    expect(result.success).toBe(true);
  });

  it('should accept multiple previous steps', () => {
    const context = {
      stepId: 'step-3',
      command: 'npm start',
      exitCode: 1,
      stdout: '',
      stderr: 'Error',
      environment: createValidEnvironmentInfo(),
      previousSteps: [
        {
          stepId: 'step-1',
          success: true,
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          duration: 1000,
        },
        {
          stepId: 'step-2',
          success: true,
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          duration: 2000,
        },
      ],
    };
    const result = ErrorContextSchema.safeParse(context);
    expect(result.success).toBe(true);
  });
});

describe('FixStrategySchema', () => {
  it('should validate a complete fix strategy', () => {
    const strategy = {
      id: 'fix-1',
      description: 'Install missing package',
      commands: ['npm install -g pnpm'],
      confidence: 0.9,
      risk: 'low' as const,
      requiresSudo: false,
    };
    const result = FixStrategySchema.safeParse(strategy);
    expect(result.success).toBe(true);
  });

  it('should accept optional fields as undefined', () => {
    const strategy = {
      id: 'fix-2',
      description: 'Retry command',
      commands: ['npm install'],
      confidence: 0.5,
    };
    const result = FixStrategySchema.safeParse(strategy);
    expect(result.success).toBe(true);
  });

  it('should reject confidence outside 0-1 range', () => {
    const strategy = {
      id: 'fix-3',
      description: 'Fix',
      commands: ['command'],
      confidence: 1.5,
    };
    const result = FixStrategySchema.safeParse(strategy);
    expect(result.success).toBe(false);
  });

  it('should reject negative confidence', () => {
    const strategy = {
      id: 'fix-4',
      description: 'Fix',
      commands: ['command'],
      confidence: -0.1,
    };
    const result = FixStrategySchema.safeParse(strategy);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Message Schema Tests
// ============================================================================

describe('SessionCreateMessage', () => {
  it('should validate a message with required fields', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: {
        software: 'openclaw',
      },
      timestamp: Date.now(),
    };
    const result = SessionCreateMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate a message with optional version', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: {
        software: 'openclaw',
        version: '1.0.0',
      },
      timestamp: Date.now(),
      requestId: 'req-123',
    };
    const result = SessionCreateMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should reject wrong message type', () => {
    const message = {
      type: 'wrong.type',
      payload: {
        software: 'openclaw',
      },
      timestamp: Date.now(),
    };
    const result = SessionCreateMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('should reject missing software field', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: {
        version: '1.0.0',
      },
      timestamp: Date.now(),
    };
    const result = SessionCreateMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });
});

describe('EnvReportMessage', () => {
  it('should validate a complete environment report', () => {
    const message = {
      type: MessageType.ENV_REPORT,
      payload: createValidEnvironmentInfo(),
      timestamp: Date.now(),
      requestId: 'req-456',
    };
    const result = EnvReportMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should reject invalid environment info', () => {
    const message = {
      type: MessageType.ENV_REPORT,
      payload: {
        os: { platform: 'invalid' },
      },
      timestamp: Date.now(),
    };
    const result = EnvReportMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });
});

describe('PlanReceiveMessage', () => {
  it('should validate a message with install plan', () => {
    const message = {
      type: MessageType.PLAN_RECEIVE,
      payload: createValidInstallPlan(),
      timestamp: Date.now(),
    };
    const result = PlanReceiveMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate a message with empty plan', () => {
    const message = {
      type: MessageType.PLAN_RECEIVE,
      payload: {
        steps: [],
        estimatedTime: 0,
        risks: [],
      },
      timestamp: Date.now(),
    };
    const result = PlanReceiveMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('StepExecuteMessage', () => {
  it('should validate a step execution message', () => {
    const message = {
      type: MessageType.STEP_EXECUTE,
      payload: createValidInstallStep(),
      timestamp: Date.now(),
    };
    const result = StepExecuteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('StepOutputMessage', () => {
  it('should validate step output message', () => {
    const message = {
      type: MessageType.STEP_OUTPUT,
      payload: {
        stepId: 'step-1',
        output: 'Installing packages...\n',
      },
      timestamp: Date.now(),
    };
    const result = StepOutputMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept empty output', () => {
    const message = {
      type: MessageType.STEP_OUTPUT,
      payload: {
        stepId: 'step-2',
        output: '',
      },
      timestamp: Date.now(),
    };
    const result = StepOutputMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('StepCompleteMessage', () => {
  it('should validate successful step completion', () => {
    const message = {
      type: MessageType.STEP_COMPLETE,
      payload: {
        stepId: 'step-1',
        success: true,
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
        duration: 5000,
      },
      timestamp: Date.now(),
    };
    const result = StepCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate failed step completion', () => {
    const message = {
      type: MessageType.STEP_COMPLETE,
      payload: {
        stepId: 'step-2',
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Error occurred',
        duration: 1000,
      },
      timestamp: Date.now(),
    };
    const result = StepCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('ErrorOccurredMessage', () => {
  it('should validate error message', () => {
    const message = {
      type: MessageType.ERROR_OCCURRED,
      payload: {
        stepId: 'step-1',
        command: 'npm install',
        exitCode: 1,
        stdout: '',
        stderr: 'command not found: npm',
        environment: createValidEnvironmentInfo(),
        previousSteps: [],
      },
      timestamp: Date.now(),
    };
    const result = ErrorOccurredMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('FixSuggestMessage', () => {
  it('should validate fix suggestion message', () => {
    const message = {
      type: MessageType.FIX_SUGGEST,
      payload: [
        {
          id: 'fix-1',
          description: 'Install npm',
          commands: ['brew install node'],
          confidence: 0.9,
          risk: 'low' as const,
          requiresSudo: false,
        },
      ],
      timestamp: Date.now(),
    };
    const result = FixSuggestMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate empty fix suggestions', () => {
    const message = {
      type: MessageType.FIX_SUGGEST,
      payload: [],
      timestamp: Date.now(),
    };
    const result = FixSuggestMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate multiple fix suggestions', () => {
    const message = {
      type: MessageType.FIX_SUGGEST,
      payload: [
        {
          id: 'fix-1',
          description: 'Solution 1',
          commands: ['command1'],
          confidence: 0.9,
        },
        {
          id: 'fix-2',
          description: 'Solution 2',
          commands: ['command2'],
          confidence: 0.7,
        },
        {
          id: 'fix-3',
          description: 'Solution 3',
          commands: ['command3'],
          confidence: 0.5,
        },
      ],
      timestamp: Date.now(),
    };
    const result = FixSuggestMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('SessionCompleteMessage', () => {
  it('should validate successful session completion', () => {
    const message = {
      type: MessageType.SESSION_COMPLETE,
      payload: {
        success: true,
        summary: 'Installation completed successfully',
      },
      timestamp: Date.now(),
    };
    const result = SessionCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate failed session completion', () => {
    const message = {
      type: MessageType.SESSION_COMPLETE,
      payload: {
        success: false,
        summary: 'Installation failed due to errors',
      },
      timestamp: Date.now(),
    };
    const result = SessionCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept session completion without summary', () => {
    const message = {
      type: MessageType.SESSION_COMPLETE,
      payload: {
        success: true,
      },
      timestamp: Date.now(),
    };
    const result = SessionCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// AI Streaming Message Tests
// ============================================================================

describe('AIStreamStartMessage', () => {
  it('should validate AI stream start message', () => {
    const message = {
      type: MessageType.AI_STREAM_START,
      payload: {
        operation: 'analyzeEnvironment',
      },
      timestamp: Date.now(),
    };
    const result = AIStreamStartMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should reject missing operation field', () => {
    const message = {
      type: MessageType.AI_STREAM_START,
      payload: {},
      timestamp: Date.now(),
    };
    const result = AIStreamStartMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });
});

describe('AIStreamTokenMessage', () => {
  it('should validate AI stream token message', () => {
    const message = {
      type: MessageType.AI_STREAM_TOKEN,
      payload: {
        token: 'Hello',
        accumulated: 'Hello',
      },
      timestamp: Date.now(),
    };
    const result = AIStreamTokenMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept empty token', () => {
    const message = {
      type: MessageType.AI_STREAM_TOKEN,
      payload: {
        token: '',
        accumulated: 'Previous text',
      },
      timestamp: Date.now(),
    };
    const result = AIStreamTokenMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('AIStreamCompleteMessage', () => {
  it('should validate AI stream completion message', () => {
    const message = {
      type: MessageType.AI_STREAM_COMPLETE,
      payload: {
        text: 'Complete response text',
        inputTokens: 100,
        outputTokens: 50,
      },
      timestamp: Date.now(),
    };
    const result = AIStreamCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept zero tokens', () => {
    const message = {
      type: MessageType.AI_STREAM_COMPLETE,
      payload: {
        text: '',
        inputTokens: 0,
        outputTokens: 0,
      },
      timestamp: Date.now(),
    };
    const result = AIStreamCompleteMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('AIStreamErrorMessage', () => {
  it('should validate AI stream error message', () => {
    const message = {
      type: MessageType.AI_STREAM_ERROR,
      payload: {
        error: 'API rate limit exceeded',
      },
      timestamp: Date.now(),
    };
    const result = AIStreamErrorMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept empty error message', () => {
    const message = {
      type: MessageType.AI_STREAM_ERROR,
      payload: {
        error: '',
      },
      timestamp: Date.now(),
    };
    const result = AIStreamErrorMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Message Discrimination Tests
// ============================================================================

describe('MessageSchema discriminated union', () => {
  it('should parse session.create message', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { software: 'openclaw' },
      timestamp: Date.now(),
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(MessageType.SESSION_CREATE);
    }
  });

  it('should parse env.report message', () => {
    const message = {
      type: MessageType.ENV_REPORT,
      payload: createValidEnvironmentInfo(),
      timestamp: Date.now(),
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(MessageType.ENV_REPORT);
    }
  });

  it('should parse plan.receive message', () => {
    const message = {
      type: MessageType.PLAN_RECEIVE,
      payload: createValidInstallPlan(),
      timestamp: Date.now(),
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(MessageType.PLAN_RECEIVE);
    }
  });

  it('should reject unknown message type', () => {
    const message = {
      type: 'unknown.type',
      payload: {},
      timestamp: Date.now(),
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('should reject message with wrong payload structure', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { wrongField: 'value' }, // missing 'software'
      timestamp: Date.now(),
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('should reject message missing timestamp', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { software: 'openclaw' },
      // missing timestamp
    };
    const result = MessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('parseMessage', () => {
  it('should parse valid message', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { software: 'openclaw' },
      timestamp: Date.now(),
    };
    const parsed = parseMessage(message);
    expect(parsed.type).toBe(MessageType.SESSION_CREATE);
  });

  it('should throw error for invalid message', () => {
    const message = {
      type: 'invalid',
      payload: {},
      timestamp: Date.now(),
    };
    expect(() => parseMessage(message)).toThrow(z.ZodError);
  });
});

describe('safeParseMessage', () => {
  it('should return success for valid message', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { software: 'openclaw' },
      timestamp: Date.now(),
    };
    const result = safeParseMessage(message);
    expect(result.success).toBe(true);
  });

  it('should return error for invalid message', () => {
    const message = {
      type: 'invalid',
      payload: {},
      timestamp: Date.now(),
    };
    const result = safeParseMessage(message);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });
});

describe('createMessage', () => {
  it('should create message with current timestamp', () => {
    const beforeTime = Date.now();
    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });
    const afterTime = Date.now();

    expect(message.type).toBe(MessageType.SESSION_CREATE);
    expect(message.payload.software).toBe('openclaw');
    expect(message.timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(message.timestamp).toBeLessThanOrEqual(afterTime);
    expect(message.requestId).toBeUndefined();
  });

  it('should create message with requestId', () => {
    const message = createMessage(
      MessageType.SESSION_CREATE,
      { software: 'openclaw' },
      'req-789',
    );

    expect(message.type).toBe(MessageType.SESSION_CREATE);
    expect(message.requestId).toBe('req-789');
  });

  it('should create env.report message', () => {
    const env = createValidEnvironmentInfo();
    const message = createMessage(MessageType.ENV_REPORT, env);

    expect(message.type).toBe(MessageType.ENV_REPORT);
    expect(message.payload).toEqual(env);
  });

  it('should create plan.receive message', () => {
    const plan = createValidInstallPlan();
    const message = createMessage(MessageType.PLAN_RECEIVE, plan);

    expect(message.type).toBe(MessageType.PLAN_RECEIVE);
    expect(message.payload).toEqual(plan);
  });

  it('should create fix.suggest message', () => {
    const fixes = [
      {
        id: 'fix-1',
        description: 'Install npm',
        commands: ['brew install node'],
        confidence: 0.9,
      },
    ];
    const message = createMessage(MessageType.FIX_SUGGEST, fixes);

    expect(message.type).toBe(MessageType.FIX_SUGGEST);
    expect(message.payload).toEqual(fixes);
  });

  it('should create session.complete message', () => {
    const message = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'Done',
    });

    expect(message.type).toBe(MessageType.SESSION_COMPLETE);
    expect(message.payload.success).toBe(true);
    expect(message.payload.summary).toBe('Done');
  });
});

// ============================================================================
// Serialization/Deserialization Round-Trip Tests
// ============================================================================

describe('JSON serialization/deserialization', () => {
  it('should round-trip SessionCreateMessage', () => {
    const original = createMessage(
      MessageType.SESSION_CREATE,
      { software: 'openclaw', version: '1.0.0' },
      'req-123',
    );

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated).toEqual(original);
  });

  it('should round-trip EnvReportMessage', () => {
    const original = createMessage(
      MessageType.ENV_REPORT,
      createValidEnvironmentInfo(),
      'req-456',
    );

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated).toEqual(original);
  });

  it('should round-trip PlanReceiveMessage', () => {
    const original = createMessage(MessageType.PLAN_RECEIVE, createValidInstallPlan());

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated).toEqual(original);
  });

  it('should round-trip FixSuggestMessage', () => {
    const original = createMessage(MessageType.FIX_SUGGEST, [
      {
        id: 'fix-1',
        description: 'Install dependencies',
        commands: ['npm install'],
        confidence: 0.85,
        risk: 'low' as const,
        requiresSudo: false,
      },
    ]);

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated).toEqual(original);
  });

  it('should round-trip all AI streaming messages', () => {
    const messages = [
      createMessage(MessageType.AI_STREAM_START, { operation: 'test' }),
      createMessage(MessageType.AI_STREAM_TOKEN, { token: 'hello', accumulated: 'hello' }),
      createMessage(MessageType.AI_STREAM_COMPLETE, {
        text: 'complete',
        inputTokens: 10,
        outputTokens: 5,
      }),
      createMessage(MessageType.AI_STREAM_ERROR, { error: 'error occurred' }),
    ];

    for (const original of messages) {
      const json = JSON.stringify(original);
      const parsed = JSON.parse(json);
      const validated = parseMessage(parsed);
      expect(validated).toEqual(original);
    }
  });
});

// ============================================================================
// Edge Cases and Boundary Tests
// ============================================================================

describe('Edge cases', () => {
  it('should handle very long strings in message fields', () => {
    const longString = 'a'.repeat(10000);
    const message = createMessage(MessageType.STEP_OUTPUT, {
      stepId: 'step-1',
      output: longString,
    });

    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated.payload.output).toBe(longString);
  });

  it('should handle special characters in strings', () => {
    const specialChars = '\\n\\t\\"\\r\u0000\u001f';
    const message = createMessage(MessageType.SESSION_CREATE, {
      software: specialChars,
    });

    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated.payload.software).toBe(specialChars);
  });

  it('should handle unicode characters', () => {
    const unicode = '你好世界 🚀 émojis';
    const message = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: unicode,
    });

    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated.payload.summary).toBe(unicode);
  });

  it('should handle nested arrays and objects', () => {
    const plan = {
      steps: [
        createValidInstallStep(),
        {
          ...createValidInstallStep(),
          id: 'step-2',
          description: 'Second step',
        },
        {
          ...createValidInstallStep(),
          id: 'step-3',
          description: 'Third step',
        },
      ],
      estimatedTime: 300,
      risks: [
        { level: 'low' as const, description: 'Risk 1' },
        { level: 'medium' as const, description: 'Risk 2' },
        { level: 'high' as const, description: 'Risk 3' },
      ],
    };

    const message = createMessage(MessageType.PLAN_RECEIVE, plan);
    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated.payload.steps).toHaveLength(3);
    expect(validated.payload.risks).toHaveLength(3);
  });

  it('should handle maximum timestamp value', () => {
    const message = {
      type: MessageType.SESSION_CREATE,
      payload: { software: 'openclaw' },
      timestamp: Number.MAX_SAFE_INTEGER,
    };

    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    const validated = parseMessage(parsed);

    expect(validated.timestamp).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('should handle confidence boundary values', () => {
    const strategies = [
      {
        id: 'fix-1',
        description: 'Zero confidence',
        commands: ['cmd'],
        confidence: 0,
      },
      {
        id: 'fix-2',
        description: 'Max confidence',
        commands: ['cmd'],
        confidence: 1,
      },
    ];

    const message = createMessage(MessageType.FIX_SUGGEST, strategies);
    const validated = parseMessage(message);

    expect(validated.payload[0].confidence).toBe(0);
    expect(validated.payload[1].confidence).toBe(1);
  });
});
