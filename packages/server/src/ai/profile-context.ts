// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Server Profile Context Builder for AI Prompts.
 *
 * Builds structured server profile context for injection into AI system prompts.
 * Handles token budget management to ensure profiles don't exceed a configurable
 * percentage of the context window.
 *
 * @module ai/profile-context
 */

import type { FullServerProfile } from '../core/profile/manager.js';

// ============================================================================
// Types
// ============================================================================

export interface ProfileContextOptions {
  /** Maximum token budget for profile context (default: 20% of model context) */
  maxTokens?: number;
  /** Model context window size in tokens (default: 200000 for Claude) */
  modelContextWindow?: number;
  /** Maximum percentage of context window for profile (default: 0.20 = 20%) */
  maxContextPercentage?: number;
  /** Include operation history (default: true) */
  includeHistory?: boolean;
  /** Include notes (default: true) */
  includeNotes?: boolean;
  /** Maximum recent operations to include (default: 5) */
  maxRecentOperations?: number;
}

export interface ProfileContextResult {
  /** The formatted profile context string */
  text: string;
  /** Estimated token count of the context */
  estimatedTokens: number;
  /** Whether the context was trimmed to fit budget */
  wasTrimmed: boolean;
  /** Sections that were included */
  includedSections: string[];
  /** Sections that were trimmed or omitted */
  omittedSections: string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_CONTEXT_PERCENTAGE = 0.20;
const DEFAULT_MAX_RECENT_OPERATIONS = 5;

/**
 * Chars-per-token ratio for ASCII/Latin text (~4 chars = 1 token).
 * CJK characters average ~1.5 chars per token (often 1 char = 1 token).
 */
const CHARS_PER_TOKEN_ASCII = 4;
const CHARS_PER_TOKEN_CJK = 1.5;

// CJK Unified Ideographs, Hiragana, Katakana, Hangul, fullwidth forms, CJK symbols
const CJK_REGEX = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/g;

// ============================================================================
// Token estimation
// ============================================================================

/**
 * Count the number of CJK characters in a text string.
 */
export function countCjkChars(text: string): number {
  const matches = text.match(CJK_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Compute the weighted chars-per-token ratio based on CJK character proportion.
 * Pure ASCII text → 4.0; pure CJK text → 1.5; mixed → weighted average.
 */
export function getCharsPerToken(text: string): number {
  if (!text) return CHARS_PER_TOKEN_ASCII;
  const cjkCount = countCjkChars(text);
  if (cjkCount === 0) return CHARS_PER_TOKEN_ASCII;
  const asciiCount = text.length - cjkCount;
  if (asciiCount === 0) return CHARS_PER_TOKEN_CJK;
  // Weighted average based on character proportions
  const cjkRatio = cjkCount / text.length;
  return CHARS_PER_TOKEN_CJK * cjkRatio + CHARS_PER_TOKEN_ASCII * (1 - cjkRatio);
}

/**
 * Estimate token count for a text string.
 *
 * Uses language-aware heuristics:
 * - English/ASCII text: ~4 chars per token
 * - CJK text (Chinese/Japanese/Korean): ~1.5 chars per token
 * - Mixed text: weighted average based on CJK proportion
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / getCharsPerToken(text));
}

// ============================================================================
// Section builders (pure functions)
// ============================================================================

function buildOsSection(profile: FullServerProfile): string | null {
  if (!profile.osInfo) return null;
  const os = profile.osInfo;
  const lines = [`## Server Environment`];
  lines.push(`- OS: ${os.platform} ${os.version} (${os.arch})`);
  if (os.kernel) lines.push(`- Kernel: ${os.kernel}`);
  if (os.hostname) lines.push(`- Hostname: ${os.hostname}`);
  return lines.join('\n');
}

function buildSoftwareSection(profile: FullServerProfile): string | null {
  if (!profile.software || profile.software.length === 0) return null;
  const lines = [`## Installed Software`];
  for (const s of profile.software) {
    const ports = s.ports.length > 0 ? ` (ports: ${s.ports.join(', ')})` : '';
    lines.push(`- ${s.name} ${s.version}${ports}`);
  }
  return lines.join('\n');
}

function buildServicesSection(profile: FullServerProfile): string | null {
  if (!profile.services || profile.services.length === 0) return null;
  const running = profile.services.filter((s) => s.status === 'running');
  const stopped = profile.services.filter((s) => s.status !== 'running');
  if (running.length === 0 && stopped.length === 0) return null;

  const lines = [`## Running Services`];
  for (const s of running) {
    const ports = s.ports.length > 0 ? ` (ports: ${s.ports.join(', ')})` : '';
    lines.push(`- ${s.name}: running${ports}`);
  }
  if (stopped.length > 0) {
    lines.push('');
    lines.push('Stopped/failed services:');
    for (const s of stopped) {
      lines.push(`- ${s.name}: ${s.status}`);
    }
  }
  return lines.join('\n');
}

function buildPreferencesSection(profile: FullServerProfile): string | null {
  if (!profile.preferences) return null;
  const prefs = profile.preferences;
  const lines: string[] = [];
  if (prefs.packageManager) lines.push(`- Package manager: ${prefs.packageManager}`);
  if (prefs.deploymentStyle) lines.push(`- Deployment style: ${prefs.deploymentStyle}`);
  if (prefs.shell) lines.push(`- Shell: ${prefs.shell}`);
  if (prefs.timezone) lines.push(`- Timezone: ${prefs.timezone}`);
  if (lines.length === 0) return null;
  return `## User Preferences\n${lines.join('\n')}`;
}

function buildNotesSection(profile: FullServerProfile): string | null {
  if (!profile.notes || profile.notes.length === 0) return null;
  const lines = [`## Important Notes`];
  for (const n of profile.notes) {
    lines.push(`- ${n}`);
  }
  return lines.join('\n');
}

function buildHistorySection(
  profile: FullServerProfile,
  maxRecent: number,
): string | null {
  const parts: string[] = [];

  if (profile.historySummary) {
    parts.push(`## Operation History Summary\n${profile.historySummary}`);
  }

  if (profile.operationHistory && profile.operationHistory.length > 0) {
    const recent = profile.operationHistory.slice(-maxRecent);
    const recentLines = [`## Recent Operations`];
    for (const op of recent) {
      recentLines.push(`- ${op}`);
    }
    parts.push(recentLines.join('\n'));
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

// ============================================================================
// Core: buildProfileContext
// ============================================================================

/**
 * Build a structured profile context string for AI prompt injection.
 *
 * Sections are added in priority order and trimmed if the token budget
 * is exceeded. Priority (high → low):
 *   1. OS/Environment — essential for command compatibility
 *   2. Installed Software — prevents duplicate installs
 *   3. Running Services — avoids port conflicts
 *   4. Notes — user-specified cautions
 *   5. Preferences — convenience
 *   6. Operation History — recent context
 *
 * @param profile - Full server profile (or null if unavailable)
 * @param serverName - Display name of the server
 * @param options - Token budget and formatting options
 * @returns Formatted context with token usage metadata
 */
export function buildProfileContext(
  profile: FullServerProfile | null,
  serverName: string,
  options: ProfileContextOptions = {},
): ProfileContextResult {
  const modelCtx = options.modelContextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW;
  const maxPct = options.maxContextPercentage ?? DEFAULT_MAX_CONTEXT_PERCENTAGE;
  const maxTokens = options.maxTokens ?? Math.floor(modelCtx * maxPct);
  const includeHistory = options.includeHistory ?? true;
  const includeNotes = options.includeNotes ?? true;
  const maxRecentOps = options.maxRecentOperations ?? DEFAULT_MAX_RECENT_OPERATIONS;

  // No profile available — return minimal context
  if (!profile) {
    const text = `# Server Profile: ${serverName}\nNo profile data available for this server.`;
    return {
      text,
      estimatedTokens: estimateTokens(text),
      wasTrimmed: false,
      includedSections: ['header'],
      omittedSections: [],
    };
  }

  // Build sections in priority order
  const sectionBuilders: Array<{
    name: string;
    build: () => string | null;
    optional: boolean;
  }> = [
    { name: 'os', build: () => buildOsSection(profile), optional: false },
    { name: 'software', build: () => buildSoftwareSection(profile), optional: false },
    { name: 'services', build: () => buildServicesSection(profile), optional: false },
    { name: 'notes', build: () => (includeNotes ? buildNotesSection(profile) : null), optional: true },
    { name: 'preferences', build: () => buildPreferencesSection(profile), optional: true },
    { name: 'history', build: () => (includeHistory ? buildHistorySection(profile, maxRecentOps) : null), optional: true },
  ];

  const header = `# Server Profile: ${serverName}`;
  let usedTokens = estimateTokens(header) + 1; // +1 for trailing newline token
  const includedSections: string[] = ['header'];
  const omittedSections: string[] = [];
  const parts: string[] = [header];
  let wasTrimmed = false;

  for (const section of sectionBuilders) {
    const content = section.build();
    if (!content) continue;

    const sectionTokens = estimateTokens(content) + 1; // +1 for \n\n separator
    if (usedTokens + sectionTokens <= maxTokens) {
      parts.push(content);
      usedTokens += sectionTokens;
      includedSections.push(section.name);
    } else {
      // Try to include a truncated version for important sections
      if (!section.optional && content.length > 0) {
        const availableTokens = maxTokens - usedTokens - 1;
        if (availableTokens > 15) {
          // Estimate how many chars we can keep based on the section's own ratio
          const sectionRatio = getCharsPerToken(content);
          const availableChars = Math.floor(availableTokens * sectionRatio);
          if (availableChars > 50) {
            const truncated = content.slice(0, availableChars - 30) + '\n(...truncated)';
            parts.push(truncated);
            usedTokens += estimateTokens(truncated) + 1;
            includedSections.push(section.name + ' (truncated)');
          } else {
            omittedSections.push(section.name);
          }
        } else {
          omittedSections.push(section.name);
        }
      } else {
        omittedSections.push(section.name);
      }
      wasTrimmed = true;
    }
  }

  const text = parts.join('\n\n');
  return {
    text,
    estimatedTokens: estimateTokens(text),
    wasTrimmed,
    includedSections,
    omittedSections,
  };
}

/**
 * Build caveats string from profile — short warnings about existing software.
 *
 * Generates one-line cautions like "This server already has Nginx installed"
 * that are injected into the system prompt for quick AI awareness.
 */
export function buildProfileCaveats(profile: FullServerProfile | null): string[] {
  if (!profile) return [];
  const caveats: string[] = [];

  // Warn about existing software
  if (profile.software && profile.software.length > 0) {
    for (const s of profile.software) {
      caveats.push(`This server already has ${s.name} ${s.version} installed — do not reinstall unless explicitly requested.`);
    }
  }

  // Warn about running services on common ports
  if (profile.services) {
    const portServices = profile.services.filter(
      (s) => s.status === 'running' && s.ports.length > 0,
    );
    for (const s of portServices) {
      caveats.push(`${s.name} is running on port(s) ${s.ports.join(', ')} — avoid port conflicts.`);
    }
  }

  return caveats;
}
