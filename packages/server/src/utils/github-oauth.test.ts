// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for GitHub OAuth utility functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initGitHubOAuth,
  _resetGitHubOAuth,
  isGitHubOAuthEnabled,
  getGitHubOAuthConfig,
  generateOAuthState,
  validateOAuthState,
  getAuthorizationUrl,
} from './github-oauth.js';

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  _resetGitHubOAuth();
});

afterEach(() => {
  _resetGitHubOAuth();
});

// ============================================================================
// Configuration
// ============================================================================

describe('GitHub OAuth Configuration', () => {
  it('should initialize with valid config', () => {
    initGitHubOAuth({
      clientId: 'test-id',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
    });

    expect(isGitHubOAuthEnabled()).toBe(true);
    const config = getGitHubOAuthConfig();
    expect(config!.clientId).toBe('test-id');
  });

  it('should report not enabled before initialization', () => {
    expect(isGitHubOAuthEnabled()).toBe(false);
    expect(getGitHubOAuthConfig()).toBeNull();
  });

  it('should reject empty client ID', () => {
    expect(() => initGitHubOAuth({
      clientId: '',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/callback',
    })).toThrow();
  });

  it('should reject empty client secret', () => {
    expect(() => initGitHubOAuth({
      clientId: 'id',
      clientSecret: '',
      redirectUri: 'http://localhost:3000/callback',
    })).toThrow();
  });

  it('should reject invalid redirect URI', () => {
    expect(() => initGitHubOAuth({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'not-a-url',
    })).toThrow();
  });

  it('should reset to disabled state', () => {
    initGitHubOAuth({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/callback',
    });
    expect(isGitHubOAuthEnabled()).toBe(true);

    _resetGitHubOAuth();
    expect(isGitHubOAuthEnabled()).toBe(false);
  });
});

// ============================================================================
// State Management (CSRF protection)
// ============================================================================

describe('OAuth State Management', () => {
  it('should generate unique states', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();
    expect(state1).not.toBe(state2);
    expect(state1).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it('should validate a generated state', () => {
    const state = generateOAuthState();
    expect(validateOAuthState(state)).toBe(true);
  });

  it('should reject unknown state', () => {
    expect(validateOAuthState('unknown-state')).toBe(false);
  });

  it('should reject state used twice (one-time use)', () => {
    const state = generateOAuthState();
    expect(validateOAuthState(state)).toBe(true);
    expect(validateOAuthState(state)).toBe(false);
  });

  it('should handle multiple pending states', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();
    const state3 = generateOAuthState();

    expect(validateOAuthState(state2)).toBe(true);
    expect(validateOAuthState(state1)).toBe(true);
    expect(validateOAuthState(state3)).toBe(true);
  });
});

// ============================================================================
// Authorization URL
// ============================================================================

describe('getAuthorizationUrl', () => {
  beforeEach(() => {
    initGitHubOAuth({
      clientId: 'my-client-id',
      clientSecret: 'my-secret',
      redirectUri: 'http://localhost:3000/api/v1/auth/github/callback',
    });
  });

  it('should generate valid GitHub authorization URL', () => {
    const url = getAuthorizationUrl('test-state');

    expect(url).toContain('https://github.com/login/oauth/authorize');
    expect(url).toContain('client_id=my-client-id');
    expect(url).toContain('state=test-state');
    expect(url).toContain('scope=user%3Aemail');
    expect(url).toContain(encodeURIComponent('http://localhost:3000/api/v1/auth/github/callback'));
  });

  it('should throw when not configured', () => {
    _resetGitHubOAuth();
    expect(() => getAuthorizationUrl('state')).toThrow('GitHub OAuth not configured');
  });
});
