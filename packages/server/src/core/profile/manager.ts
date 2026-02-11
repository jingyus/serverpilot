// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Profile Manager — business logic layer for server profile CRUD.
 *
 * Manages the full lifecycle of server profiles: environment snapshots,
 * installed software, running services, user preferences, notes,
 * operation history, and history summaries.
 *
 * Storage is delegated to ProfileRepository (Drizzle+SQLite) with an
 * in-memory extensions Map as fallback for lightweight usage.
 *
 * @module core/profile/manager
 */

import { z } from 'zod';
import {
  getServerRepository,
  type ServerProfile,
} from '../../db/repositories/server-repository.js';

// ============================================================================
// Zod Schemas (runtime validation)
// ============================================================================

export const OsInfoSchema = z.object({
  platform: z.string().min(1),
  arch: z.string().min(1),
  version: z.string(),
  kernel: z.string(),
  hostname: z.string(),
  uptime: z.number().nonnegative(),
});

export const SoftwareSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  configPath: z.string().optional(),
  dataPath: z.string().optional(),
  ports: z.array(z.number().int().nonnegative()),
});

export const ServiceInfoSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['running', 'stopped', 'failed']),
  ports: z.array(z.number().int().nonnegative()),
  manager: z.string().optional(),
  uptime: z.number().nonnegative().optional(),
});

export const PreferencesSchema = z.object({
  packageManager: z.string().optional(),
  deploymentStyle: z.string().optional(),
  shell: z.string().optional(),
  timezone: z.string().optional(),
});

export const UpdateProfileInputSchema = z.object({
  osInfo: OsInfoSchema.optional(),
  software: z.array(SoftwareSchema).optional(),
  services: z.array(ServiceInfoSchema).optional(),
  preferences: PreferencesSchema.optional(),
});

export const AddNoteInputSchema = z.object({
  note: z.string().min(1).max(500),
});

export const RemoveNoteInputSchema = z.object({
  index: z.number().int().nonnegative(),
});

export const RecordOperationInputSchema = z.object({
  summary: z.string().min(1).max(300),
});

export const HistorySummaryInputSchema = z.object({
  summary: z.string().min(1).max(5000),
  keepRecentCount: z.number().int().min(0).max(200).default(20),
});

// ============================================================================
// Extended Profile Types
// ============================================================================

export type Preferences = z.infer<typeof PreferencesSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

/** Full profile with extended fields (preferences, notes, history) */
export interface FullServerProfile extends ServerProfile {
  preferences: Preferences | null;
  notes: string[];
  operationHistory: string[];
  historySummary: string | null;
}

// ============================================================================
// ProfileManager
// ============================================================================

const MAX_NOTES = 100;
const MAX_OPERATION_HISTORY = 200;

export class ProfileManager {
  /**
   * Extended data that lives alongside the base ServerProfile.
   * Keyed by serverId.
   */
  private extensions = new Map<
    string,
    {
      preferences: Preferences | null;
      notes: string[];
      operationHistory: string[];
      historySummary: string | null;
    }
  >();

  /** Get the full profile for a server (base + extensions). */
  async getProfile(serverId: string, userId: string): Promise<FullServerProfile | null> {
    const repo = getServerRepository();
    const base = await repo.getProfile(serverId, userId);
    if (!base) return null;

    const ext = this.getExtension(serverId);
    return { ...base, ...ext };
  }

  /**
   * Update the server profile.
   *
   * Merges the provided fields into the existing profile. Fields not
   * present in the input are left unchanged.
   */
  async updateProfile(
    serverId: string,
    userId: string,
    input: UpdateProfileInput,
  ): Promise<FullServerProfile | null> {
    const repo = getServerRepository();
    const base = await repo.getProfile(serverId, userId);
    if (!base) return null;

    // Merge base fields
    if (input.osInfo !== undefined) {
      base.osInfo = input.osInfo;
    }
    if (input.software !== undefined) {
      base.software = input.software;
    }
    if (input.services !== undefined) {
      base.services = input.services;
    }

    base.updatedAt = new Date().toISOString();

    // Merge extended fields
    const ext = this.getExtension(serverId);
    if (input.preferences !== undefined) {
      ext.preferences = { ...(ext.preferences ?? {}), ...input.preferences };
    }

    this.extensions.set(serverId, ext);

    const ext2 = this.getExtension(serverId);
    return { ...base, ...ext2 };
  }

  /** Add a note to the server profile. */
  addNote(serverId: string, note: string): boolean {
    const ext = this.extensions.get(serverId);
    if (!ext) {
      // Initialize extension if it doesn't exist yet
      this.extensions.set(serverId, {
        preferences: null,
        notes: [note],
        operationHistory: [],
        historySummary: null,
      });
      return true;
    }

    // Enforce cap — drop oldest if at limit
    if (ext.notes.length >= MAX_NOTES) {
      ext.notes.shift();
    }
    ext.notes.push(note);
    return true;
  }

  /** Remove a note by index. */
  removeNote(serverId: string, index: number): boolean {
    const ext = this.extensions.get(serverId);
    if (!ext || index < 0 || index >= ext.notes.length) {
      return false;
    }
    ext.notes.splice(index, 1);
    return true;
  }

