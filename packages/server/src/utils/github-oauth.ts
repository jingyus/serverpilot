// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * GitHub OAuth 2.0 utility functions.
 *
 * Handles authorization URL generation, token exchange, and
 * user profile fetching using Node.js built-in fetch API.
 *
 * @module utils/github-oauth
 */

import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// ============================================================================
// Configuration
// ============================================================================

const GitHubOAuthConfigSchema = z.object({
  clientId: z.string().min(1, 'GitHub OAuth client ID is required'),
  clientSecret: z.string().min(1, 'GitHub OAuth client secret is required'),
  redirectUri: z.string().url('GitHub OAuth redirect URI must be a valid URL'),
});

export type GitHubOAuthConfig = z.infer<typeof GitHubOAuthConfigSchema>;

let _config: GitHubOAuthConfig | null = null;

export function initGitHubOAuth(config: GitHubOAuthConfig): void {
  _config = GitHubOAuthConfigSchema.parse(config);
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig | null {
  return _config;
}

export function isGitHubOAuthEnabled(): boolean {
  return _config !== null;
}

export function _resetGitHubOAuth(): void {
  _config = null;
}

// ============================================================================
// GitHub API Types
// ============================================================================

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
  name: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// ============================================================================
// State Management (CSRF protection)
// ============================================================================

const pendingStates = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateOAuthState(): string {
  const state = randomBytes(32).toString('hex');
  pendingStates.set(state, { createdAt: Date.now() });
  cleanupExpiredStates();
  return state;
}

export function validateOAuthState(state: string): boolean {
  const entry = pendingStates.get(state);
  if (!entry) return false;

  pendingStates.delete(state);

  if (Date.now() - entry.createdAt > STATE_TTL_MS) {
    return false;
  }

  return true;
}

function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [key, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

// ============================================================================
// OAuth Flow Functions
// ============================================================================

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

export function getAuthorizationUrl(state: string): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'user:email',
    state,
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const config = requireConfig();

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, string>;

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
  }

  return data as unknown as GitHubTokenResponse;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ServerPilot',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API /user failed: ${response.status}`);
  }

  return response.json() as Promise<GitHubUser>;
}

export async function fetchGitHubUserEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(`${GITHUB_API_URL}/user/emails`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ServerPilot',
    },
  });

  if (!response.ok) return null;

  const emails = await response.json() as GitHubEmail[];

  // Prefer primary verified email
  const primary = emails.find((e) => e.primary && e.verified);
  if (primary) return primary.email;

  // Fallback to any verified email
  const verified = emails.find((e) => e.verified);
  return verified?.email ?? null;
}

// ============================================================================
// Internal
// ============================================================================

function requireConfig(): GitHubOAuthConfig {
  if (!_config) {
    throw new Error('GitHub OAuth not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.');
  }
  return _config;
}
