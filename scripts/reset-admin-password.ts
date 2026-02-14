#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Reset admin password
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { initDatabase, getDatabase } from '../packages/server/src/db/connection.js';
import { users } from '../packages/server/src/db/schema.js';
import { hashPassword } from '../packages/server/src/utils/password.js';

const DB_PATH = process.env.DATABASE_PATH ?? './packages/server/data/serverpilot.db';
const ADMIN_EMAIL = 'admin@serverpilot.local';

initDatabase(DB_PATH);
const db = getDatabase();

// Find admin user
const admin = db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).get();

if (!admin) {
  console.error(`❌ 未找到管理员账户 (${ADMIN_EMAIL})`);
  process.exit(1);
}

// Generate new password or use provided one
const newPassword = process.env.NEW_PASSWORD || randomBytes(12).toString('base64url');
const passwordHash = await hashPassword(newPassword);

// Update password
db.update(users)
  .set({ passwordHash, updatedAt: new Date() })
  .where(eq(users.id, admin.id))
  .run();

// Display credentials
const border = '='.repeat(60);
console.log('');
console.log(border);
console.log('  管理员密码已重置');
console.log(border);
console.log(`  邮箱:    ${ADMIN_EMAIL}`);
console.log(`  新密码:  ${newPassword}`);
console.log('');
console.log('  请复制密码并在首次登录后更改！');
console.log(border);
console.log('');

process.exit(0);
