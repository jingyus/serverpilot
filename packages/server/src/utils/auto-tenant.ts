// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Auto-tenant provisioning for open-source single-tenant mode.
 *
 * In the default (non-CLOUD_MODE) deployment, every registered user
 * should automatically get a default tenant so that tenant-aware
 * features (team management, invitations, etc.) work out of the box
 * without requiring manual tenant setup.
 *
 * @module utils/auto-tenant
 */

import { getTenantRepository } from '../db/repositories/tenant-repository.js';
import { logger } from './logger.js';

/**
 * Whether the system is running in cloud (multi-tenant) mode.
 * In cloud mode, tenants are created explicitly; in open-source mode,
 * they are auto-provisioned on user registration.
 */
export function isCloudMode(): boolean {
  return process.env.CLOUD_MODE === 'true';
}

/**
 * Auto-provision a default tenant for a user if running in single-tenant mode.
 *
 * This is called during user registration to ensure the new user
 * immediately has a working tenant without manual setup.
 *
 * In CLOUD_MODE, this is a no-op (tenants are managed explicitly).
 *
 * @param userId - The ID of the newly registered user
 * @param email - The user's email (used to generate tenant name)
 * @returns The tenant ID if provisioned, or null if skipped
 */
export async function ensureDefaultTenant(
  userId: string,
  _email: string,
): Promise<string | null> {
  if (isCloudMode()) {
    return null;
  }

  try {
    const tenantRepo = getTenantRepository();

    // Check if user already has a tenant
    const existing = await tenantRepo.findByOwnerId(userId);
    if (existing) {
      return existing.id;
    }

    // Create default tenant via migrateUserToTenant (handles
    // creating tenant + assigning user + migrating existing data)
    const tenant = await tenantRepo.migrateUserToTenant(userId);

    logger.info(
      { operation: 'auto_tenant_provision', userId, tenantId: tenant.id },
      'Auto-provisioned default tenant for user',
    );

    return tenant.id;
  } catch (err) {
    // Non-fatal: the system still works without a tenant (community edition fallback)
    logger.warn(
      { operation: 'auto_tenant_provision', userId, error: err },
      'Failed to auto-provision default tenant',
    );
    return null;
  }
}
