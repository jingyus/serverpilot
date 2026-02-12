// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Installation plan generation module.
 *
 * Uses AI and knowledge base to generate platform-specific installation plans
 * tailored to the detected environment.
 *
 * @module ai/planner
 */

import type { EnvironmentInfo, InstallPlan } from '@aiinstaller/shared';
import type { InstallAIAgent, TokenUsage, StreamCallbacks } from './agent.js';
import { KnowledgeBase } from '../knowledge/loader.js';
import { logger } from '../utils/logger.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '../../../../..');
const KNOWLEDGE_BASE_DIR = path.join(PROJECT_ROOT, 'knowledge-base');

/** Result of plan generation including token usage */
export interface PlanGenerationResult {
  plan: InstallPlan | null;
  usage?: TokenUsage;
}

/**
 * Generate an installation plan using AI and knowledge base.
 *
 * This function:
 * 1. Loads knowledge base documentation for the software
 * 2. Calls AI agent to generate a platform-specific plan
 * 3. Returns a complete InstallPlan with steps, estimates, and risks
 *
 * @param agent - The AI agent instance
 * @param environment - The client's environment information
 * @param software - The software to install (e.g., 'openclaw')
 * @param version - Optional target version
 * @param callbacks - Optional streaming callbacks
 * @returns The generated installation plan with token usage, or null if generation fails
 */
export async function generateInstallPlan(
  agent: InstallAIAgent,
  environment: EnvironmentInfo,
  software: string,
  version?: string,
  callbacks?: StreamCallbacks,
): Promise<PlanGenerationResult> {
  try {
    // Load knowledge base for the software
    const kb = await loadKnowledgeBase(software);

    // Get knowledge base context for AI prompt
    const knowledgeContext = getKnowledgeContextForPlan(kb, environment);

    // Generate plan using AI with knowledge base context
    const result = await agent.generateInstallPlanStreaming(
      environment,
      software,
      version,
      callbacks,
      knowledgeContext,
    );

    if (!result.success || !result.data) {
      logger.error({ operation: 'generate_plan', software, error: result.error }, 'Failed to generate install plan');
      return { plan: null, usage: result.usage };
    }

    return { plan: result.data, usage: result.usage };
  } catch (error) {
    logger.error({ operation: 'generate_plan', software, error: error instanceof Error ? error.message : String(error) }, 'Error in generateInstallPlan');
    return { plan: null };
  }
}

/**
 * Load knowledge base for a software package.
 *
 * Loads all relevant documentation from the knowledge-base directory
 * for the specified software.
 *
 * @param software - The software name (e.g., 'openclaw')
 * @returns KnowledgeBase instance or null if not found
 */
export async function loadKnowledgeBase(software: string): Promise<KnowledgeBase | null> {
  try {
    const softwareKbDir = path.join(KNOWLEDGE_BASE_DIR, software);
    const kb = new KnowledgeBase({ baseDir: softwareKbDir });

    const count = kb.loadDocuments();
    logger.info({ operation: 'load_knowledge_base', software, documentCount: count }, `Loaded ${count} knowledge base documents for "${software}"`);

    return kb;
  } catch (error) {
    logger.warn({ operation: 'load_knowledge_base', software, error: error instanceof Error ? error.message : String(error) }, `Failed to load knowledge base for "${software}"`);
    return null;
  }
}

/**
 * Get relevant knowledge base content for AI prompt.
 *
 * Searches the knowledge base for the most relevant documents
 * based on the query and environment.
 *
 * @param kb - The knowledge base instance
 * @param environment - The client's environment
 * @param query - Search query (defaults to platform-specific query)
 * @param maxDocs - Maximum number of documents to include (default: 5)
 * @returns Formatted knowledge base content for AI prompt
 */
