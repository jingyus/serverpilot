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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export interface LocalAgentToken {
  serverId: string;
  agentToken: string;
}

const TOKEN_FILENAME = ".local-agent-token";

/**
 * Search paths for the local agent token file, in priority order.
 *
 * Monorepo 开发时 server 的 DB 在 packages/server/data/，seed 会把 token 写在那里，
 * 因此优先读取 packages/server/data 和 ../server/data，再读 ./data，避免用到根目录
 * 下的旧 token 导致 "agent not registered"。
 */
function getSearchPaths(): string[] {
  return [
    path.join("/data", TOKEN_FILENAME),
    // Monorepo dev：与 server 数据库同目录的 token（与 seedLocalServer 写入位置一致）
    path.join("packages", "server", "data", TOKEN_FILENAME),
    path.join("..", "server", "data", TOKEN_FILENAME),
    path.join("./data", TOKEN_FILENAME),
    path.join(homedir(), ".serverpilot", TOKEN_FILENAME),
  ];
}

/**
 * Load local agent token from well-known file paths.
 *
 * Searches in order:
 * 1. `/data/.local-agent-token` (Docker volume)
 * 2. `packages/server/data/.local-agent-token` (monorepo 从根目录运行)
 * 3. `../server/data/.local-agent-token` (monorepo 从 packages/agent 运行)
 * 4. `./data/.local-agent-token` (本地 dev)
 * 5. `~/.serverpilot/.local-agent-token` (用户目录)
 *
 * @returns Token data or null if not found
 */
export function loadLocalAgentToken(): LocalAgentToken | null {
  for (const tokenPath of getSearchPaths()) {
    if (!existsSync(tokenPath)) continue;

    try {
      const content = readFileSync(tokenPath, "utf-8");
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
