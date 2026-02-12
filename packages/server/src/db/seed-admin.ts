// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Default admin account seeding.
 *
 * Creates a default admin user on first startup if no users exist.
 * Credentials can be configured via ADMIN_EMAIL / ADMIN_PASSWORD
 * environment variables (set by init.sh or docker-compose).
 *
 * @module db/seed-admin
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { hashPassword } from '../utils/password.js';
import { getUserRepository } from './repositories/user-repository.js';
import { getDatabase } from './connection.js';
import { users } from './schema.js';
import { logger } from '../utils/logger.js';
import { ensureDefaultTenant } from '../utils/auto-tenant.js';

const DEFAULT_ADMIN_EMAIL = 'admin@serverpilot.local';
const DEFAULT_ADMIN_NAME = 'Admin';

/**
 * Seed a default admin user if the users table is empty.
 *
 * On first startup, if ADMIN_EMAIL and ADMIN_PASSWORD are set,
 * uses those. Otherwise generates a random password and logs it
 * to stdout so the operator can copy it.
 */
export async function seedDefaultAdmin(): Promise<void> {
  // Allow skipping seed (useful for E2E tests where first registered user becomes owner)
  if (process.env.SKIP_SEED_ADMIN === 'true') {
    logger.debug({ operation: 'seed' }, 'SKIP_SEED_ADMIN=true, skipping admin seed');
    return;
  }

  const db = getDatabase();

  // Check if any users exist
  const existingUsers = db.select().from(users).limit(1).all();
  if (existingUsers.length > 0) {
    logger.debug({ operation: 'seed' }, 'Users table is not empty, skipping admin seed');
    return;
  }

  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  let password = process.env.ADMIN_PASSWORD || '';
  let generated = false;

  if (!password) {
    password = randomBytes(16).toString('base64url');
    generated = true;
  }

  const repo = getUserRepository();
  const passwordHash = await hashPassword(password);

  const user = await repo.create({
    email,
    passwordHash,
    name: DEFAULT_ADMIN_NAME,
  });

  // Promote the seeded admin to owner role
  db.update(users).set({ role: 'owner' }).where(eq(users.id, user.id)).run();

  // Auto-provision default tenant (single-tenant mode)
  await ensureDefaultTenant(user.id, email);

  logger.info({ operation: 'seed', email }, 'Default admin account created with owner role');

  if (generated) {
    // Print credentials prominently so operator can see them in docker logs
    const border = '='.repeat(60);
    const msg = [
      '',
      border,
      '  DEFAULT ADMIN ACCOUNT CREATED',
      border,
      `  Email:    ${email}`,
      `  Password: ${password}`,
      '',
      '  Please change this password after first login!',
      border,
      '',
    ].join('\n');
    // Use console.log directly so it's visible even if logger level is high
    console.log(msg);
  } else {
    logger.info(
      { operation: 'seed', email },
      'Admin account created with provided credentials',
    );
  }
}
