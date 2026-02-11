// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for GitHub OAuth authentication routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import { authGitHub } from './auth-github.js';
import { onError } from '../middleware/error-handler.js';
import { initJwtConfig, _resetJwtConfig, verifyToken } from '../middleware/auth.js';
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from '../../db/repositories/user-repository.js';
import {
  InMemoryOAuthAccountRepository,
  setOAuthAccountRepository,
  _resetOAuthAccountRepository,
} from '../../db/repositories/oauth-account-repository.js';
import {
  initGitHubOAuth,
  _resetGitHubOAuth,
  generateOAuthState,
} from '../../utils/github-oauth.js';
import { hashPassword } from '../../utils/password.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Mock GitHub API calls
// ============================================================================

vi.mock('../../utils/github-oauth.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../utils/github-oauth.js')>();
  return {
    ...original,
    exchangeCodeForToken: vi.fn(),
    fetchGitHubUser: vi.fn(),
    fetchGitHubUserEmail: vi.fn(),
  };
});

import {
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchGitHubUserEmail,
} from '../../utils/github-oauth.js';

const mockExchangeCode = vi.mocked(exchangeCodeForToken);
const mockFetchUser = vi.mocked(fetchGitHubUser);
const mockFetchEmail = vi.mocked(fetchGitHubUserEmail);

// ============================================================================
// Helpers
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/auth/github', authGitHub);
  return app;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let userRepo: InMemoryUserRepository;
let oauthRepo: InMemoryOAuthAccountRepository;

beforeEach(() => {
  _resetJwtConfig();
  _resetUserRepository();
  _resetOAuthAccountRepository();
  _resetGitHubOAuth();

  initJwtConfig({ secret: TEST_SECRET });
  initGitHubOAuth({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/api/v1/auth/github/callback',
  });

  userRepo = new InMemoryUserRepository();
  setUserRepository(userRepo);
  oauthRepo = new InMemoryOAuthAccountRepository();
  setOAuthAccountRepository(oauthRepo);

  // Default mock responses
  mockExchangeCode.mockResolvedValue({
    access_token: 'gho_test_access_token',
    token_type: 'bearer',
    scope: 'user:email',
  });

  mockFetchUser.mockResolvedValue({
    id: 12345,
    login: 'testuser',
    avatar_url: 'https://avatars.githubusercontent.com/u/12345',
    email: 'testuser@github.com',
    name: 'Test User',
  });

  mockFetchEmail.mockResolvedValue('testuser@github.com');
});

afterEach(() => {
  _resetJwtConfig();
  _resetUserRepository();
  _resetOAuthAccountRepository();
  _resetGitHubOAuth();
  vi.clearAllMocks();
});

// ============================================================================
// GET /auth/github — Redirect to GitHub
// ============================================================================

describe('GET /auth/github', () => {
  it('should redirect to GitHub authorization URL', async () => {
    const app = createTestApp();
    const res = await app.request('/auth/github');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('github.com/login/oauth/authorize');
    expect(location).toContain('client_id=test-client-id');
    expect(location).toContain('scope=user%3Aemail');
    expect(location).toContain('state=');
  });

  it('should return 400 when GitHub OAuth is not configured', async () => {
    _resetGitHubOAuth();
    const app = createTestApp();
    const res = await app.request('/auth/github');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('GitHub OAuth is not configured');
  });
});

// ============================================================================
// GET /auth/github/callback — Handle callback
// ============================================================================

