// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the knowledge base auto-learning module.
 *
 * Covers software extraction, platform detection, knowledge creation/update,
 * merge logic, edge cases, and integration with OperationHistoryService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoLearner } from './auto-learn.js';

import type { OperationRecord } from '../db/repositories/operation-repository.js';
import type {
  KnowledgeRepository,
  Knowledge,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  KnowledgeSource,
} from '../db/repositories/knowledge-repository.js';
import type { ProfileRepository, Profile } from '../db/repositories/profile-repository.js';
import type { KnowledgeEntry } from '../db/schema.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal OperationRecord for testing. */
function makeOperation(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'op-1',
    serverId: 'srv-1',
    sessionId: null,
    userId: 'user-1',
    type: 'install',
    description: 'install caddy',
    commands: [
      'apt install -y debian-keyring debian-archive-keyring apt-transport-https',
      'curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg',
      'apt update && apt install caddy',
      'caddy version',
    ],
    output: 'v2.8.0\nCaddy installed successfully',
    status: 'success',
    riskLevel: 'green',
    snapshotId: null,
    duration: 15000,
    createdAt: '2026-02-09T10:00:00.000Z',
    completedAt: '2026-02-09T10:00:15.000Z',
    ...overrides,
  };
}

/** Create a mock KnowledgeRepository. */
function createMockKnowledgeRepo(): KnowledgeRepository {
  let idCounter = 0;
  const store = new Map<string, Knowledge>();

  return {
    search: vi.fn(async (_query: string) => []),
    findBySoftwarePlatform: vi.fn(async (_software: string, _platform: string) => null),
    create: vi.fn(async (input: CreateKnowledgeInput) => {
      const id = `knowledge-${++idCounter}`;
      const knowledge: Knowledge = {
        id,
        software: input.software,
        platform: input.platform,
        content: input.content,
        source: input.source,
        successCount: 0,
        lastUsed: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(id, knowledge);
      return knowledge;
    }),
    update: vi.fn(async (id: string, input: UpdateKnowledgeInput) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
      store.set(id, updated as Knowledge);
      return updated as Knowledge;
    }),
    recordUsage: vi.fn(async (_id: string) => true),
    getBySource: vi.fn(async (_source: KnowledgeSource) => []),
    delete: vi.fn(async (_id: string) => true),
  };
}

