// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Debug test for chat page error
 * Simulates the exact user flow and captures detailed error information
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiRequest, ApiError } from '../packages/dashboard/src/api/client';

// This debug test requires a live server running in EE mode at localhost:3000
const LIVE_SERVER = process.env.LIVE_SERVER === 'true';

describe.skipIf(!LIVE_SERVER)('Chat Page Debug', () => {
  let authToken: string;
  let serverId: string;
  let userId: string;

  beforeAll(async () => {
    // Set API base URL for server-side testing
    process.env.VITE_API_BASE_URL = 'http://localhost:3000';

    // 1. Register a test user
    console.log('1. Registering test user...');
    try {
      const registerRes = await fetch('http://localhost:3000/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `test-${Date.now()}@example.com`,
          password: 'Test123456!',
          name: `Test User ${Date.now()}`
        })
      });

      const registerData = await registerRes.json();
      console.log('Register response:', JSON.stringify(registerData, null, 2));

      if (registerData.accessToken) {
        authToken = registerData.accessToken;
        userId = registerData.user.id;
      } else {
        throw new Error('No auth token received');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }

    // 2. Create a test server
    console.log('\n2. Creating test server...');
    try {
      const serverRes = await fetch('http://localhost:3000/api/v1/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: 'Test Server',
          host: 'localhost',
          port: 22
        })
      });

      const serverData = await serverRes.json();
      console.log('Server response:', JSON.stringify(serverData, null, 2));

      if (serverData.server) {
        serverId = serverData.server.id;
      } else {
        throw new Error('No server ID received');
      }
    } catch (error) {
      console.error('Server creation failed:', error);
      throw error;
    }
  });

  it('should fetch sessions list for valid server', async () => {
    console.log('\n3. Fetching sessions list...');
    console.log('Server ID:', serverId);
    console.log('Auth token (first 20 chars):', authToken.substring(0, 20) + '...');

    try {
      const response = await fetch(
        `http://localhost:3000/api/v1/chat/${serverId}/sessions?limit=50&offset=0`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log('Response body:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('sessions');
      expect(data).toHaveProperty('total');
    } catch (error) {
      console.error('Sessions fetch failed:', error);
      throw error;
    }
  });

  it('should return 404 for non-existent server', async () => {
    console.log('\n4. Testing with non-existent server ID...');
    const fakeServerId = '58880257-2b46-44cb-8a7f-aeeb8b431b63';

    try {
      const response = await fetch(
        `http://localhost:3000/api/v1/chat/${fakeServerId}/sessions`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response body:', JSON.stringify(data, null, 2));

      // Should return 404, not 500
      expect(response.status).toBe(404);
      expect(data.error).toHaveProperty('code', 'NOT_FOUND');
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });

  it('should handle missing auth token', async () => {
    console.log('\n5. Testing without auth token...');

    try {
      const response = await fetch(
        `http://localhost:3000/api/v1/chat/${serverId}/sessions`,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response body:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(401);
      expect(data.error).toHaveProperty('code', 'UNAUTHORIZED');
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });

  afterAll(() => {
    console.log('\n=== Debug Summary ===');
    console.log('User ID:', userId);
    console.log('Server ID:', serverId);
    console.log('Test completed');
  });
});