export function getKnowledgeContextForPlan(
  kb: KnowledgeBase | null,
  environment: EnvironmentInfo,
  query?: string,
  maxDocs = 5,
): string {
  if (!kb || !kb.isLoaded()) {
    return '';
  }

  // Build platform-specific query
  const platform = environment.os.platform;
  const searchQuery = query ?? `installation ${platform} setup prerequisites`;

  // Search for relevant documents
  const results = kb.search(searchQuery, maxDocs);

  if (results.length === 0) {
    return '';
  }

  // Format results for AI prompt
  const sections: string[] = [];

  sections.push('# Knowledge Base: Installation Guide\n');

  for (const result of results) {
    const { document, snippets } = result;

    sections.push(`## ${document.title} (${document.category})\n`);

    if (snippets.length > 0) {
      sections.push('**Relevant snippets:**\n');
      for (const snippet of snippets) {
        sections.push(`- ${snippet}`);
      }
      sections.push('');
    }

    // Include full content for high-relevance docs (top 2)
    if (result.score > 10) {
      sections.push('**Full content:**\n');
      sections.push(document.content);
      sections.push('');
    }
  }

  return sections.join('\n');
}

/**
 * Generate a fallback installation plan without AI.
 *
 * Creates a basic installation plan based on environment detection
 * and common installation practices. Used when AI is unavailable.
 *
 * @param environment - The client's environment information
 * @param software - The software to install
 * @param version - Optional target version
 * @returns A basic installation plan
 */
export function generateFallbackPlan(
  environment: EnvironmentInfo,
  software: string,
  version?: string,
): InstallPlan {
  const platform = environment.os.platform;
  const versionStr = version ?? 'latest';

  // Determine package manager
  const hasNpm = environment.packageManagers.npm !== null;
  const hasPnpm = environment.packageManagers.pnpm !== null;
  const hasBrew = environment.packageManagers.brew !== null;

  const steps: InstallPlan['steps'] = [];

  // Step 1: Check prerequisites
  steps.push({
    id: 'check-node',
    description: 'Check system prerequisites',
    command: platform === 'win32' ? 'node --version && npm --version' : 'node --version && npm --version',
    expectedOutput: 'v',
    timeout: 5000,
    canRollback: false,
    onError: 'abort',
  });

  // Step 2: Install based on platform and available package managers
  if (platform === 'darwin' && hasBrew && !version) {
    // macOS with Homebrew (homebrew doesn't support version pinning easily)
    steps.push({
      id: 'brew-install',
      description: `Install ${software} via Homebrew`,
      command: `brew install ${software}`,
      timeout: 120000,
      canRollback: true,
      onError: 'fallback',
    });
  } else if (hasPnpm) {
    // Use pnpm if available
    steps.push({
      id: 'install-pnpm',
      description: `Install ${software}@${versionStr} globally via pnpm`,
      command: `pnpm install -g ${software}@${versionStr}`,
      timeout: 120000,
      canRollback: true,
      onError: 'fallback',
    });
  } else if (hasNpm) {
    // Fallback to npm
    steps.push({
      id: 'install-openclaw',
      description: `Install ${software}@${versionStr} globally via npm`,
      command: `npm install -g ${software}@${versionStr}`,
      timeout: 120000,
      canRollback: true,
      onError: 'retry',
    });
  } else {
    // No package manager available
    steps.push({
      id: 'manual-install',
      description: `Please install Node.js and npm first, then retry`,
      command: 'echo "No package manager found. Please install Node.js from https://nodejs.org/"',
      timeout: 1000,
      canRollback: false,
      onError: 'abort',
    });
  }

  // Step 3: Verify installation
  steps.push({
    id: 'verify',
    description: `Verify ${software} installation`,
    command: `${software} --version`,
    expectedOutput: '.',
    timeout: 5000,
    canRollback: false,
    onError: 'skip',
  });

  return {
    steps,
    estimatedTime: steps.reduce((acc, step) => acc + step.timeout, 0),
    risks: [
      {
        level: 'medium',
        description: 'Fallback plan: Generated without AI analysis. May not be optimal for your environment.',
      },
      {
        level: 'low',
        description: 'Installation may fail if prerequisites are not met.',
      },
    ],
  };
}
