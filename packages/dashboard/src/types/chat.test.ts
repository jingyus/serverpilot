import { describe, it, expect } from 'vitest';
import {
  RiskLevelSchema,
  PlanStepSchema,
  ExecutionPlanSchema,
  ChatMessageSchema,
  StepOutputSchema,
  StepCompleteSchema,
  ExecutionCompleteSchema,
  SessionSummarySchema,
  RISK_CONFIG,
  MAX_MESSAGE_LENGTH,
} from './chat';

describe('Chat Types - Zod Schemas', () => {
  describe('RiskLevelSchema', () => {
    it('accepts valid risk levels', () => {
      expect(RiskLevelSchema.parse('green')).toBe('green');
      expect(RiskLevelSchema.parse('yellow')).toBe('yellow');
      expect(RiskLevelSchema.parse('red')).toBe('red');
      expect(RiskLevelSchema.parse('critical')).toBe('critical');
    });

    it('rejects invalid risk levels', () => {
      expect(() => RiskLevelSchema.parse('unknown')).toThrow();
      expect(() => RiskLevelSchema.parse('')).toThrow();
    });
  });

  describe('PlanStepSchema', () => {
    it('parses a valid plan step', () => {
      const step = PlanStepSchema.parse({
        id: 'step-1',
        description: 'Install nginx',
        command: 'apt install nginx',
        riskLevel: 'green',
      });
      expect(step.id).toBe('step-1');
      expect(step.timeout).toBe(30000);
      expect(step.canRollback).toBe(false);
    });

    it('parses step with optional fields', () => {
      const step = PlanStepSchema.parse({
        id: 'step-2',
        description: 'Configure firewall',
        command: 'ufw allow 80',
        riskLevel: 'yellow',
        rollbackCommand: 'ufw delete allow 80',
        timeout: 60000,
        canRollback: true,
      });
      expect(step.rollbackCommand).toBe('ufw delete allow 80');
      expect(step.canRollback).toBe(true);
    });

    it('rejects step missing required fields', () => {
      expect(() => PlanStepSchema.parse({ id: 'x' })).toThrow();
    });
  });

  describe('ExecutionPlanSchema', () => {
    const validPlan = {
      planId: 'plan-123',
      description: 'Install web server',
      steps: [
        {
          id: 'step-1',
          description: 'Install nginx',
          command: 'apt install nginx',
          riskLevel: 'green',
        },
      ],
      totalRisk: 'green',
      requiresConfirmation: true,
    };

    it('parses a valid execution plan', () => {
      const plan = ExecutionPlanSchema.parse(validPlan);
      expect(plan.planId).toBe('plan-123');
      expect(plan.steps).toHaveLength(1);
      expect(plan.requiresConfirmation).toBe(true);
    });

    it('parses plan with estimated time', () => {
      const plan = ExecutionPlanSchema.parse({
        ...validPlan,
        estimatedTime: 45000,
      });
      expect(plan.estimatedTime).toBe(45000);
    });

    it('rejects plan without steps', () => {
      expect(() =>
        ExecutionPlanSchema.parse({ ...validPlan, steps: undefined })
      ).toThrow();
    });
  });

  describe('ChatMessageSchema', () => {
    it('parses a user message', () => {
      const msg = ChatMessageSchema.parse({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: '2025-01-01T00:00:00Z',
      });
      expect(msg.role).toBe('user');
    });

    it('parses an assistant message with plan', () => {
      const msg = ChatMessageSchema.parse({
        id: 'msg-2',
        role: 'assistant',
        content: 'Here is the plan',
        timestamp: '2025-01-01T00:00:00Z',
        plan: {
          planId: 'p1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: false,
        },
      });
      expect(msg.plan).toBeDefined();
    });

    it('rejects invalid role', () => {
      expect(() =>
        ChatMessageSchema.parse({
          id: '1',
          role: 'invalid',
          content: 'x',
          timestamp: 'x',
        })
      ).toThrow();
    });
  });

  describe('StepOutputSchema', () => {
    it('parses valid step output', () => {
      const output = StepOutputSchema.parse({
        stepId: 'step-1',
        content: 'Installing...\n',
      });
      expect(output.stepId).toBe('step-1');
    });
  });

  describe('StepCompleteSchema', () => {
    it('parses valid step completion', () => {
      const result = StepCompleteSchema.parse({
        stepId: 'step-1',
        exitCode: 0,
        duration: 1234,
      });
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(1234);
    });
  });

  describe('ExecutionCompleteSchema', () => {
    it('parses success result', () => {
      const result = ExecutionCompleteSchema.parse({
        success: true,
        operationId: 'op-1',
        snapshotId: 'snap-1',
      });
      expect(result.success).toBe(true);
    });

    it('parses failure result without optional fields', () => {
      const result = ExecutionCompleteSchema.parse({ success: false });
      expect(result.success).toBe(false);
      expect(result.operationId).toBeUndefined();
    });
  });

  describe('SessionSummarySchema', () => {
    it('parses valid session summary', () => {
      const session = SessionSummarySchema.parse({
        id: 'sess-1',
        serverId: 'srv-1',
        messageCount: 5,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T01:00:00Z',
        lastMessage: 'Install nginx',
      });
      expect(session.messageCount).toBe(5);
    });
  });

  describe('RISK_CONFIG', () => {
    it('has configuration for all risk levels', () => {
      expect(RISK_CONFIG.green).toBeDefined();
      expect(RISK_CONFIG.yellow).toBeDefined();
      expect(RISK_CONFIG.red).toBeDefined();
      expect(RISK_CONFIG.critical).toBeDefined();
    });

    it('each level has required properties', () => {
      for (const config of Object.values(RISK_CONFIG)) {
        expect(config).toHaveProperty('label');
        expect(config).toHaveProperty('color');
        expect(config).toHaveProperty('bgColor');
        expect(config).toHaveProperty('borderColor');
      }
    });
  });

  describe('MAX_MESSAGE_LENGTH', () => {
    it('is 4000', () => {
      expect(MAX_MESSAGE_LENGTH).toBe(4000);
    });
  });
});