  /** Record an operation summary in the history. */
  recordOperation(serverId: string, summary: string): void {
    const ext = this.getExtension(serverId);

    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${summary}`;

    // Enforce cap — drop oldest if at limit
    if (ext.operationHistory.length >= MAX_OPERATION_HISTORY) {
      ext.operationHistory.shift();
    }
    ext.operationHistory.push(entry);

    this.extensions.set(serverId, ext);
  }

  /** Get the most recent operation history entries. */
  getRecentOperations(serverId: string, count = 10): string[] {
    const ext = this.extensions.get(serverId);
    if (!ext) return [];
    return ext.operationHistory.slice(-count);
  }

  /** Set user preferences for a server. Merges with existing preferences. */
  setPreferences(serverId: string, prefs: Preferences): void {
    const ext = this.getExtension(serverId);
    ext.preferences = { ...(ext.preferences ?? {}), ...prefs };
    this.extensions.set(serverId, ext);
  }

  /** Get user preferences for a server. */
  getPreferences(serverId: string): Preferences | null {
    return this.extensions.get(serverId)?.preferences ?? null;
  }

  /** Set a history summary (result of AI-powered summarization). */
  setHistorySummary(serverId: string, summary: string): void {
    const ext = this.getExtension(serverId);
    ext.historySummary = summary;
    this.extensions.set(serverId, ext);
  }

  /** Get the history summary for a server. */
  getHistorySummary(serverId: string): string | null {
    return this.extensions.get(serverId)?.historySummary ?? null;
  }

  /**
   * Summarize old operation history entries and trim.
   *
   * Called after AI generates a summary of old entries. Stores the
   * summary and keeps only the most recent entries.
   */
  summarizeAndTrim(serverId: string, summary: string, keepRecentCount = 20): void {
    const ext = this.getExtension(serverId);

    // Append to existing summary if present
    if (ext.historySummary) {
      ext.historySummary = `${ext.historySummary}\n\n---\n\n${summary}`;
    } else {
      ext.historySummary = summary;
    }

    // Keep only recent entries
    if (ext.operationHistory.length > keepRecentCount) {
      ext.operationHistory = ext.operationHistory.slice(-keepRecentCount);
    }

    this.extensions.set(serverId, ext);
  }

  /**
   * Build a context string summarizing the profile for AI prompts.
   *
   * Used by the AI engine to understand the server environment when
   * generating plans and responses.
   */
  async buildAIContext(serverId: string, userId: string): Promise<string> {
    const profile = await this.getProfile(serverId, userId);
    if (!profile) return '';

    const lines: string[] = [];

    // OS info
    if (profile.osInfo) {
      lines.push(
        `Server OS: ${profile.osInfo.platform} ${profile.osInfo.version} (${profile.osInfo.arch})`,
        `Kernel: ${profile.osInfo.kernel}`,
        `Hostname: ${profile.osInfo.hostname}`,
      );
    }

    // Software
    if (profile.software.length > 0) {
      lines.push('', 'Installed software:');
      for (const s of profile.software) {
        const ports = s.ports.length > 0 ? ` (ports: ${s.ports.join(', ')})` : '';
        lines.push(`  - ${s.name} ${s.version}${ports}`);
      }
    }

    // Services
    const running = profile.services.filter((s) => s.status === 'running');
    if (running.length > 0) {
      lines.push('', 'Running services:');
      for (const s of running) {
        const ports = s.ports.length > 0 ? ` (ports: ${s.ports.join(', ')})` : '';
        lines.push(`  - ${s.name}${ports}`);
      }
    }

    // Preferences
    if (profile.preferences) {
      const prefs: string[] = [];
      if (profile.preferences.packageManager) {
        prefs.push(`Package manager: ${profile.preferences.packageManager}`);
      }
      if (profile.preferences.deploymentStyle) {
        prefs.push(`Deployment: ${profile.preferences.deploymentStyle}`);
      }
      if (profile.preferences.shell) {
        prefs.push(`Shell: ${profile.preferences.shell}`);
      }
      if (prefs.length > 0) {
        lines.push('', 'User preferences:', ...prefs.map((p) => `  - ${p}`));
      }
    }

    // Notes
    if (profile.notes.length > 0) {
      lines.push('', 'Notes:');
      for (const n of profile.notes) {
        lines.push(`  - ${n}`);
      }
    }

    // History summary (condensed past operations)
    if (profile.historySummary) {
      lines.push('', 'Operation history summary:', profile.historySummary);
    }

    // Recent operations
    if (profile.operationHistory.length > 0) {
      const recent = profile.operationHistory.slice(-5);
      lines.push('', 'Recent operations:');
      for (const op of recent) {
        lines.push(`  - ${op}`);
      }
    }

    return lines.join('\n');
  }

  /** Delete all extension data for a server. Called when a server is removed. */
  deleteProfile(serverId: string): boolean {
    return this.extensions.delete(serverId);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getExtension(serverId: string) {
    const existing = this.extensions.get(serverId);
    if (existing) return existing;

    const fresh = {
      preferences: null as Preferences | null,
      notes: [] as string[],
      operationHistory: [] as string[],
      historySummary: null as string | null,
    };
    this.extensions.set(serverId, fresh);
    return fresh;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: ProfileManager | null = null;

export function getProfileManager(): ProfileManager {
  if (!_instance) {
    _instance = new ProfileManager();
  }
  return _instance;
}

/** Reset for testing. */
export function _resetProfileManager(): void {
  _instance = null;
}
