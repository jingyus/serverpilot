// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Local server auto-registration for self-hosted deployments.
 *
 * On first startup, creates a "Local Server" entry so the co-located
 * agent can connect automatically without manual "Add Server" step.
 * Writes the server ID and agent token to a shared file that the
 * agent reads on startup.
 *
 * @module db/seed-local-server
 */

import { hostname } from 'node:os';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { getUserRepository } from './repositories/user-repository.js';
import { getServerRepository } from './repositories/server-repository.js';
import { getDatabase } from './connection.js';
import { agents } from './schema.js';
import { logger } from '../utils/logger.js';

const DEFAULT_ADMIN_EMAIL = 'admin@serverpilot.local';
const LOCAL_SERVER_TAG = 'local';
const AUTO_TAG = 'auto';
const TOKEN_FILENAME = '.local-agent-token';

/**
 * Seed a local server entry for the co-located agent.
 *
 * Idempotent: skips if a server with tags ['local', 'auto'] already
 * exists for the admin user. Writes token file on every run (in case
 * the file was deleted but the DB record persists).
 */
export async function seedLocalServer(): Promise<void> {
  if (process.env.SKIP_SEED_LOCAL_SERVER === 'true') {
    logger.debug({ operation: 'seed' }, 'SKIP_SEED_LOCAL_SERVER=true, skipping local server seed');
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const userRepo = getUserRepository();
  const admin = await userRepo.findByEmail(adminEmail);

  if (!admin) {
    logger.debug({ operation: 'seed' }, 'No admin user found, skipping local server seed');
    return;
  }

  const serverRepo = getServerRepository();
  const existingServers = await serverRepo.findAllByUserId(admin.id);
  const localServer = existingServers.find(
    (s) => s.tags.includes(LOCAL_SERVER_TAG) && s.tags.includes(AUTO_TAG),
  );

  let serverId: string;
  let agentToken: string;

  if (localServer) {
    // Server exists — retrieve token from agents table
    serverId = localServer.id;
    const db = getDatabase();
    const agentRows = db
      .select()
      .from(agents)
      .where(eq(agents.serverId, serverId))
      .limit(1)
      .all();

    if (!agentRows[0]?.keyHash) {
      logger.warn({ operation: 'seed', serverId }, 'Local server exists but agent token missing');
      return;
    }
    agentToken = agentRows[0].keyHash;
    logger.debug({ operation: 'seed', serverId }, 'Local server already exists, reusing');
  } else {
    // Create new local server
    const serverName = hostname() || 'Local Server';
    const server = await serverRepo.create({
      name: serverName,
      userId: admin.id,
      tags: [LOCAL_SERVER_TAG, AUTO_TAG],
    });
    serverId = server.id;
    agentToken = server.agentToken!;
    logger.info({ operation: 'seed', serverId, name: serverName }, 'Local server created for co-located agent');
  }

  // Write token file (always, in case file was deleted)
  writeTokenFile(serverId, agentToken);
}

function writeTokenFile(serverId: string, agentToken: string): void {
  const dataDir = path.dirname(process.env.DATABASE_PATH ?? './data/serverpilot.db');

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const tokenPath = path.join(dataDir, TOKEN_FILENAME);
  const content = JSON.stringify({ serverId, agentToken }, null, 2) + '\n';

  try {
    writeFileSync(tokenPath, content, { mode: 0o644 });
    logger.info({ operation: 'seed', tokenPath }, 'Local agent token file written');
  } catch (err) {
    logger.warn({ operation: 'seed', tokenPath, error: err }, 'Failed to write local agent token file');
  }
}
