#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Initialize the database with all required tables.
 *
 * When EDITION env var is set, creates only the tables appropriate
 * for that edition. When not set, creates ALL tables.
 */

import { initDatabase, createTables, listTables } from '../packages/server/src/db/connection.js';
import { EDITION, FEATURES } from '../packages/server/src/config/edition.js';

console.log('🔧 Initializing ServerPilot database...\n');

const DB_PATH = process.env.DATABASE_PATH ?? './packages/server/data/serverpilot.db';
console.log('Database path:', DB_PATH);
console.log('Edition:', EDITION.edition.toUpperCase(), '\n');

try {
  initDatabase(DB_PATH);

  // Create tables based on current edition
  createTables(undefined, { features: FEATURES });

  const tables = listTables();
  console.log(`✅ Database initialization successful! (${tables.length} tables)\n`);
  for (const t of tables) {
    console.log(`  - ${t}`);
  }
  process.exit(0);
} catch (error) {
  console.error('❌ Database initialization failed:');
  console.error(error);
  process.exit(1);
}
