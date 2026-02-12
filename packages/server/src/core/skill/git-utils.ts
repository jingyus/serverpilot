// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Shared git utilities for the skill subsystem.
 * @module core/skill/git-utils
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const execAsync = promisify(exec);

/** Read the origin remote URL from a git repository directory. Returns null if unavailable. */
export async function getGitRemoteUrl(dirPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: dirPath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
