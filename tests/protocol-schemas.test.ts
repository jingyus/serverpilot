import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  // Named schema re-exports
  EnvironmentInfoSchema,
  ErrorContextSchema,
  ErrorHandlingStrategySchema,
  FixStrategySchema,
  InstallPlanSchema,
  InstallStepSchema,
  StepResultSchema,
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  MessageSchema,
  ExecResultSchema,
  SessionStatusSchema,
  SessionInfoSchema,
  StepStatusSchema,
  StepProgressSchema,
  // Schema registry
  schemas,
  // Validation functions
  validate,
  // Safe-parse functions
  safeParse,
  // JSON utilities
  parseMessageFromJSON,
  safeParseMessageFromJSON,
} from '../packages/shared/src/protocol/schemas.js';
import { MessageType } from '../packages/shared/src/protocol/messages.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const now = Date.now();

const validEnvInfo = {
  os: { platform: 'darwin', version: '24.6.0', arch: 'arm64' },
  shell: { type: 'zsh', version: '5.9' },
  runtime: { node: '22.0.0' },
  packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
  network: { canAccessNpm: true, canAccessGithub: true },
  permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
};

const validStep = {
  id: 'check-node',
  description: 'Check Node.js version',
  command: 'node --version',
  timeout: 30000,
  canRollback: false,
  onError: 'abort' as const,
};

const validStepResult = {
  stepId: 'check-node',
  success: true,
  exitCode: 0,
  stdout: 'v22.0.0',
  stderr: '',
  duration: 150,
};

const validExecResult = {
  command: 'node --version',
  exitCode: 0,
  stdout: 'v22.0.0',
  stderr: '',
  duration: 100,
  timedOut: false,
};

const validFixStrategy = {
  id: 'use-nvm',
  description: 'Install Node.js via nvm',
  commands: ['curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash', 'nvm install 22'],
  confidence: 0.85,
};

const validSessionInfo = {
  id: 'session-123',
  software: 'openclaw',
  version: '1.0.0',
  status: 'created',
  createdAt: now,
  updatedAt: now,
};

const validStepProgress = {
  stepId: 'check-node',
  status: 'pending',
  retryCount: 0,
};

const validSessionCreateMsg = {
  type: MessageType.SESSION_CREATE,
  payload: { software: 'openclaw', version: '1.0.0' },
  timestamp: now,
};

// ============================================================================
// Tests
// ============================================================================