describe('GET /auth/github/callback', () => {
  it('should create new user on first GitHub login and redirect', async () => {
    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_callback?');
    expect(location).toContain('accessToken=');
    expect(location).toContain('refreshToken=');
    expect(location).toContain('user=');

    // Verify user was created
    const user = await userRepo.findByEmail('testuser@github.com');
    expect(user).not.toBeNull();
    expect(user!.name).toBe('Test User');

    // Verify OAuth account was linked
    const oauth = await oauthRepo.findByProviderAccount('github', '12345');
    expect(oauth).not.toBeNull();
    expect(oauth!.userId).toBe(user!.id);
    expect(oauth!.providerUsername).toBe('testuser');
  });

  it('should use login name when GitHub name is null', async () => {
    mockFetchUser.mockResolvedValue({
      id: 12345,
      login: 'testuser',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345',
      email: 'testuser@github.com',
      name: null,
    });

    const app = createTestApp();
    const state = generateOAuthState();

    await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    const user = await userRepo.findByEmail('testuser@github.com');
    expect(user).not.toBeNull();
    expect(user!.name).toBe('testuser');
  });

  it('should sign in existing linked GitHub account', async () => {
    // Pre-create user and link
    const user = await userRepo.create({
      email: 'existing@example.com',
      passwordHash: await hashPassword('password123'),
      name: 'Existing User',
    });
    await oauthRepo.create({
      userId: user.id,
      provider: 'github',
      providerAccountId: '12345',
      providerUsername: 'oldname',
    });

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_callback?');

    // Verify username was updated
    const updated = await oauthRepo.findByProviderAccount('github', '12345');
    expect(updated!.providerUsername).toBe('testuser');
  });

  it('should link GitHub to existing user by email match', async () => {
    // Pre-create user with same email
    const user = await userRepo.create({
      email: 'testuser@github.com',
      passwordHash: await hashPassword('password123'),
      name: 'Local User',
    });

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);

    // Verify GitHub was linked to existing user
    const oauth = await oauthRepo.findByProviderAccount('github', '12345');
    expect(oauth).not.toBeNull();
    expect(oauth!.userId).toBe(user.id);
  });

  it('should fetch email from /user/emails when profile email is null', async () => {
    mockFetchUser.mockResolvedValue({
      id: 12345,
      login: 'testuser',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345',
      email: null,
      name: 'Test User',
    });
    mockFetchEmail.mockResolvedValue('private@example.com');

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const user = await userRepo.findByEmail('private@example.com');
    expect(user).not.toBeNull();
  });

  it('should redirect with error when no email available', async () => {
    mockFetchUser.mockResolvedValue({
      id: 12345,
      login: 'testuser',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345',
      email: null,
      name: 'Test User',
    });
    mockFetchEmail.mockResolvedValue(null);

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('Unable+to+retrieve+email');
  });

  it('should redirect with error for invalid state', async () => {
    const app = createTestApp();

    const res = await app.request('/auth/github/callback?code=test-code&state=invalid-state');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('Invalid+or+expired');
  });

  it('should redirect with error when code is missing', async () => {
    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('Missing+code');
  });

  it('should redirect with error when GitHub returns error', async () => {
    const app = createTestApp();

    const res = await app.request('/auth/github/callback?error=access_denied&error_description=User+denied');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('User+denied');
  });

  it('should redirect with error when token exchange fails', async () => {
    mockExchangeCode.mockRejectedValue(new Error('Exchange failed'));

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=bad-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('Failed+to+exchange');
  });

  it('should redirect with error when user profile fetch fails', async () => {
    mockFetchUser.mockRejectedValue(new Error('API error'));

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('Failed+to+fetch+GitHub');
  });

  it('should return valid JWT tokens for new user', async () => {
    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);
    const location = res.headers.get('Location')!;

    // Extract tokens from redirect URL
    const hashPart = location.split('#oauth_callback?')[1];
    const params = new URLSearchParams(hashPart);
    const accessToken = params.get('accessToken')!;
    const refreshToken = params.get('refreshToken')!;

    // Verify tokens are valid
    const accessResult = await verifyToken(accessToken, 'access');
    expect(accessResult.type).toBe('access');

    const refreshResult = await verifyToken(refreshToken, 'refresh');
    expect(refreshResult.type).toBe('refresh');

    // Verify tokens belong to the created user
    expect(accessResult.userId).toBe(refreshResult.userId);
  });

  it('should not allow password login for OAuth-only users', async () => {
    const app = createTestApp();
    const state = generateOAuthState();

    await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    // Verify the password hash starts with 'oauth:' (not a valid scrypt hash)
    const user = await userRepo.findByEmail('testuser@github.com');
    expect(user!.passwordHash).toMatch(/^oauth:/);
  });

  it('should redirect with error when linked user no longer exists', async () => {
    // Create and then delete user, but keep the OAuth link
    const user = await userRepo.create({
      email: 'deleted@example.com',
      passwordHash: 'scrypt:fake',
      name: 'Deleted User',
    });
    await oauthRepo.create({
      userId: user.id,
      provider: 'github',
      providerAccountId: '12345',
    });
    await userRepo.delete(user.id);

    const app = createTestApp();
    const state = generateOAuthState();

    const res = await app.request(`/auth/github/callback?code=test-code&state=${state}`);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('/login#oauth_error?');
    expect(location).toContain('no+longer+exists');
  });
});
