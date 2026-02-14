// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for CE edition single-server limit enforcement in handleAuthRequest.
 *
 * Verifies that:
 * - CE mode rejects a second server's agent connection
 * - CE mode allows the first server's agent connection
 * - CE mode allows the same server to reconnect
 * - EE mode has no server limit
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import { createMessage, MessageType } from "@aiinstaller/shared";
import type { AuthRequestMessage, Message } from "@aiinstaller/shared";
import type { FeatureFlags, EditionInfo } from "../config/edition.js";
import { resolveFeatures } from "../config/edition.js";

// ============================================================================
// Module Mocks
// ============================================================================

// Mock edition config with controllable features
let activeFeatures: FeatureFlags;

vi.mock("../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../config/edition.js")>();
  return {
    ...original,
    get FEATURES() {
      return activeFeatures;
    },
  };
});

// Mock authenticateDevice to return success without external calls
vi.mock("./auth-handler.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auth-handler.js")>();
  return {
    ...original,
    authenticateDevice: vi.fn(async () => ({
      success: true,
      deviceToken: "mock-token-123",
      quota: { limit: 999, used: 0, remaining: 999 },
      plan: "self-hosted",
    })),
  };
});

// Mock server status bus to prevent errors
vi.mock("../core/server-status-bus.js", () => ({
  getServerStatusBus: vi.fn(() => ({
    publish: vi.fn(),
  })),
}));

import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from "../db/repositories/server-repository.js";
import { InstallServer } from "./server.js";
import { handleAuthRequest } from "./handlers.js";

// ============================================================================
// Edition Constants
// ============================================================================

const ceInfo: EditionInfo = {
  edition: "ce",
  isCE: true,
  isEE: false,
  isCloud: false,
};
const eeInfo: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: false,
};

const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19400;
function nextPort(): number {
  return testPort++;
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => reject(err));
  });
}

function collectMessages(ws: WebSocket): Message[] {
  const messages: Message[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
  });
  return messages;
}

function makeAuthRequest(deviceId: string): AuthRequestMessage {
  return createMessage(MessageType.AUTH_REQUEST, {
    deviceId,
    deviceToken: "mock-token-123",
    platform: "linux",
    osVersion: "22.04",
    architecture: "x64",
    hostname: "test-host",
  }) as AuthRequestMessage;
}

/** Wait a short time for async messages to be delivered. */
function tick(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe("CE single-server limit in handleAuthRequest", () => {
  let server: InstallServer;
  let ws: WebSocket;
  let repo: InMemoryServerRepository;

  beforeEach(() => {
    repo = new InMemoryServerRepository();
    setServerRepository(repo);
  });

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server?.isRunning()) {
      await server.stop();
    }
    _resetServerRepository();
  });

  // --------------------------------------------------------------------------
  // CE Mode
  // --------------------------------------------------------------------------

  describe("CE mode", () => {
    beforeEach(() => {
      activeFeatures = ceFeatures;
    });

    it("allows first server agent to connect", async () => {
      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;

      const result = await handleAuthRequest(
        server,
        clientId,
        makeAuthRequest("server-1"),
      );
      expect(result.success).toBe(true);
      expect(server.isClientAuthenticated(clientId)).toBe(true);
    });

    it("rejects second server agent with different deviceId", async () => {
      // Seed an existing server
      await repo.create({ name: "existing-server", userId: "user-1" });

      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;
      const messages = collectMessages(ws);

      const result = await handleAuthRequest(
        server,
        clientId,
        makeAuthRequest("different-server"),
      );

      // Handler returns success (protocol-level; actual rejection is via message)
      expect(result.success).toBe(true);

      // Client should NOT be authenticated
      expect(server.isClientAuthenticated(clientId)).toBe(false);

      // Wait for rejection message to arrive
      await tick();

      // Should have received both the initial success + the rejection message
      const rejectMsg = messages.find(
        (m) => m.type === MessageType.AUTH_RESPONSE && !m.payload.success,
      );
      expect(rejectMsg).toBeDefined();
      expect(rejectMsg!.payload.error).toContain("Community Edition");
      expect(rejectMsg!.payload.error).toContain("Enterprise Edition");
    });

    it("allows same server to reconnect (deviceId matches existing)", async () => {
      // Create a server with a known ID
      const existing = await repo.create({
        name: "my-server",
        userId: "user-1",
      });

      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;

      const result = await handleAuthRequest(
        server,
        clientId,
        makeAuthRequest(existing.id),
      );
      expect(result.success).toBe(true);
      expect(server.isClientAuthenticated(clientId)).toBe(true);
    });

    it("closes WebSocket connection after rejecting second server", async () => {
      await repo.create({ name: "existing-server", userId: "user-1" });

      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;

      const closePromise = new Promise<{ code: number }>((resolve) => {
        ws.on("close", (code) => resolve({ code }));
      });

      await handleAuthRequest(server, clientId, makeAuthRequest("new-server"));

      const { code } = await closePromise;
      expect(code).toBe(4403);
    });
  });

  // --------------------------------------------------------------------------
  // EE Mode
  // --------------------------------------------------------------------------

  describe("EE mode", () => {
    beforeEach(() => {
      activeFeatures = eeFeatures;
    });

    it("allows multiple servers in EE mode", async () => {
      // Create existing server
      await repo.create({ name: "server-1", userId: "user-1" });

      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;

      // Different server should connect fine in EE
      const result = await handleAuthRequest(
        server,
        clientId,
        makeAuthRequest("server-2"),
      );
      expect(result.success).toBe(true);
      expect(server.isClientAuthenticated(clientId)).toBe(true);
    });

    it("allows reconnection in EE mode", async () => {
      const existing = await repo.create({
        name: "server-1",
        userId: "user-1",
      });

      const port = nextPort();
      server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
      const clientIdPromise = new Promise<string>((resolve) => {
        server.on("connection", (id) => resolve(id));
      });
      await server.start();
      ws = await connectClient(port);
      const clientId = await clientIdPromise;

      const result = await handleAuthRequest(
        server,
        clientId,
        makeAuthRequest(existing.id),
      );
      expect(result.success).toBe(true);
      expect(server.isClientAuthenticated(clientId)).toBe(true);
    });
  });
});
