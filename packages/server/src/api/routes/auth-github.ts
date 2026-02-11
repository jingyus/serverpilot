// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * GitHub OAuth authentication routes.
 *
 * Handles the OAuth 2.0 authorization code flow:
 * - GET /auth/github → redirect to GitHub authorization page
 * - GET /auth/github/callback → handle callback, create/link account, redirect with tokens
 *
 * @module api/routes/auth-github
 */

import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { ApiError } from '../middleware/error-handler.js';
import { generateTokens } from '../middleware/auth.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';
import { getOAuthAccountRepository } from '../../db/repositories/oauth-account-repository.js';
import {
  isGitHubOAuthEnabled,
  generateOAuthState,
  validateOAuthState,
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchGitHubUserEmail,
} from '../../utils/github-oauth.js';
import { logger } from '../../utils/logger.js';
import { ensureDefaultTenant } from '../../utils/auto-tenant.js';
import type { ApiEnv } from './types.js';
import type { User } from '../../db/repositories/user-repository.js';

const authGitHub = new Hono<ApiEnv>();

/** Build the frontend redirect URL with auth data in the hash fragment. */
function buildCallbackRedirect(
  user: Pick<User, 'id' | 'email' | 'name'>,
  accessToken: string,
  refreshToken: string,
): string {
  const userJson = JSON.stringify({ id: user.id, email: user.email, name: user.name });
  const params = new URLSearchParams({
    accessToken,
    refreshToken,
    user: userJson,
  });
  // Redirect to the Dashboard /login route with auth data in the hash fragment.
  // The hash is never sent to the server, keeping tokens out of server logs.
  return `/login#oauth_callback?${params.toString()}`;
}

function buildErrorRedirect(message: string): string {
  const params = new URLSearchParams({ error: message });
  return `/login#oauth_error?${params.toString()}`;
}

// ============================================================================
// GET /auth/github — Redirect to GitHub authorization
// ============================================================================

authGitHub.get('/', (c) => {
  if (!isGitHubOAuthEnabled()) {
    throw ApiError.badRequest('GitHub OAuth is not configured');
  }

  const state = generateOAuthState();
  const url = getAuthorizationUrl(state);
  return c.redirect(url, 302);
});

// ============================================================================
// GET /auth/github/callback — Handle OAuth callback
// ============================================================================

authGitHub.get('/callback', async (c) => {
  if (!isGitHubOAuthEnabled()) {
    throw ApiError.badRequest('GitHub OAuth is not configured');
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // GitHub may redirect with an error
  if (error) {
    const description = c.req.query('error_description') ?? error;
    logger.warn({ operation: 'github_oauth_error', error: description }, 'GitHub OAuth error');
    return c.redirect(buildErrorRedirect(description), 302);
  }

  if (!code || !state) {
    return c.redirect(buildErrorRedirect('Missing code or state parameter'), 302);
  }

  // Validate CSRF state
  if (!validateOAuthState(state)) {
    return c.redirect(buildErrorRedirect('Invalid or expired OAuth state'), 302);
  }

  // Exchange code for GitHub access token
  let githubAccessToken: string;
  try {
    const tokenResponse = await exchangeCodeForToken(code);
    githubAccessToken = tokenResponse.access_token;
  } catch (err) {
    logger.error({ operation: 'github_oauth_token_exchange', error: err }, 'Token exchange failed');
    return c.redirect(buildErrorRedirect('Failed to exchange authorization code'), 302);
  }

  // Fetch GitHub user profile
  let githubUser;
  try {
    githubUser = await fetchGitHubUser(githubAccessToken);
  } catch (err) {
    logger.error({ operation: 'github_oauth_user_fetch', error: err }, 'User profile fetch failed');
    return c.redirect(buildErrorRedirect('Failed to fetch GitHub user profile'), 302);
  }

  const githubId = String(githubUser.id);
  const oauthRepo = getOAuthAccountRepository();
  const userRepo = getUserRepository();

  // Check if this GitHub account is already linked
  const existingOAuth = await oauthRepo.findByProviderAccount('github', githubId);

  if (existingOAuth) {
    // Existing linked account — update profile and sign in
    await oauthRepo.update(existingOAuth.id, {
      providerUsername: githubUser.login,
      providerAvatarUrl: githubUser.avatar_url,
    });

    const user = await userRepo.findById(existingOAuth.userId);
    if (!user) {
      return c.redirect(buildErrorRedirect('Linked user account no longer exists'), 302);
    }

    const tokens = await generateTokens(user.id);
    logger.info({ operation: 'github_oauth_login', userId: user.id }, 'GitHub OAuth login');

    return c.redirect(buildCallbackRedirect(user, tokens.accessToken, tokens.refreshToken), 302);
  }

  // No linked account — try to match by email
  let email = githubUser.email;
  if (!email) {
    email = await fetchGitHubUserEmail(githubAccessToken);
  }

  if (email) {
    const existingUser = await userRepo.findByEmail(email);
    if (existingUser) {
      // Link GitHub to existing user account
      await oauthRepo.create({
        userId: existingUser.id,
        provider: 'github',
        providerAccountId: githubId,
        providerUsername: githubUser.login,
        providerAvatarUrl: githubUser.avatar_url,
      });

      const tokens = await generateTokens(existingUser.id);
      logger.info({ operation: 'github_oauth_link', userId: existingUser.id }, 'GitHub account linked to existing user');

      return c.redirect(buildCallbackRedirect(existingUser, tokens.accessToken, tokens.refreshToken), 302);
    }
  }

  // No matching user — create a new account
  if (!email) {
    return c.redirect(
      buildErrorRedirect('Unable to retrieve email from GitHub. Please ensure your GitHub email is public or verified.'),
      302,
    );
  }

  // Generate a random password hash (OAuth-only users can't use password login)
  const randomPasswordHash = `oauth:${randomBytes(32).toString('hex')}`;

  const newUser = await userRepo.create({
    email,
    passwordHash: randomPasswordHash,
    name: githubUser.name ?? githubUser.login,
  });

  await oauthRepo.create({
    userId: newUser.id,
    provider: 'github',
    providerAccountId: githubId,
    providerUsername: githubUser.login,
    providerAvatarUrl: githubUser.avatar_url,
  });

  // Auto-provision default tenant in single-tenant mode
  await ensureDefaultTenant(newUser.id, email);

  const tokens = await generateTokens(newUser.id);
  logger.info({ operation: 'github_oauth_register', userId: newUser.id }, 'New user created via GitHub OAuth');

  return c.redirect(buildCallbackRedirect(newUser, tokens.accessToken, tokens.refreshToken), 302);
});

export { authGitHub };
