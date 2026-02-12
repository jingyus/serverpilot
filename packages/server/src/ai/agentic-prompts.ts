// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** System prompt builders for the Agentic Chat Engine. */

import { buildProfileContext, buildProfileCaveats } from './profile-context.js';
import { getRagPipeline } from '../knowledge/rag-pipeline.js';
import { logger } from '../utils/logger.js';

export function buildAgenticSystemPrompt(): string {
  return `You are ServerPilot, an autonomous AI DevOps agent that manages servers.
You operate like an experienced sysadmin with SSH access — directly executing commands and adapting based on results.

## How You Work
- You have tools to execute commands, read files, and list directories on the target server.
- When a user asks you to do something, TAKE ACTION immediately. Don't just describe what you would do.
- Execute commands to gather information, then use those results to make decisions.
- If a command fails, analyze the error and try an alternative approach automatically.
- You can make multiple tool calls in sequence — check → diagnose → fix → verify.

## Communication Style
- Be concise. Show what you're doing, not what you're about to do.
- After executing commands, briefly explain the results in context.
- Use Chinese for all user-facing text (the user speaks Chinese).
- Don't show raw command strings unless relevant to the explanation.

## Security
- Read-only commands execute instantly (no confirmation needed).
- Commands that modify the system may require user approval — the system handles this automatically.
- Some dangerous commands are blocked by security policy — if blocked, try a safer alternative.
- NEVER try to bypass security restrictions or use sudo to circumvent blocks.

## Best Practices
- Always verify the OS and package manager before installing software.
- Check if software is already installed before attempting installation.
- After making changes, verify they took effect.
- If something fails, check logs and system state before retrying.`;
}

/**
 * Build the full system prompt with profile context and knowledge base.
 */
export async function buildFullSystemPrompt(
  userMessage: string,
  serverProfile?: unknown,
  serverName?: string,
): Promise<string> {
  // Profile context
  let profileContext: string | undefined;
  let caveats: string[] | undefined;

  if (serverProfile) {
    const profileResult = buildProfileContext(
      serverProfile as Parameters<typeof buildProfileContext>[0],
      serverName ?? 'server',
    );
    profileContext = profileResult.text;
    caveats = buildProfileCaveats(
      serverProfile as Parameters<typeof buildProfileCaveats>[0],
    );
  }

  // Knowledge context via RAG
  let knowledgeContext: string | undefined;
  try {
    const pipeline = getRagPipeline();
    if (pipeline?.isReady()) {
      const ragResult = await pipeline.search(userMessage);
      if (ragResult.hasResults) {
        knowledgeContext = ragResult.contextText;
      }
    }
  } catch (err) {
    logger.warn(
      { operation: 'rag_search', error: String(err) },
      'RAG search failed, continuing without knowledge context',
    );
  }

  // Combine base system prompt + profile + knowledge
  const basePrompt = buildAgenticSystemPrompt();
  const parts = [basePrompt];

  if (profileContext) parts.push(profileContext);
  if (caveats?.length) {
    parts.push('## Important Caveats\n' + caveats.map((c) => `- ${c}`).join('\n'));
  }
  if (knowledgeContext) parts.push(knowledgeContext);

  return parts.join('\n\n');
}
