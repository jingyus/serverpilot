// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for AgentConnector CE mode behavior.
 *
 * Verifies that the agent connector works correctly in single-agent
 * (CE) scenarios: exactly one server, one agent connection, and no
 * multi-agent assumptions cause failures.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { InstallServer } from "../../api/server.js";
import {
  initAgentConnector,
  findConnectedAgent,
  isAgentConnected,
  getConnectedAgentCount,
  _resetAgentConnector,
} from "./agent-connector.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockServer(
  overrides: Partial<InstallServer> = {},
): InstallServer {
  return {
    getClientsByDeviceId: vi.fn(() => []),
    getClientCount: vi.fn(() => 0),
    send: vi.fn(),
    ...overrides,
  } as unknown as InstallServer;
}

// ============================================================================
// CE Mode — Single Agent Scenarios
// ============================================================================

describe("AgentConnector — CE single-agent mode", () => {
  beforeEach(() => {
    _resetAgentConnector();
  });

  it("returns exactly one agent when single server is connected", () => {
    const server = createMockServer({
      getClientsByDeviceId: vi.fn((deviceId: string) =>
        deviceId === "local-server" ? ["client-1"] : [],
      ),
      getClientCount: vi.fn(() => 1),
    });
    initAgentConnector(server);

    expect(findConnectedAgent("local-server")).toBe("client-1");
    expect(isAgentConnected("local-server")).toBe(true);
    expect(getConnectedAgentCount()).toBe(1);
  });

  it("returns null for non-existent server (CE has only one)", () => {
    const server = createMockServer({
      getClientsByDeviceId: vi.fn((deviceId: string) =>
        deviceId === "local-server" ? ["client-1"] : [],
      ),
      getClientCount: vi.fn(() => 1),
    });
    initAgentConnector(server);

    // Query for a server that doesn't exist in CE
    expect(findConnectedAgent("other-server")).toBeNull();
    expect(isAgentConnected("other-server")).toBe(false);
  });

  it("reports zero connected agents when no agent has connected", () => {
    const server = createMockServer({
      getClientsByDeviceId: vi.fn(() => []),
      getClientCount: vi.fn(() => 0),
    });
    initAgentConnector(server);

    expect(getConnectedAgentCount()).toBe(0);
    expect(findConnectedAgent("local-server")).toBeNull();
    expect(isAgentConnected("local-server")).toBe(false);
  });

  it("handles agent reconnection (same deviceId, new clientId)", () => {
    // First connection
    const server = createMockServer({
      getClientsByDeviceId: vi.fn(() => ["client-new"]),
      getClientCount: vi.fn(() => 1),
    });
    initAgentConnector(server);

    // After reconnection, same server has a new client ID
    expect(findConnectedAgent("local-server")).toBe("client-new");
    expect(getConnectedAgentCount()).toBe(1);
  });
});
