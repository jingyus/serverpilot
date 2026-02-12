// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useChatStore } from './chat';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/api/sse', () => ({
  createSSEConnection: vi.fn(() => ({
    abort: vi.fn(),
    controller: new AbortController(),
  })),
}));

import { apiRequest } from '@/api/client';
import { createSSEConnection } from '@/api/sse';

function getSSECallbacks(): Record<string, (...args: unknown[]) => void> {
  const mockFn = createSSEConnection as Mock;
  const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
  return lastCall[2] as Record<string, (...args: unknown[]) => void>;
}

describe('chat-execution (via useChatStore)', () => {
  beforeEach(() => {
    useChatStore.setState({
      serverId: null,
      sessionId: null,
      messages: [],
      sessions: [],
      isLoading: false,
      isStreaming: false,
      isReconnecting: false,
      streamingContent: '',
      error: null,
      currentPlan: null,
      planStatus: 'none',
      execution: {
        activeStepId: null,
        outputs: {},
        completedSteps: {},
        success: null,
        operationId: null,
        startTime: null,
        cancelled: false,
      },
      executionMode: 'none',
      pendingConfirm: null,
      toolCalls: [],
      agenticConfirm: null,
      isAgenticMode: false,
    });
    vi.clearAllMocks();
  });

  describe('buildStreamingCallbacks (sendMessage SSE)', () => {
    it('onAutoExecute with inline mode strips json-plan and sets inline execution', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('install nginx');

      useChatStore.setState({
        streamingContent: 'Here is the plan\n```json-plan\n{"steps":[]}\n```\n',
      });

      const callbacks = getSSECallbacks();
      callbacks.onAutoExecute(JSON.stringify({
        plan: {
          planId: 'p1',
          description: 'Install',
          steps: [{ id: 's1', command: 'apt install nginx', description: 'Install', riskLevel: 'green' }],
          totalRisk: 'green',
          requiresConfirmation: false,
        },
      }));

      const state = useChatStore.getState();
      expect(state.executionMode).toBe('inline');
      expect(state.planStatus).toBe('executing');
      expect(state.streamingContent).toBe('Here is the plan\n\n');
      expect(state.execution.startTime).toBeTypeOf('number');
    });

    it('onAutoExecute with log mode commits text as message', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('install nginx');

      useChatStore.setState({
        streamingContent: 'Analysis complete',
        currentPlan: {
          planId: 'p1',
          description: 'Install',
          steps: [],
          totalRisk: 'yellow',
          requiresConfirmation: true,
        },
      });

      const callbacks = getSSECallbacks();
      callbacks.onAutoExecute(JSON.stringify({}));

      const state = useChatStore.getState();
      expect(state.executionMode).toBe('log');
      expect(state.streamingContent).toBe('');
      // User msg + committed assistant msg
      expect(state.messages.length).toBeGreaterThanOrEqual(2);
      expect(state.messages[state.messages.length - 1].content).toBe('Analysis complete');
    });

    it('onStepStart sets active step without duplicate branches (bug fix)', () => {
      useChatStore.setState({ serverId: 'srv-1', executionMode: 'inline' });
      useChatStore.getState().sendMessage('test');

      const callbacks = getSSECallbacks();
      callbacks.onStepStart(JSON.stringify({ stepId: 'step-1' }));

      expect(useChatStore.getState().execution.activeStepId).toBe('step-1');
    });

    it('onOutput in inline mode appends to streamingContent', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({ executionMode: 'inline', streamingContent: 'prior ' });

      const callbacks = getSSECallbacks();
      callbacks.onOutput(JSON.stringify({ stepId: 's1', content: 'output data' }));

      expect(useChatStore.getState().streamingContent).toBe('prior output data');
    });

    it('onOutput in log mode appends to execution outputs', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({ executionMode: 'log' });

      const callbacks = getSSECallbacks();
      callbacks.onOutput(JSON.stringify({ stepId: 's1', content: 'log output' }));

      expect(useChatStore.getState().execution.outputs['s1']).toBe('log output');
    });

    it('onStepComplete in inline mode appends newline separator', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({ executionMode: 'inline', streamingContent: 'cmd output' });

      const callbacks = getSSECallbacks();
      callbacks.onStepComplete(JSON.stringify({ stepId: 's1', exitCode: 0, duration: 100 }));

      const state = useChatStore.getState();
      expect(state.streamingContent).toBe('cmd output\n');
      expect(state.execution.completedSteps['s1']).toEqual({ exitCode: 0, duration: 100 });
    });

    it('onComplete for normal chat (not executing) commits message', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      useChatStore.setState({ streamingContent: 'AI response here' });

      const callbacks = getSSECallbacks();
      callbacks.onComplete(JSON.stringify({}));

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages.length).toBe(2); // user + assistant
      expect(state.messages[1].content).toBe('AI response here');
    });

    it('onComplete for inline execution commits content as message', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({
        planStatus: 'executing',
        executionMode: 'inline',
        streamingContent: 'Installed nginx\n$ apt install nginx\nok',
      });

      const callbacks = getSSECallbacks();
      callbacks.onComplete(JSON.stringify({ success: true, operationId: 'op-1' }));

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.planStatus).toBe('completed');
      expect(state.executionMode).toBe('none');
      expect(state.execution.success).toBe(true);
    });

    it('onToolCall sets agentic mode and adds tool call entry', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      const callbacks = getSSECallbacks();
      callbacks.onToolCall(JSON.stringify({ id: 'tc-1', tool: 'execute_command', status: 'running' }));

      const state = useChatStore.getState();
      expect(state.isAgenticMode).toBe(true);
      expect(state.toolCalls).toHaveLength(1);
      expect(state.toolCalls[0]).toMatchObject({ id: 'tc-1', tool: 'execute_command', status: 'running' });
    });

    it('onToolExecuting appends bash code block to streaming', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({
        streamingContent: 'some text',
        toolCalls: [{ id: 'tc-1', tool: 'execute_command', status: 'running' as const, output: '' }],
      });

      const callbacks = getSSECallbacks();
      callbacks.onToolExecuting(JSON.stringify({ id: 'tc-1', tool: 'execute_command', command: 'ls -la' }));

      const state = useChatStore.getState();
      expect(state.streamingContent).toContain('$ ls -la');
      expect(state.toolCalls[0].command).toBe('ls -la');
    });

    it('onToolResult closes code block and updates status', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('test');

      useChatStore.setState({
        streamingContent: 'running...',
        toolCalls: [{ id: 'tc-1', tool: 'execute_command', status: 'running' as const, output: 'data' }],
      });

      const callbacks = getSSECallbacks();
      callbacks.onToolResult(JSON.stringify({
        id: 'tc-1', tool: 'execute_command', status: 'completed',
        exitCode: 0, duration: 50,
      }));

      const state = useChatStore.getState();
      expect(state.streamingContent).toContain('\n```\n');
      expect(state.toolCalls[0].status).toBe('completed');
      expect(state.toolCalls[0].exitCode).toBe(0);
    });
  });

  describe('respondToStep', () => {
    it('sends step decision API and clears pendingConfirm', async () => {
      (apiRequest as Mock).mockResolvedValueOnce({});

      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'yellow',
          requiresConfirmation: true,
        },
        pendingConfirm: {
          stepId: 'step-1',
          command: 'rm -rf /tmp',
          description: 'Remove temp',
          riskLevel: 'red',
        },
      });

      await useChatStore.getState().respondToStep('allow');

      expect(apiRequest).toHaveBeenCalledWith('/chat/srv-1/step-decision', expect.objectContaining({
        method: 'POST',
      }));
      expect(useChatStore.getState().pendingConfirm).toBeNull();
    });

    it('sets cancelled state on reject decision', async () => {
      (apiRequest as Mock).mockResolvedValueOnce({});

      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'yellow',
          requiresConfirmation: true,
        },
        pendingConfirm: {
          stepId: 'step-1',
          command: 'cmd',
          description: 'desc',
          riskLevel: 'yellow',
        },
      });

      await useChatStore.getState().respondToStep('reject');

      const state = useChatStore.getState();
      expect(state.planStatus).toBe('completed');
      expect(state.execution.cancelled).toBe(true);
      expect(state.execution.success).toBe(false);
    });

    it('does nothing without required state', async () => {
      await useChatStore.getState().respondToStep('allow');
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe('rejectPlan (bug fix: merged set calls)', () => {
    it('clears plan and adds system message in single atomic update', () => {
      useChatStore.setState({
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'preview',
        executionMode: 'log',
        pendingConfirm: { stepId: 's1', command: 'cmd', description: 'desc', riskLevel: 'green' },
      });

      useChatStore.getState().rejectPlan();

      const state = useChatStore.getState();
      expect(state.currentPlan).toBeNull();
      expect(state.planStatus).toBe('none');
      expect(state.executionMode).toBe('none');
      expect(state.pendingConfirm).toBeNull();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe('system');
    });
  });
});
