#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * List all users in the database
 */

import { initDatabase, getDatabase } from '../packages/server/src/db/connection.js';
import { users } from '../packages/server/src/db/schema.js';

const DB_PATH = process.env.DATABASE_PATH ?? './packages/server/data/serverpilot.db';

initDatabase(DB_PATH);
const db = getDatabase();

const allUsers = db.select().from(users).all();

console.log('=== 数据库中的用户 ===\n');
console.log(`总共 ${allUsers.length} 个用户\n`);

if (allUsers.length === 0) {
  console.log('❌ 没有用户！');
  console.log('\n默认管理员账户应该在服务器首次启动时自动创建。');
  console.log('可能原因：');
  console.log('  1. 服务器还没启动过');
  console.log('  2. 设置了 SKIP_SEED_ADMIN=true 环境变量');
  console.log('\n解决方法：重启服务器，它会自动创建管理员账户并显示密码。');
} else {
  allUsers.forEach((user, i) => {
    console.log(`${i + 1}. 邮箱: ${user.email}`);
    console.log(`   姓名: ${user.name || '(未设置)'}`);
    console.log(`   角色: ${user.role}`);
    console.log(`   创建时间: ${new Date(user.createdAt).toLocaleString('zh-CN')}`);
    console.log(`   ID: ${user.id}\n`);
  });
}

process.exit(0);
