// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for WebSocket authentication handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthRequestMessage } from "@aiinstaller/shared";
import { MessageType, PROTOCOL_VERSION } from "@aiinstaller/shared";
import {
  authenticateDevice,
  createAuthResponse,
  hasQuota,
  createAuthTimeout,
} from "./auth-handler.js";
import { DeviceClient } from "./device-client.js";

// Mock DeviceClient
vi.mock("./device-client.js", () => ({
  DeviceClient: {
    verify: vi.fn(),
    register: vi.fn(),
  },
}));

describe("auth-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REMOVED: authenticateDevice tests for Cloud mode (DeviceClient removed for self-hosted version)
  // The authenticateDevice function now only supports local agent auth via tryLocalAgentAuth()

  describe("createAuthResponse", () => {
    it("should create success auth response", () => {
      const authResult = {
        success: true,
        deviceToken: "token-123",
        quota: {
          limit: 10,
          used: 3,
          remaining: 7,
        },
        plan: "pro",
      };

      const response = createAuthResponse(authResult, "req-123");

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(true);
      expect(response.payload.deviceToken).toBe("token-123");
      expect(response.payload.quotaLimit).toBe(10);
      expect(response.payload.quotaUsed).toBe(3);
      expect(response.payload.quotaRemaining).toBe(7);
      expect(response.payload.plan).toBe("pro");
      expect(response.requestId).toBe("req-123");
    });

    it("should create failure auth response", () => {
      const authResult = {
        success: false,
        error: "Invalid credentials",
      };

      const response = createAuthResponse(authResult);

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toBe("Invalid credentials");
      expect(response.requestId).toBeUndefined();
    });

    it("should include ban information", () => {
      const authResult = {
        success: false,
        error: "Device banned",
        banned: true,
        banReason: "Terms violation",
      };

      const response = createAuthResponse(authResult);

      expect(response.payload.success).toBe(false);
      expect(response.payload.banned).toBe(true);
      expect(response.payload.banReason).toBe("Terms violation");
    });
  });

  describe("hasQuota", () => {
    it("should return true when quota remaining", () => {
      const authResult = {
        success: true,
        deviceToken: "token",
        quota: {
          limit: 5,
          used: 2,
          remaining: 3,
        },
      };

      expect(hasQuota(authResult)).toBe(true);
    });

    it("should return false when no quota remaining", () => {
      const authResult = {
        success: true,
        deviceToken: "token",
        quota: {
          limit: 5,
          used: 5,
          remaining: 0,
        },
      };

      expect(hasQuota(authResult)).toBe(false);
    });

    it("should return false when auth failed", () => {
      const authResult = {
        success: false,
        error: "Auth failed",
      };

      expect(hasQuota(authResult)).toBe(false);
    });

    it("should return false when quota not provided", () => {
      const authResult = {
        success: true,
        deviceToken: "token",
      };

      expect(hasQuota(authResult)).toBe(false);
    });
  });

  describe("createAuthTimeout", () => {
    it("should reject after timeout", async () => {
      const promise = createAuthTimeout(100);

      await expect(promise).rejects.toThrow("Authentication timeout");
    }, 1000);

    it("should use custom timeout", async () => {
      const start = Date.now();
      const promise = createAuthTimeout(200);

      await expect(promise).rejects.toThrow("Authentication timeout");

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(300);
    }, 1000);
  });

  describe("createAuthResponse — version negotiation", () => {
    it("should include server protocolVersion in response", () => {
      const response = createAuthResponse({
        success: true,
        deviceToken: "tok",
      });
      expect(response.payload.protocolVersion).toBe(PROTOCOL_VERSION);
    });

    it("should include versionCheck for matching agent version", () => {
      const response = createAuthResponse(
        { success: true, deviceToken: "tok" },
        "req-1",
        "1.0.0",
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe("ok");
    });

    it("should include versionCheck warn for legacy agent (no version)", () => {
      const response = createAuthResponse(
        { success: true, deviceToken: "tok" },
        "req-2",
        undefined,
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe("warn");
      expect(response.payload.versionCheck!.message).toContain("legacy");
    });

    it("should include versionCheck error for incompatible major version", () => {
      const response = createAuthResponse(
        { success: false, error: "version mismatch" },
        "req-3",
        "2.0.0",
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(false);
      expect(response.payload.versionCheck!.severity).toBe("error");
    });

    it("should include versionCheck error when agent minor exceeds server", () => {
      const response = createAuthResponse(
        { success: false, error: "version mismatch" },
        "req-4",
        "1.5.0",
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(false);
      expect(response.payload.versionCheck!.severity).toBe("error");
    });

    it("should include versionCheck warn for invalid agent version format", () => {
      const response = createAuthResponse(
        { success: true, deviceToken: "tok" },
        "req-5",
        "garbage",
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe("warn");
    });
  });
});
