/**
 * Integration tests for WebSocket authentication.
 *
 * Tests the complete authentication flow from client connection to server validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstallServer } from '../packages/server/src/api/server.js';
import { InstallClient } from '../packages/agent/src/client.js';
import { AuthenticatedClient } from '../packages/agent/src/authenticated-client.js';
import { MessageType, createMessage } from '@aiinstaller/shared';
import type { AuthRequestMessage, AuthResponseMessage } from '@aiinstaller/shared';
import { DeviceClient } from '../packages/server/src/api/device-client.js';

// Mock DeviceClient
vi.mock('../packages/server/src/api/device-client.js', () => ({
  DeviceClient: {
    verify: vi.fn(),
    register: vi.fn(),
  },
}));

// Mock device fingerprint for testing
vi.mock('../packages/agent/src/detect/device-fingerprint.js', () => ({
  getOrCreateDeviceFingerprint: vi.fn(() => ({
    deviceId: 'test-device-123',
    deviceToken: 'test-token-456',
    hostname: 'test-host',
    platform: 'darwin',
    arch: 'arm64',
    macAddressHash: 'abc123',
    username: 'testuser',
    createdAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  })),
  updateDeviceToken: vi.fn(),
  generateDeviceFingerprint: vi.fn(() => ({
    deviceId: 'test-device-123',
    hostname: 'test-host',
    platform: 'darwin',
    arch: 'arm64',
    macAddressHash: 'abc123',
    username: 'testuser',
    createdAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  })),
}));

describe('WebSocket Authentication Integration', () => {
  let server: InstallServer;
  const TEST_PORT = 3456;
  const SERVER_URL = `ws://localhost:${TEST_PORT}`;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Start server with auth enabled
    server = new InstallServer({
      port: TEST_PORT,
      host: '127.0.0.1',
      requireAuth: true,
      authTimeoutMs: 5000,
    });

    // Set up message handler to route auth messages
    server.on('message', async (clientId, message) => {
      if (message.type === MessageType.AUTH_REQUEST) {
        const { handleAuthRequest } = await import('../packages/server/src/api/handlers.js');
        await handleAuthRequest(server, clientId, message);
      }
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Successful Authentication', () => {
    it('should authenticate client with valid token', async () => {
      // Mock successful verification
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 2,
        },
      });

      const client = new InstallClient({ serverUrl: SERVER_URL });
      await client.connect();

      // Send auth request
      const authRequest = createMessage(MessageType.AUTH_REQUEST, {
        deviceId: 'test-device-123',
        deviceToken: 'test-token-456',
        platform: 'darwin',
        osVersion: '14.0',
        architecture: 'arm64',
        hostname: 'test-host',
      });

      const authResponse = await client.sendAndWait<typeof MessageType.AUTH_RESPONSE>(
        authRequest,
        MessageType.AUTH_RESPONSE,
        5000
      );

      expect(authResponse.payload.success).toBe(true);
      expect(authResponse.payload.deviceToken).toBe('test-token-456');
      expect(authResponse.payload.quotaLimit).toBe(5);
      expect(authResponse.payload.quotaUsed).toBe(2);
      expect(authResponse.payload.quotaRemaining).toBe(3);
      expect(authResponse.payload.plan).toBe('free');

      client.disconnect();
    });

    it('should auto-register new device without token', async () => {
      // Mock successful registration
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: true,
        data: {
          token: 'new-token-789',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const client = new InstallClient({ serverUrl: SERVER_URL });
      await client.connect();

      // Send auth request without token
      const authRequest = createMessage(MessageType.AUTH_REQUEST, {
        deviceId: 'new-device-456',
        platform: 'linux',
      });

      const authResponse = await client.sendAndWait<typeof MessageType.AUTH_RESPONSE>(
        authRequest,
        MessageType.AUTH_RESPONSE,
        5000
      );

      expect(authResponse.payload.success).toBe(true);
      expect(authResponse.payload.deviceToken).toBe('new-token-789');
      expect(authResponse.payload.quotaRemaining).toBe(5);

      expect(DeviceClient.register).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'new-device-456',
          platform: 'linux',
        })
      );

      client.disconnect();
    });

    it('should authenticate using AuthenticatedClient', async () => {
      // Mock successful verification
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'pro',
          quotaLimit: 20,
          quotaUsed: 5,
        },
      });

      const client = new AuthenticatedClient({ serverUrl: SERVER_URL });
      await client.connectAndAuth();

      expect(client.isAuthenticated()).toBe(true);

      const authState = client.getAuthState();
      expect(authState.authenticated).toBe(true);
      expect(authState.quota?.remaining).toBe(15);
      expect(authState.plan).toBe('pro');

      client.disconnect();
    });
  });

  describe('Authentication Failures', () => {
    it('should reject banned device', async () => {
      // Mock banned device
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: true,
          banReason: 'Terms violation',
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 10,
        },
      });

      const client = new InstallClient({
        serverUrl: SERVER_URL,
        autoReconnect: false, // Disable auto-reconnect for this test
      });
      await client.connect();

      const authRequest = createMessage(MessageType.AUTH_REQUEST, {
        deviceId: 'banned-device',
        deviceToken: 'banned-token',
        platform: 'darwin',
      });

      const authResponse = await client.sendAndWait<typeof MessageType.AUTH_RESPONSE>(
        authRequest,
        MessageType.AUTH_RESPONSE,
        5000
      );

      expect(authResponse.payload.success).toBe(false);
      expect(authResponse.payload.banned).toBe(true);
      expect(authResponse.payload.banReason).toBe('Terms violation');

      // Connection should be closed after failed auth
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(client.state).toBe('disconnected');
    });

    it('should reject when registration fails', async () => {
      // Mock registration failure
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const client = new InstallClient({ serverUrl: SERVER_URL });
      await client.connect();

      const authRequest = createMessage(MessageType.AUTH_REQUEST, {
        deviceId: 'error-device',
        platform: 'darwin',
      });

      const authResponse = await client.sendAndWait<typeof MessageType.AUTH_RESPONSE>(
        authRequest,
        MessageType.AUTH_RESPONSE,
        5000
      );

      expect(authResponse.payload.success).toBe(false);
      expect(authResponse.payload.error).toContain('Database error');

      client.disconnect();
    });

    it('should reject AuthenticatedClient on auth failure', async () => {
      // Mock registration failure
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: false,
        error: 'Service unavailable',
      });

      const client = new AuthenticatedClient({ serverUrl: SERVER_URL });

      await expect(client.connectAndAuth()).rejects.toThrow('Authentication failed');

      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('Authentication Timeout', () => {
    it('should close connection if no auth message sent within timeout', async () => {
      // Create server with very short auth timeout
      await server.stop();
      server = new InstallServer({
        port: TEST_PORT,
        host: '127.0.0.1',
        requireAuth: true,
        authTimeoutMs: 500, // 500ms timeout
      });
      await server.start();

      const client = new InstallClient({
        serverUrl: SERVER_URL,
        autoReconnect: false, // Disable auto-reconnect for this test
      });
      await client.connect();

      // Don't send auth message, wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Connection should be closed
      expect(client.state).toBe('disconnected');
    });
  });

  describe('Unauthenticated Access', () => {
    it('should reject non-auth messages from unauthenticated client', async () => {
      const client = new InstallClient({ serverUrl: SERVER_URL });
      await client.connect();

      // Try to send session.create without authenticating
      const sessionMessage = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });

      let errorReceived = false;
      client.on('error', () => {
        errorReceived = true;
      });

      client.send(sessionMessage);

      // Should receive error or be disconnected
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Server should reject the message
      expect(server.getClientCount()).toBeLessThanOrEqual(1);

      client.disconnect();
    });
  });

  describe('Auth-Disabled Mode', () => {
    it('should allow connections without auth when auth is disabled', async () => {
      // Restart server with auth disabled
      await server.stop();
      server = new InstallServer({
        port: TEST_PORT,
        host: '127.0.0.1',
        requireAuth: false, // Disable auth
      });
      await server.start();

      const client = new InstallClient({ serverUrl: SERVER_URL });
      await client.connect();

      // Should be able to send messages without auth
      expect(client.state).toBe('connected');

      client.disconnect();
    });
  });
});
