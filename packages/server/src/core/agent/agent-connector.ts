/**
 * Agent Connector — bridges REST API and WebSocket connections.
 *
 * Provides helper functions to find connected agents for servers
 * and execute commands through the WebSocket layer.
 *
 * @module core/agent/agent-connector
 */

import type { InstallServer } from '../../api/server.js';
import { getTaskExecutor } from '../task/executor.js';
import type { ExecuteCommandInput, ExecutionResult } from '../task/executor.js';

// ============================================================================
// Global State
// ============================================================================

let _server: InstallServer | null = null;

/**
 * Initialize the agent connector with an InstallServer instance.
 *
 * Must be called during server startup before using any connector functions.
 *
 * @param server - The WebSocket server instance
 */
export function initAgentConnector(server: InstallServer): void {
  _server = server;
}

/**
 * Get the current InstallServer instance.
 *
 * @returns The InstallServer, or throws if not initialized
 */
function getServer(): InstallServer {
  if (!_server) {
    throw new Error('AgentConnector not initialized — call initAgentConnector first');
  }
  return _server;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Find a connected WebSocket client for a given server.
 *
 * Agents authenticate with their serverId as deviceId, so we can
 * look up connected clients by serverId.
 *
 * @param serverId - The server ID to find an agent for
 * @returns The WebSocket client ID, or null if no agent is connected
 */
export function findConnectedAgent(serverId: string): string | null {
  const server = getServer();
  // Agents are identified by their serverId as deviceId
  const clients = server.getClientsByDeviceId(serverId);
  return clients.length > 0 ? clients[0] : null;
}

/**
 * Check if an agent is currently connected for a given server.
 *
 * @param serverId - The server ID to check
 * @returns True if an agent is connected and authenticated
 */
export function isAgentConnected(serverId: string): boolean {
  return findConnectedAgent(serverId) !== null;
}

/**
 * Execute a command on an agent and wait for the result.
 *
 * This is a convenience wrapper around TaskExecutor that automatically
 * finds the connected agent's clientId.
 *
 * @param params - Command execution parameters (excluding clientId)
 * @returns The execution result
 * @throws {Error} When no agent is connected for the server
 */
export async function executeCommandOnAgent(
  params: Omit<ExecuteCommandInput, 'clientId'>,
): Promise<ExecutionResult> {
  const clientId = findConnectedAgent(params.serverId);

  if (!clientId) {
    throw new Error(`No agent connected for server ${params.serverId}`);
  }

  const executor = getTaskExecutor();
  return executor.executeCommand({
    ...params,
    clientId,
  });
}

/**
 * Get the number of connected agents across all servers.
 *
 * @returns The total count of connected WebSocket clients
 */
export function getConnectedAgentCount(): number {
  const server = getServer();
  return server.getClientCount();
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Reset the connector state (for testing).
 * @internal
 */
export function _resetAgentConnector(): void {
  _server = null;
}
