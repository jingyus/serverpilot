// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * @aiinstaller/shared - Shared types, protocols, and utilities
 *
 * This package contains shared code used by both the server and agent packages.
 */

export const PACKAGE_NAME = '@aiinstaller/shared';
export const PACKAGE_VERSION = '0.1.0';

// Protocol exports
export * from './protocol/messages.js';
export * from './protocol/types.js';
export * from './protocol/schemas.js';
export * from './protocol/version.js';
export * from './protocol/conversation-export.js';

// Security exports
export * from './security/index.js';

// RBAC exports
export * from './rbac.js';

// Skill schema exports
export * from './skill-schema.js';

// Auth exports
export * from './auth/password-policy.js';