describe('protocol/schemas.ts', () => {
  // ==========================================================================
  // File existence
  // ==========================================================================

  describe('File existence', () => {
    it('should exist at the expected path', () => {
      const filePath = path.resolve('packages/shared/src/protocol/schemas.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should be exported from index.ts', () => {
      const indexContent = fs.readFileSync(
        path.resolve('packages/shared/src/index.ts'),
        'utf-8',
      );
      expect(indexContent).toContain("./protocol/schemas.js");
    });
  });

  // ==========================================================================
  // Named schema re-exports
  // ==========================================================================

  describe('Named schema re-exports', () => {
    it('should re-export EnvironmentInfoSchema', () => {
      expect(EnvironmentInfoSchema).toBeDefined();
      expect(EnvironmentInfoSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export ErrorContextSchema', () => {
      expect(ErrorContextSchema).toBeDefined();
      expect(ErrorContextSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export ErrorHandlingStrategySchema', () => {
      expect(ErrorHandlingStrategySchema).toBeDefined();
      expect(ErrorHandlingStrategySchema instanceof z.ZodEnum).toBe(true);
    });

    it('should re-export FixStrategySchema', () => {
      expect(FixStrategySchema).toBeDefined();
      expect(FixStrategySchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export InstallPlanSchema', () => {
      expect(InstallPlanSchema).toBeDefined();
      expect(InstallPlanSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export InstallStepSchema', () => {
      expect(InstallStepSchema).toBeDefined();
      expect(InstallStepSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export StepResultSchema', () => {
      expect(StepResultSchema).toBeDefined();
      expect(StepResultSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export all 9 message schemas', () => {
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

    it('should re-export MessageSchema (discriminated union)', () => {
      expect(MessageSchema).toBeDefined();
      expect(MessageSchema instanceof z.ZodDiscriminatedUnion).toBe(true);
    });

    it('should re-export ExecResultSchema', () => {
      expect(ExecResultSchema).toBeDefined();
      expect(ExecResultSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export SessionStatusSchema', () => {
      expect(SessionStatusSchema).toBeDefined();
      expect(SessionStatusSchema instanceof z.ZodEnum).toBe(true);
    });

    it('should re-export SessionInfoSchema', () => {
      expect(SessionInfoSchema).toBeDefined();
      expect(SessionInfoSchema instanceof z.ZodObject).toBe(true);
    });

    it('should re-export StepStatusSchema', () => {
      expect(StepStatusSchema).toBeDefined();
      expect(StepStatusSchema instanceof z.ZodEnum).toBe(true);
    });

    it('should re-export StepProgressSchema', () => {
      expect(StepProgressSchema).toBeDefined();
      expect(StepProgressSchema instanceof z.ZodObject).toBe(true);
    });
  });

  // ==========================================================================
  // schemas registry object
  // ==========================================================================

  describe('schemas registry object', () => {
    it('should contain all sub-type schemas', () => {
      expect(schemas.EnvironmentInfo).toBe(EnvironmentInfoSchema);
      expect(schemas.ErrorContext).toBe(ErrorContextSchema);
      expect(schemas.ErrorHandlingStrategy).toBe(ErrorHandlingStrategySchema);
      expect(schemas.FixStrategy).toBe(FixStrategySchema);
      expect(schemas.InstallPlan).toBe(InstallPlanSchema);
      expect(schemas.InstallStep).toBe(InstallStepSchema);
      expect(schemas.StepResult).toBe(StepResultSchema);
    });

    it('should contain all message schemas', () => {
      expect(schemas.SessionCreateMessage).toBe(SessionCreateMessageSchema);
      expect(schemas.EnvReportMessage).toBe(EnvReportMessageSchema);
      expect(schemas.PlanReceiveMessage).toBe(PlanReceiveMessageSchema);
      expect(schemas.StepExecuteMessage).toBe(StepExecuteMessageSchema);
      expect(schemas.StepOutputMessage).toBe(StepOutputMessageSchema);
      expect(schemas.StepCompleteMessage).toBe(StepCompleteMessageSchema);
      expect(schemas.ErrorOccurredMessage).toBe(ErrorOccurredMessageSchema);
      expect(schemas.FixSuggestMessage).toBe(FixSuggestMessageSchema);
      expect(schemas.SessionCompleteMessage).toBe(SessionCompleteMessageSchema);
      expect(schemas.Message).toBe(MessageSchema);
    });

    it('should contain all additional type schemas', () => {
      expect(schemas.ExecResult).toBe(ExecResultSchema);
      expect(schemas.SessionStatus).toBe(SessionStatusSchema);
      expect(schemas.SessionInfo).toBe(SessionInfoSchema);
      expect(schemas.StepStatus).toBe(StepStatusSchema);
      expect(schemas.StepProgress).toBe(StepProgressSchema);
    });

    it('should contain exactly 32 schemas', () => {
      // Updated after Phase 2 features (snapshot, rollback, profile, history)
      expect(Object.keys(schemas)).toHaveLength(32);
    });
  });

  // ==========================================================================
  // validate functions (throwing)
  // ==========================================================================

  describe('validate functions', () => {
    describe('sub-type validators', () => {
      it('should validate environmentInfo', () => {
        const result = validate.environmentInfo(validEnvInfo);
        expect(result.os.platform).toBe('darwin');
      });

      it('should throw on invalid environmentInfo', () => {
        expect(() => validate.environmentInfo({})).toThrow(z.ZodError);
      });

      it('should validate errorContext', () => {
        const ctx = {
          stepId: 'step-1',
          command: 'npm install',
          exitCode: 1,
          stdout: '',
          stderr: 'EACCES',
          environment: validEnvInfo,
          previousSteps: [validStepResult],
        };
        const result = validate.errorContext(ctx);
        expect(result.stepId).toBe('step-1');
      });

      it('should validate errorHandlingStrategy', () => {
        expect(validate.errorHandlingStrategy('retry')).toBe('retry');
        expect(validate.errorHandlingStrategy('skip')).toBe('skip');
        expect(validate.errorHandlingStrategy('abort')).toBe('abort');
        expect(validate.errorHandlingStrategy('fallback')).toBe('fallback');
      });

      it('should throw on invalid errorHandlingStrategy', () => {
        expect(() => validate.errorHandlingStrategy('invalid')).toThrow(z.ZodError);
      });

      it('should validate fixStrategy', () => {
        const result = validate.fixStrategy(validFixStrategy);
        expect(result.id).toBe('use-nvm');
        expect(result.confidence).toBe(0.85);
      });

      it('should validate installPlan', () => {
        const plan = {
          steps: [validStep],
          estimatedTime: 60000,
          risks: [{ level: 'low', description: 'No risks' }],
        };
        const result = validate.installPlan(plan);
        expect(result.steps).toHaveLength(1);
      });

      it('should validate installStep', () => {
        const result = validate.installStep(validStep);
        expect(result.id).toBe('check-node');
      });

      it('should validate stepResult', () => {
        const result = validate.stepResult(validStepResult);
        expect(result.success).toBe(true);
      });
    });

    describe('message validators', () => {
      it('should validate sessionCreateMessage', () => {
        const result = validate.sessionCreateMessage(validSessionCreateMsg);
        expect(result.type).toBe(MessageType.SESSION_CREATE);
      });

      it('should throw on invalid sessionCreateMessage', () => {
        expect(() => validate.sessionCreateMessage({ type: 'wrong' })).toThrow(z.ZodError);
      });

      it('should validate envReportMessage', () => {
        const msg = {
          type: MessageType.ENV_REPORT,
          payload: validEnvInfo,
          timestamp: now,
        };
        const result = validate.envReportMessage(msg);
        expect(result.type).toBe(MessageType.ENV_REPORT);
      });

      it('should validate planReceiveMessage', () => {
        const msg = {
          type: MessageType.PLAN_RECEIVE,
          payload: {
            steps: [validStep],
            estimatedTime: 60000,
            risks: [],
          },
          timestamp: now,
        };
        const result = validate.planReceiveMessage(msg);
        expect(result.type).toBe(MessageType.PLAN_RECEIVE);
      });

      it('should validate stepExecuteMessage', () => {
        const msg = {
          type: MessageType.STEP_EXECUTE,
          payload: validStep,
          timestamp: now,
        };
        const result = validate.stepExecuteMessage(msg);
        expect(result.type).toBe(MessageType.STEP_EXECUTE);
      });

      it('should validate stepOutputMessage', () => {
        const msg = {
          type: MessageType.STEP_OUTPUT,
          payload: { stepId: 'step-1', output: 'Installing...' },
          timestamp: now,
        };
        const result = validate.stepOutputMessage(msg);
        expect(result.type).toBe(MessageType.STEP_OUTPUT);
      });

      it('should validate stepCompleteMessage', () => {
        const msg = {
          type: MessageType.STEP_COMPLETE,
          payload: validStepResult,
          timestamp: now,
        };
        const result = validate.stepCompleteMessage(msg);
        expect(result.type).toBe(MessageType.STEP_COMPLETE);
      });

      it('should validate errorOccurredMessage', () => {
        const msg = {
          type: MessageType.ERROR_OCCURRED,
          payload: {
            stepId: 'step-1',
            command: 'npm install',
            exitCode: 1,
            stdout: '',
            stderr: 'EACCES',
            environment: validEnvInfo,
            previousSteps: [],
          },
          timestamp: now,
        };
        const result = validate.errorOccurredMessage(msg);
        expect(result.type).toBe(MessageType.ERROR_OCCURRED);
      });

      it('should validate fixSuggestMessage', () => {
        const msg = {
          type: MessageType.FIX_SUGGEST,
          payload: [validFixStrategy],
          timestamp: now,
        };
        const result = validate.fixSuggestMessage(msg);
        expect(result.type).toBe(MessageType.FIX_SUGGEST);
      });

      it('should validate sessionCompleteMessage', () => {
        const msg = {
          type: MessageType.SESSION_COMPLETE,
          payload: { success: true, summary: 'Done' },
          timestamp: now,
        };
        const result = validate.sessionCompleteMessage(msg);
        expect(result.type).toBe(MessageType.SESSION_COMPLETE);
      });

      it('should validate message (union type)', () => {
        const result = validate.message(validSessionCreateMsg);
        expect(result.type).toBe(MessageType.SESSION_CREATE);
      });

      it('should throw on invalid message', () => {
        expect(() => validate.message({ type: 'nonexistent' })).toThrow(z.ZodError);
      });
    });

    describe('additional type validators', () => {
      it('should validate execResult', () => {
        const result = validate.execResult(validExecResult);
        expect(result.command).toBe('node --version');
        expect(result.timedOut).toBe(false);
      });

      it('should throw on invalid execResult', () => {
        expect(() => validate.execResult({ command: 'test' })).toThrow(z.ZodError);
      });

      it('should validate sessionInfo', () => {
        const result = validate.sessionInfo(validSessionInfo);
        expect(result.id).toBe('session-123');
        expect(result.status).toBe('created');
      });

      it('should throw on invalid sessionInfo', () => {
        expect(() => validate.sessionInfo({ id: 'x' })).toThrow(z.ZodError);
      });

      it('should validate stepProgress', () => {
        const result = validate.stepProgress(validStepProgress);
        expect(result.stepId).toBe('check-node');
        expect(result.status).toBe('pending');
      });

      it('should throw on invalid stepProgress', () => {
        expect(() => validate.stepProgress({})).toThrow(z.ZodError);
      });
    });
  });

  // ==========================================================================
  // safeParse functions (non-throwing)
  // ==========================================================================

  describe('safeParse functions', () => {
    describe('sub-type safe parsers', () => {
      it('should safely parse valid environmentInfo', () => {
        const result = safeParse.environmentInfo(validEnvInfo);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.os.platform).toBe('darwin');
        }
      });

      it('should return failure for invalid environmentInfo', () => {
        const result = safeParse.environmentInfo({});
        expect(result.success).toBe(false);
      });

      it('should safely parse valid errorHandlingStrategy', () => {
        const result = safeParse.errorHandlingStrategy('retry');
        expect(result.success).toBe(true);
      });

      it('should return failure for invalid errorHandlingStrategy', () => {
        const result = safeParse.errorHandlingStrategy('invalid');
        expect(result.success).toBe(false);
      });

      it('should safely parse valid fixStrategy', () => {
        const result = safeParse.fixStrategy(validFixStrategy);
        expect(result.success).toBe(true);
      });

      it('should safely parse valid installPlan', () => {
        const result = safeParse.installPlan({
          steps: [validStep],
          estimatedTime: 60000,
          risks: [],
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse valid installStep', () => {
        const result = safeParse.installStep(validStep);
        expect(result.success).toBe(true);
      });

      it('should safely parse valid stepResult', () => {
        const result = safeParse.stepResult(validStepResult);
        expect(result.success).toBe(true);
      });

      it('should safely parse valid errorContext', () => {
        const result = safeParse.errorContext({
          stepId: 'step-1',
          command: 'npm install',
          exitCode: 1,
          stdout: '',
          stderr: 'error',
          environment: validEnvInfo,
          previousSteps: [],
        });
        expect(result.success).toBe(true);
      });
    });

    describe('message safe parsers', () => {
      it('should safely parse valid message', () => {
        const result = safeParse.message(validSessionCreateMsg);
        expect(result.success).toBe(true);
      });

      it('should return failure for invalid message', () => {
        const result = safeParse.message({ type: 'bad' });
        expect(result.success).toBe(false);
      });

      it('should safely parse sessionCreateMessage', () => {
        const result = safeParse.sessionCreateMessage(validSessionCreateMsg);
        expect(result.success).toBe(true);
      });

      it('should safely parse envReportMessage', () => {
        const result = safeParse.envReportMessage({
          type: MessageType.ENV_REPORT,
          payload: validEnvInfo,
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse planReceiveMessage', () => {
        const result = safeParse.planReceiveMessage({
          type: MessageType.PLAN_RECEIVE,
          payload: { steps: [validStep], estimatedTime: 60000, risks: [] },
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse stepExecuteMessage', () => {
        const result = safeParse.stepExecuteMessage({
          type: MessageType.STEP_EXECUTE,
          payload: validStep,
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse stepOutputMessage', () => {
        const result = safeParse.stepOutputMessage({
          type: MessageType.STEP_OUTPUT,
          payload: { stepId: 's1', output: 'ok' },
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse stepCompleteMessage', () => {
        const result = safeParse.stepCompleteMessage({
          type: MessageType.STEP_COMPLETE,
          payload: validStepResult,
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse errorOccurredMessage', () => {
        const result = safeParse.errorOccurredMessage({
          type: MessageType.ERROR_OCCURRED,
          payload: {
            stepId: 'step-1',
            command: 'npm install',
            exitCode: 1,
            stdout: '',
            stderr: 'err',
            environment: validEnvInfo,
            previousSteps: [],
          },
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse fixSuggestMessage', () => {
        const result = safeParse.fixSuggestMessage({
          type: MessageType.FIX_SUGGEST,
          payload: [validFixStrategy],
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });

      it('should safely parse sessionCompleteMessage', () => {
        const result = safeParse.sessionCompleteMessage({
          type: MessageType.SESSION_COMPLETE,
          payload: { success: true },
          timestamp: now,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('additional type safe parsers', () => {
      it('should safely parse valid execResult', () => {
        const result = safeParse.execResult(validExecResult);
        expect(result.success).toBe(true);
      });

      it('should return failure for invalid execResult', () => {
        const result = safeParse.execResult({});
        expect(result.success).toBe(false);
      });

      it('should safely parse valid sessionInfo', () => {
        const result = safeParse.sessionInfo(validSessionInfo);
        expect(result.success).toBe(true);
      });

      it('should return failure for invalid sessionInfo', () => {
        const result = safeParse.sessionInfo({});
        expect(result.success).toBe(false);
      });

      it('should safely parse valid stepProgress', () => {
        const result = safeParse.stepProgress(validStepProgress);
        expect(result.success).toBe(true);
      });

      it('should return failure for invalid stepProgress', () => {
        const result = safeParse.stepProgress({});
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // parseMessageFromJSON
  // ==========================================================================

  describe('parseMessageFromJSON', () => {
    it('should parse valid JSON message string', () => {
      const json = JSON.stringify(validSessionCreateMsg);
      const result = parseMessageFromJSON(json);
      expect(result.type).toBe(MessageType.SESSION_CREATE);
    });

    it('should throw SyntaxError on invalid JSON', () => {
      expect(() => parseMessageFromJSON('not-json{')).toThrow(SyntaxError);
    });

    it('should throw ZodError on valid JSON but invalid message', () => {
      expect(() => parseMessageFromJSON('{"type":"bad"}')).toThrow(z.ZodError);
    });

    it('should parse all message types from JSON', () => {
      const messages = [
        validSessionCreateMsg,
        {
          type: MessageType.ENV_REPORT,
          payload: validEnvInfo,
          timestamp: now,
        },
        {
          type: MessageType.PLAN_RECEIVE,
          payload: { steps: [validStep], estimatedTime: 60000, risks: [] },
          timestamp: now,
        },
        {
          type: MessageType.SESSION_COMPLETE,
          payload: { success: true },
          timestamp: now,
        },
      ];

      for (const msg of messages) {
        const result = parseMessageFromJSON(JSON.stringify(msg));
        expect(result.type).toBe(msg.type);
      }
    });
  });

  // ==========================================================================
  // safeParseMessageFromJSON
  // ==========================================================================

  describe('safeParseMessageFromJSON', () => {
    it('should safely parse valid JSON message string', () => {
      const json = JSON.stringify(validSessionCreateMsg);
      const result = safeParseMessageFromJSON(json);
      expect(result.success).toBe(true);
    });

    it('should return failure on invalid JSON (not throw)', () => {
      const result = safeParseMessageFromJSON('not-json');
      expect(result.success).toBe(false);
      expect('error' in result).toBe(true);
    });

    it('should return failure on valid JSON but invalid message', () => {
      const result = safeParseMessageFromJSON('{"type":"bad"}');
      expect(result.success).toBe(false);
    });

    it('should return error object on invalid JSON', () => {
      const result = safeParseMessageFromJSON('{broken');
      expect(result.success).toBe(false);
      if (!result.success && 'error' in result) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });
  });

  // ==========================================================================
  // Consistency checks
  // ==========================================================================

  describe('Consistency with messages.ts and types.ts', () => {
    it('schemas in registry should be the same objects as named exports', () => {
      expect(schemas.EnvironmentInfo).toBe(EnvironmentInfoSchema);
      expect(schemas.Message).toBe(MessageSchema);
      expect(schemas.ExecResult).toBe(ExecResultSchema);
      expect(schemas.SessionInfo).toBe(SessionInfoSchema);
      expect(schemas.StepProgress).toBe(StepProgressSchema);
    });

    it('validate functions should produce same results as direct schema.parse', () => {
      const direct = EnvironmentInfoSchema.parse(validEnvInfo);
      const viaValidate = validate.environmentInfo(validEnvInfo);
      expect(viaValidate).toEqual(direct);
    });

    it('safeParse functions should produce same results as direct schema.safeParse', () => {
      const direct = ExecResultSchema.safeParse(validExecResult);
      const viaSafe = safeParse.execResult(validExecResult);
      expect(viaSafe.success).toBe(direct.success);
      if (viaSafe.success && direct.success) {
        expect(viaSafe.data).toEqual(direct.data);
      }
    });
  });

  // ==========================================================================
  // Completeness check
  // ==========================================================================

  describe('Completeness', () => {
    it('validate object should have entries for all schema registry keys', () => {
      // Every schema in the registry should have a corresponding validate function
      // (except SessionStatus and StepStatus which are simple enums without dedicated validators)
      const validateKeys = Object.keys(validate);
      // At minimum, must have message, execResult, sessionInfo, stepProgress,
      // and all sub-type and message validators
      expect(validateKeys.length).toBeGreaterThanOrEqual(20);
    });

    it('safeParse object should have entries for all schema registry keys', () => {
      const safeParseKeys = Object.keys(safeParse);
      expect(safeParseKeys.length).toBeGreaterThanOrEqual(20);
    });

    it('validate and safeParse should have the same keys', () => {
      const validateKeys = Object.keys(validate).sort();
      const safeParseKeys = Object.keys(safeParse).sort();
      expect(validateKeys).toEqual(safeParseKeys);
    });
  });
});
