// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for AgentConnector module.
 *
 * @module core/agent/agent-connector.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initAgentConnector,
  findConnectedAgent,
  isAgentConnected,
  executeCommandOnAgent,
  getConnectedAgentCount,
  _resetAgentConnector,
} from './agent-connector.js';
import type { InstallServer } from '../../api/server.js';
import { getTaskExecutor, setTaskExecutor } from '../task/executor.js';
import type { TaskExecutor } from '../task/executor.js';

// ============================================================================
// Test Setup
// ============================================================================

function createMockServer(overrides: Partial<InstallServer> = {}): InstallServer {
  return {
    getClientsByDeviceId: vi.fn(() => []),
    getClientCount: vi.fn(() => 0),
    send: vi.fn(),
    ...overrides,
  } as unknown as InstallServer;
}

function createMockExecutor(overrides: Partial<TaskExecutor> = {}): TaskExecutor {
  return {
    executeCommand: vi.fn(),
    ...overrides,
  } as unknown as TaskExecutor;
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentConnector', () => {
  beforeEach(() => {
    _resetAgentConnector();
  });

  describe('initAgentConnector', () => {
    it('should initialize the connector with a server instance', () => {
      const server = createMockServer();
      expect(() => initAgentConnector(server)).not.toThrow();
    });
  });

  describe('findConnectedAgent', () => {
    it('should return null when no agent is connected', () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => []),
      });
      initAgentConnector(server);

      const clientId = findConnectedAgent('srv-123');
      expect(clientId).toBeNull();
    });

    it('should return the first client ID when an agent is connected', () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => ['client-abc', 'client-def']),
      });
      initAgentConnector(server);

      const clientId = findConnectedAgent('srv-123');
      expect(clientId).toBe('client-abc');
    });

    it('should call getClientsByDeviceId with the serverId', () => {
      const getClientsByDeviceId = vi.fn(() => ['client-1']);
      const server = createMockServer({ getClientsByDeviceId });
      initAgentConnector(server);

      findConnectedAgent('srv-456');
      expect(getClientsByDeviceId).toHaveBeenCalledWith('srv-456');
    });
  });

  describe('isAgentConnected', () => {
    it('should return false when no agent is connected', () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => []),
      });
      initAgentConnector(server);

      expect(isAgentConnected('srv-123')).toBe(false);
    });

    it('should return true when an agent is connected', () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => ['client-1']),
      });
      initAgentConnector(server);

      expect(isAgentConnected('srv-123')).toBe(true);
    });
  });

  describe('executeCommandOnAgent', () => {
    it('should throw an error when no agent is connected', async () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => []),
      });
      initAgentConnector(server);

      const executor = createMockExecutor();
      setTaskExecutor(executor);

      await expect(
        executeCommandOnAgent({
          serverId: 'srv-123',
          userId: 'user-1',
          command: 'ls -la',
          description: 'List files',
          riskLevel: 'green',
          type: 'execute',
        }),
      ).rejects.toThrow('No agent connected for server srv-123');
    });

    it('should execute the command when an agent is connected', async () => {
      const server = createMockServer({
        getClientsByDeviceId: vi.fn(() => ['client-1']),
      });
      initAgentConnector(server);

      const executeCommand = vi.fn().mockResolvedValue({
        success: true,
        executionId: 'exec-1',
        operationId: 'op-1',
        exitCode: 0,
        stdout: 'command output',
        stderr: '',
        duration: 100,
        timedOut: false,
      });

      const executor = createMockExecutor({ executeCommand });
      setTaskExecutor(executor);

      const result = await executeCommandOnAgent({
        serverId: 'srv-123',
        userId: 'user-1',
        command: 'ls -la',
        description: 'List files',
        riskLevel: 'green',
        type: 'execute',
      });

      expect(result.success).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith({
        serverId: 'srv-123',
        userId: 'user-1',
        clientId: 'client-1',
        command: 'ls -la',
        description: 'List files',
        riskLevel: 'green',
        type: 'execute',
      });
    });
  });

  describe('getConnectedAgentCount', () => {
    it('should return the count of connected clients', () => {
      const server = createMockServer({
        getClientCount: vi.fn(() => 5),
      });
      initAgentConnector(server);

      expect(getConnectedAgentCount()).toBe(5);
    });
  });

  describe('error handling', () => {
    it('should throw an error when connector is not initialized', () => {
      _resetAgentConnector();
      expect(() => findConnectedAgent('srv-123')).toThrow(
        'AgentConnector not initialized',
      );
    });
  });
});