/** Create a mock ProfileRepository. */
function createMockProfileRepo(profile?: Partial<Profile>): ProfileRepository {
  const defaultProfile: Profile = {
    id: 'profile-1',
    serverId: 'srv-1',
    osInfo: {
      platform: 'Ubuntu',
      arch: 'x86_64',
      version: '22.04',
      kernel: '5.15.0',
      hostname: 'test-server',
      uptime: 86400,
    },
    software: [],
    services: [],
    preferences: null,
    notes: [],
    operationHistory: [],
    historySummary: null,
    updatedAt: new Date().toISOString(),
    ...profile,
  };

  return {
    getByServerId: vi.fn(async () => defaultProfile),
    create: vi.fn(async () => defaultProfile),
    update: vi.fn(async () => defaultProfile),
    addNote: vi.fn(async () => true),
    addOperationHistory: vi.fn(async () => true),
    getOperationHistory: vi.fn(async () => []),
    removeNote: vi.fn(async () => true),
    updatePreferences: vi.fn(async () => true),
    setHistorySummary: vi.fn(async () => true),
    trimOperationHistory: vi.fn(async () => true),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('auto-learn', () => {
  let knowledgeRepo: KnowledgeRepository;
  let profileRepo: ProfileRepository;
  let learner: AutoLearner;

  beforeEach(() => {
    knowledgeRepo = createMockKnowledgeRepo();
    profileRepo = createMockProfileRepo();
    learner = new AutoLearner(knowledgeRepo, profileRepo);
  });

  // --------------------------------------------------------------------------
  // shouldLearn
  // --------------------------------------------------------------------------

  describe('shouldLearn', () => {
    it('should return true for successful install with commands', () => {
      const op = makeOperation({ type: 'install', status: 'success' });
      expect(learner.shouldLearn(op)).toBe(true);
    });

    it('should return true for successful config with commands', () => {
      const op = makeOperation({ type: 'config', status: 'success' });
      expect(learner.shouldLearn(op)).toBe(true);
    });

    it('should return false for failed operations', () => {
      const op = makeOperation({ status: 'failed' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for pending operations', () => {
      const op = makeOperation({ status: 'pending' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for running operations', () => {
      const op = makeOperation({ status: 'running' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for rolled_back operations', () => {
      const op = makeOperation({ status: 'rolled_back' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for restart type', () => {
      const op = makeOperation({ type: 'restart', status: 'success' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for execute type', () => {
      const op = makeOperation({ type: 'execute', status: 'success' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false for backup type', () => {
      const op = makeOperation({ type: 'backup', status: 'success' });
      expect(learner.shouldLearn(op)).toBe(false);
    });

    it('should return false when no commands exist', () => {
      const op = makeOperation({ commands: [] });
      expect(learner.shouldLearn(op)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // extractSoftwareName
  // --------------------------------------------------------------------------

  describe('extractSoftwareName', () => {
    it('should extract from English description "install caddy"', () => {
      const op = makeOperation({ description: 'install caddy' });
      expect(learner.extractSoftwareName(op)).toBe('caddy');
    });

    it('should extract from English description "configure nginx"', () => {
      const op = makeOperation({ description: 'configure nginx' });
      expect(learner.extractSoftwareName(op)).toBe('nginx');
    });

    it('should extract from English description "setup docker"', () => {
      const op = makeOperation({ description: 'setup docker' });
      expect(learner.extractSoftwareName(op)).toBe('docker');
    });

    it('should extract from English description "deploy redis"', () => {
      const op = makeOperation({ description: 'deploy redis' });
      expect(learner.extractSoftwareName(op)).toBe('redis');
    });

    it('should extract from Chinese description "安装 caddy"', () => {
      const op = makeOperation({ description: '安装 caddy' });
      expect(learner.extractSoftwareName(op)).toBe('caddy');
    });

    it('should extract from Chinese description "配置 nginx"', () => {
      const op = makeOperation({ description: '配置 nginx' });
      expect(learner.extractSoftwareName(op)).toBe('nginx');
    });

    it('should extract from Chinese description "部署 docker"', () => {
      const op = makeOperation({ description: '部署 docker' });
      expect(learner.extractSoftwareName(op)).toBe('docker');
    });

    it('should extract from Chinese description "设置 redis"', () => {
      const op = makeOperation({ description: '设置 redis' });
      expect(learner.extractSoftwareName(op)).toBe('redis');
    });

    it('should fall back to command patterns when description has no match', () => {
      const op = makeOperation({
        description: 'Update the server',
        commands: ['apt install -y nginx'],
      });
      expect(learner.extractSoftwareName(op)).toBe('nginx');
    });

    it('should extract from yum install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['yum install -y httpd'],
      });
      expect(learner.extractSoftwareName(op)).toBe('httpd');
    });

    it('should extract from dnf install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['dnf install -y postgresql'],
      });
      expect(learner.extractSoftwareName(op)).toBe('postgresql');
    });

    it('should extract from brew install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['brew install redis'],
      });
      expect(learner.extractSoftwareName(op)).toBe('redis');
    });

    it('should extract from pip install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['pip3 install flask'],
      });
      expect(learner.extractSoftwareName(op)).toBe('flask');
    });

    it('should extract from npm install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['npm install -g pm2'],
      });
      expect(learner.extractSoftwareName(op)).toBe('pm2');
    });

    it('should extract from snap install commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['snap install certbot'],
      });
      expect(learner.extractSoftwareName(op)).toBe('certbot');
    });

    it('should extract from apk add commands', () => {
      const op = makeOperation({
        description: 'Perform action',
        commands: ['apk add curl'],
      });
      expect(learner.extractSoftwareName(op)).toBe('curl');
    });

    it('should return null when no software name is found', () => {
      const op = makeOperation({
        description: 'Do something',
        commands: ['echo hello', 'ls -la'],
      });
      expect(learner.extractSoftwareName(op)).toBeNull();
    });

    it('should prefer description over commands', () => {
      const op = makeOperation({
        description: 'install caddy',
        commands: ['apt install -y nginx'],
      });
      // Description says "caddy", commands say "nginx". Description wins.
      expect(learner.extractSoftwareName(op)).toBe('caddy');
    });
  });

  // --------------------------------------------------------------------------
  // extractSoftwareInfo
  // --------------------------------------------------------------------------

  describe('extractSoftwareInfo', () => {
    it('should return software info for valid operation', () => {
      const op = makeOperation({ description: 'install caddy' });
      const info = learner.extractSoftwareInfo(op);
      expect(info).not.toBeNull();
      expect(info!.software).toBe('caddy');
    });

    it('should lowercase the software name', () => {
      const op = makeOperation({ description: 'install Caddy' });
      const info = learner.extractSoftwareInfo(op);
      expect(info!.software).toBe('caddy');
    });

    it('should return null when software cannot be extracted', () => {
      const op = makeOperation({
        description: 'Do something random',
        commands: ['echo hello'],
      });
      expect(learner.extractSoftwareInfo(op)).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // resolvePlatform
  // --------------------------------------------------------------------------

  describe('resolvePlatform', () => {
    it('should resolve platform from server profile', async () => {
      const platform = await learner.resolvePlatform('srv-1', 'user-1');
      expect(platform).toBe('ubuntu-22.04');
    });

    it('should return "unknown" when profile has no osInfo', async () => {
      profileRepo = createMockProfileRepo({ osInfo: null });
      learner = new AutoLearner(knowledgeRepo, profileRepo);

      const platform = await learner.resolvePlatform('srv-1', 'user-1');
      expect(platform).toBe('unknown');
    });

    it('should return "unknown" when profile not found', async () => {
      vi.mocked(profileRepo.getByServerId).mockResolvedValue(null);

      const platform = await learner.resolvePlatform('srv-1', 'user-1');
      expect(platform).toBe('unknown');
    });

    it('should return "unknown" when repo throws', async () => {
      vi.mocked(profileRepo.getByServerId).mockRejectedValue(new Error('DB error'));

      const platform = await learner.resolvePlatform('srv-1', 'user-1');
      expect(platform).toBe('unknown');
    });

    it('should format platform as lowercase', async () => {
      profileRepo = createMockProfileRepo({
        osInfo: {
          platform: 'CentOS',
          arch: 'x86_64',
          version: '8',
          kernel: '4.18.0',
          hostname: 'test',
          uptime: 3600,
        },
      });
      learner = new AutoLearner(knowledgeRepo, profileRepo);

      const platform = await learner.resolvePlatform('srv-1', 'user-1');
      expect(platform).toBe('centos-8');
    });
  });

  // --------------------------------------------------------------------------
  // extractVerificationCommand
  // --------------------------------------------------------------------------

  describe('extractVerificationCommand', () => {
    it('should extract "--version" command', () => {
      const op = makeOperation({
        commands: ['apt install nginx', 'nginx --version'],
      });
      expect(learner.extractVerificationCommand(op)).toBe('nginx --version');
    });

    it('should extract "version" command', () => {
      const op = makeOperation({
        commands: ['apt install caddy', 'caddy version'],
      });
      expect(learner.extractVerificationCommand(op)).toBe('caddy version');
    });

    it('should extract systemctl status command', () => {
      const op = makeOperation({
        commands: ['apt install caddy', 'systemctl status caddy'],
      });
      expect(learner.extractVerificationCommand(op)).toBe('systemctl status caddy');
    });

    it('should return null when no verification command found', () => {
      const op = makeOperation({
        commands: ['apt install nginx', 'echo done'],
        output: null,
      });
      expect(learner.extractVerificationCommand(op)).toBeNull();
    });

    it('should check output for version patterns', () => {
      const op = makeOperation({
        commands: ['apt install caddy', 'caddy version'],
        output: 'v2.8.0',
      });
      expect(learner.extractVerificationCommand(op)).toBe('caddy version');
    });
  });

  // --------------------------------------------------------------------------
  // extractNotes
  // --------------------------------------------------------------------------

  describe('extractNotes', () => {
    it('should extract warning lines from output', () => {
      const op = makeOperation({
        output: 'Installing...\nWARNING: package is deprecated\nDone.',
      });
      const notes = learner.extractNotes(op);
      expect(notes.some((n) => n.includes('WARNING'))).toBe(true);
    });

    it('should detect GPG key usage', () => {
      const op = makeOperation({
        commands: ['curl ... | gpg --dearmor -o /usr/share/keyrings/caddy.gpg'],
        output: 'gpg key imported',
      });
      const notes = learner.extractNotes(op);
      expect(notes).toContain('需要添加 GPG key');
    });

    it('should detect external APT repository', () => {
      const op = makeOperation({
        commands: ['add-apt-repository ppa:something/repo'],
        output: 'Repository added',
      });
      const notes = learner.extractNotes(op);
      expect(notes).toContain('需要添加外部 APT 源');
    });

    it('should return empty array when no output', () => {
      const op = makeOperation({ output: null, commands: ['apt install nginx'] });
      expect(learner.extractNotes(op)).toEqual([]);
    });

    it('should deduplicate notes', () => {
      const op = makeOperation({
        commands: ['add-apt-repository ppa:test', 'apt-key add key.gpg'],
        output: 'gpg key added\nWarning: gpg key added',
      });
      const notes = learner.extractNotes(op);
      const unique = [...new Set(notes)];
      expect(notes.length).toBe(unique.length);
    });

    it('should limit warning lines to 3', () => {
      const op = makeOperation({
        output: Array.from({ length: 10 }, (_, i) => `WARNING: warning ${i}`).join('\n'),
      });
      const notes = learner.extractNotes(op);
      const warningCount = notes.filter((n) => n.startsWith('WARNING')).length;
      expect(warningCount).toBeLessThanOrEqual(3);
    });

    it('should skip very long warning lines', () => {
      const op = makeOperation({
        output: `WARNING: ${'x'.repeat(250)}`,
      });
      const notes = learner.extractNotes(op);
      // Lines > 200 chars are filtered out
      expect(notes.filter((n) => n.startsWith('WARNING'))).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // buildKnowledgeEntry
  // --------------------------------------------------------------------------

  describe('buildKnowledgeEntry', () => {
    it('should include all commands', () => {
      const op = makeOperation({
        commands: ['cmd1', 'cmd2', 'cmd3'],
      });
      const entry = learner.buildKnowledgeEntry(op);
      expect(entry.commands).toEqual(['cmd1', 'cmd2', 'cmd3']);
    });

    it('should include verification command when found', () => {
      const op = makeOperation({
        commands: ['apt install caddy', 'caddy version'],
      });
      const entry = learner.buildKnowledgeEntry(op);
      expect(entry.verification).toBe('caddy version');
    });

    it('should omit verification when not found', () => {
      const op = makeOperation({
        commands: ['echo hello'],
        output: null,
      });
      const entry = learner.buildKnowledgeEntry(op);
      expect(entry.verification).toBeUndefined();
    });

    it('should include notes when present', () => {
      const op = makeOperation({
        commands: ['add-apt-repository ppa:test'],
        output: 'WARNING: something important',
      });
      const entry = learner.buildKnowledgeEntry(op);
      expect(entry.notes).toBeDefined();
      expect(entry.notes!.length).toBeGreaterThan(0);
    });

    it('should omit notes when empty', () => {
      const op = makeOperation({
        commands: ['echo hello'],
        output: 'hello',
      });
      const entry = learner.buildKnowledgeEntry(op);
      expect(entry.notes).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // mergeKnowledgeEntries
  // --------------------------------------------------------------------------

  describe('mergeKnowledgeEntries', () => {
    it('should use incoming commands (latest are more accurate)', () => {
      const existing: KnowledgeEntry = {
        commands: ['old-cmd1', 'old-cmd2'],
        verification: 'old-verify',
      };
      const incoming: KnowledgeEntry = {
        commands: ['new-cmd1', 'new-cmd2', 'new-cmd3'],
        verification: 'new-verify',
      };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.commands).toEqual(['new-cmd1', 'new-cmd2', 'new-cmd3']);
    });

    it('should use incoming verification when available', () => {
      const existing: KnowledgeEntry = { commands: [], verification: 'old' };
      const incoming: KnowledgeEntry = { commands: [], verification: 'new' };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.verification).toBe('new');
    });

    it('should keep existing verification when incoming has none', () => {
      const existing: KnowledgeEntry = { commands: [], verification: 'old' };
      const incoming: KnowledgeEntry = { commands: [] };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.verification).toBe('old');
    });

    it('should merge and deduplicate notes', () => {
      const existing: KnowledgeEntry = {
        commands: [],
        notes: ['note1', 'note2'],
      };
      const incoming: KnowledgeEntry = {
        commands: [],
        notes: ['note2', 'note3'],
      };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.notes).toEqual(['note1', 'note2', 'note3']);
    });

    it('should handle missing notes on both sides', () => {
      const existing: KnowledgeEntry = { commands: [] };
      const incoming: KnowledgeEntry = { commands: [] };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.notes).toBeUndefined();
    });

    it('should use incoming platform', () => {
      const existing: KnowledgeEntry = { commands: [], platform: 'ubuntu-20.04' };
      const incoming: KnowledgeEntry = { commands: [], platform: 'ubuntu-22.04' };
      const merged = learner.mergeKnowledgeEntries(existing, incoming);
      expect(merged.platform).toBe('ubuntu-22.04');
    });
  });

  // --------------------------------------------------------------------------
  // processSuccessfulOperation
  // --------------------------------------------------------------------------

  describe('processSuccessfulOperation', () => {
    it('should create new knowledge for first-time operation', async () => {
      const op = makeOperation();
      const result = await learner.processSuccessfulOperation(op);

      expect(result.learned).toBe(true);
      expect(result.action).toBe('created');
      expect(result.knowledge).not.toBeNull();
      expect(result.knowledge!.software).toBe('caddy');
      expect(knowledgeRepo.create).toHaveBeenCalledTimes(1);
      expect(knowledgeRepo.recordUsage).toHaveBeenCalledTimes(1);
    });

    it('should update existing knowledge when duplicate found', async () => {
      const existingKnowledge: Knowledge = {
        id: 'existing-1',
        software: 'caddy',
        platform: 'unknown',
        content: { commands: ['old cmd'], verification: 'old verify' },
        source: 'auto_learn',
        successCount: 1,
        lastUsed: '2026-02-08T00:00:00.000Z',
        createdAt: '2026-02-07T00:00:00.000Z',
        updatedAt: '2026-02-08T00:00:00.000Z',
      };

      vi.mocked(knowledgeRepo.findBySoftwarePlatform).mockResolvedValue(existingKnowledge);

      const op = makeOperation();
      const result = await learner.processSuccessfulOperation(op);

      expect(result.learned).toBe(true);
      expect(result.action).toBe('updated');
      expect(result.knowledge!.successCount).toBe(2);
      expect(knowledgeRepo.update).toHaveBeenCalledTimes(1);
      expect(knowledgeRepo.recordUsage).toHaveBeenCalledTimes(1);
      expect(knowledgeRepo.create).not.toHaveBeenCalled();
    });

    it('should skip non-learnable operations', async () => {
      const op = makeOperation({ status: 'failed' });
      const result = await learner.processSuccessfulOperation(op);

      expect(result.learned).toBe(false);
      expect(result.action).toBe('skipped');
      expect(result.reason).toContain('Not learnable');
    });

    it('should skip when software name cannot be extracted', async () => {
      const op = makeOperation({
        description: 'Random task',
        commands: ['echo done'],
      });
      const result = await learner.processSuccessfulOperation(op);

      expect(result.learned).toBe(false);
      expect(result.action).toBe('skipped');
      expect(result.reason).toContain('Could not extract software name');
    });
  });

  // --------------------------------------------------------------------------
  // processWithPlatformResolution
  // --------------------------------------------------------------------------

  describe('processWithPlatformResolution', () => {
    it('should resolve platform from profile and create knowledge', async () => {
      const op = makeOperation();
      const result = await learner.processWithPlatformResolution(op);

      expect(result.learned).toBe(true);
      expect(result.action).toBe('created');
      expect(result.knowledge).not.toBeNull();
      expect(result.knowledge!.platform).toBe('ubuntu-22.04');
      expect(profileRepo.getByServerId).toHaveBeenCalledWith('srv-1', 'user-1');
    });

    it('should use "unknown" platform when profile unavailable', async () => {
      vi.mocked(profileRepo.getByServerId).mockResolvedValue(null);

      const op = makeOperation();
      const result = await learner.processWithPlatformResolution(op);

      expect(result.learned).toBe(true);
      expect(result.knowledge!.platform).toBe('unknown');
    });

    it('should skip non-learnable operations', async () => {
      const op = makeOperation({ type: 'restart', status: 'success' });
      const result = await learner.processWithPlatformResolution(op);

      expect(result.learned).toBe(false);
      expect(result.action).toBe('skipped');
    });

    it('should skip when software cannot be extracted', async () => {
      const op = makeOperation({
        description: 'do something',
        commands: ['echo hi'],
      });
      const result = await learner.processWithPlatformResolution(op);

      expect(result.learned).toBe(false);
      expect(result.action).toBe('skipped');
    });

    it('should update existing knowledge with platform resolution', async () => {
      const existing: Knowledge = {
        id: 'k-1',
        software: 'caddy',
        platform: 'ubuntu-22.04',
        content: { commands: ['old'] },
        source: 'auto_learn',
        successCount: 5,
        lastUsed: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      vi.mocked(knowledgeRepo.findBySoftwarePlatform).mockResolvedValue(existing);

      const op = makeOperation();
      const result = await learner.processWithPlatformResolution(op);

      expect(result.learned).toBe(true);
      expect(result.action).toBe('updated');
      expect(result.knowledge!.successCount).toBe(6);
    });

    it('should set platform in the knowledge entry content', async () => {
      const op = makeOperation();
      const result = await learner.processWithPlatformResolution(op);

      expect(result.knowledge!.content.platform).toBe('ubuntu-22.04');
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle operation with single command', async () => {
      const op = makeOperation({
        description: 'install curl',
        commands: ['apt install -y curl'],
      });
      const result = await learner.processSuccessfulOperation(op);
      expect(result.learned).toBe(true);
      expect(result.knowledge!.content.commands).toEqual(['apt install -y curl']);
    });

    it('should handle operation with empty output', async () => {
      const op = makeOperation({
        output: '',
      });
      const result = await learner.processSuccessfulOperation(op);
      expect(result.learned).toBe(true);
    });

    it('should handle operation with null output', async () => {
      const op = makeOperation({
        output: null,
      });
      const result = await learner.processSuccessfulOperation(op);
      expect(result.learned).toBe(true);
    });

    it('should handle case-insensitive description matching', () => {
      const op = makeOperation({ description: 'Install Nginx' });
      const name = learner.extractSoftwareName(op);
      expect(name).toBe('Nginx');
    });

    it('should clean version specifiers from software names', () => {
      const op = makeOperation({
        description: 'Perform task',
        commands: ['pip install flask>=2.0'],
      });
      const name = learner.extractSoftwareName(op);
      expect(name).toBe('flask');
    });

    it('should clean @ scope from npm packages', () => {
      const op = makeOperation({
        description: 'Perform task',
        commands: ['npm install -g typescript@latest'],
      });
      const name = learner.extractSoftwareName(op);
      expect(name).toBe('typescript');
    });

    it('should handle multiple matching commands (picks first)', () => {
      const op = makeOperation({
        description: 'Update server',
        commands: [
          'apt install -y nginx',
          'apt install -y certbot',
        ],
      });
      expect(learner.extractSoftwareName(op)).toBe('nginx');
    });
  });

  // --------------------------------------------------------------------------
  // Integration: OperationHistoryService calling auto-learn
  // --------------------------------------------------------------------------

  describe('integration with OperationHistoryService', () => {
    it('should be callable as a fire-and-forget from markComplete', async () => {
      const op = makeOperation();
      const promise = learner.processWithPlatformResolution(op);

      // Should not throw
      const result = await promise;
      expect(result.learned).toBe(true);
    });

    it('should handle repository errors gracefully', async () => {
      vi.mocked(knowledgeRepo.create).mockRejectedValue(new Error('DB error'));

      const op = makeOperation();
      // Should reject (the caller in OperationHistoryService catches this)
      await expect(learner.processWithPlatformResolution(op)).rejects.toThrow('DB error');
    });
  });
});
