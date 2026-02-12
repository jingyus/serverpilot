// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud — SSO Module (placeholder)
 *
 * Future implementation:
 * - SAML 2.0 identity provider integration
 * - OIDC (OpenID Connect) support
 * - SCIM user/group provisioning
 * - Just-in-time (JIT) user creation
 * - Multi-factor authentication (MFA) enforcement
 * - Session management and forced logout
 *
 * @module cloud/sso
 */

export interface SSOProvider {
  id: string;
  tenantId: string;
  type: 'saml' | 'oidc';
  name: string;
  issuer: string;
  metadata?: string;
  clientId?: string;
  clientSecret?: string;
  enabled: boolean;
}

export interface SSOSession {
  userId: string;
  providerId: string;
  externalId: string;
  attributes: Record<string, string>;
  authenticatedAt: Date;
  expiresAt: Date;
}

// TODO: Implement SSO
// export async function configureSAMLProvider(tenantId: string, metadata: string): Promise<SSOProvider> {}
// export async function configureOIDCProvider(tenantId: string, config: OIDCConfig): Promise<SSOProvider> {}
// export async function handleSAMLCallback(samlResponse: string): Promise<SSOSession> {}
// export async function handleOIDCCallback(code: string, state: string): Promise<SSOSession> {}
