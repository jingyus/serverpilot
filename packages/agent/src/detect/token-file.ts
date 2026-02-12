// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Local agent token file reader.
 *
 * Reads the `{ serverId, agentToken }` JSON file written by the server's
 * seedLocalServer() on startup. Used by daemon mode to authenticate
 * without manual configuration.
 *
 * @module detect/token-file
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export interface LocalAgentToken {
  serverId: string;
  agentToken: string;
}

const TOKEN_FILENAME = '.local-agent-token';

/**
 * Search paths for the local agent token file, in priority order.
 */
function getSearchPaths(): string[] {
  return [
    path.join('/data', TOKEN_FILENAME),
    path.join('./data', TOKEN_FILENAME),
    // Monorepo dev mode: token may be in packages/server/data/ (from root cwd)
    // or ../server/data/ (from packages/agent/ cwd)
    path.join('packages', 'server', 'data', TOKEN_FILENAME),
    path.join('..', 'server', 'data', TOKEN_FILENAME),
    path.join(homedir(), '.serverpilot', TOKEN_FILENAME),
  ];
}

/**
 * Load local agent token from well-known file paths.
 *
 * Searches in order:
 * 1. `/data/.local-agent-token` (Docker volume)
 * 2. `./data/.local-agent-token` (local dev)
 * 3. `~/.serverpilot/.local-agent-token` (user home)
 *
 * @returns Token data or null if not found
 */
export function loadLocalAgentToken(): LocalAgentToken | null {
  for (const tokenPath of getSearchPaths()) {
    if (!existsSync(tokenPath)) continue;

    try {
      const content = readFileSync(tokenPath, 'utf-8');
      const data = JSON.parse(content) as LocalAgentToken;
      if (data.serverId && data.agentToken) {
        return data;
      }
    } catch {
      // Invalid file, try next path
    }
  }
  return null;
}
