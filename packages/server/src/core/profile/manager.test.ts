/**
 * Tests for ProfileManager.
 *
 * Validates profile CRUD, preferences, notes, operation history,
 * history summary, Zod schema validation, and AI context building.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProfileManager,
  OsInfoSchema,
  SoftwareSchema,
  ServiceInfoSchema,
  PreferencesSchema,
  UpdateProfileInputSchema,
  AddNoteInputSchema,
  RemoveNoteInputSchema,
  RecordOperationInputSchema,
  HistorySummaryInputSchema,
  _resetProfileManager,
  getProfileManager,
} from './manager.js';
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';

// ============================================================================
// Test Helpers
// ============================================================================

let mgr: ProfileManager;
let repo: InMemoryServerRepository;

const USER_ID = 'user-1';
const OTHER_USER = 'user-2';

async function createTestServer(name = 'web-01') {
  return repo.create({ name, userId: USER_ID });
}

beforeEach(() => {
  repo = new InMemoryServerRepository();
  setServerRepository(repo);
  _resetProfileManager();
  mgr = new ProfileManager();
});

// ============================================================================
// Zod Schema Validation
// ============================================================================

describe('Zod schemas', () => {
  describe('OsInfoSchema', () => {
    it('should accept valid OS info', () => {
      const result = OsInfoSchema.safeParse({
        platform: 'ubuntu',
        arch: 'x86_64',
        version: '22.04',
        kernel: '5.15.0-76-generic',
        hostname: 'prod-01',
        uptime: 86400,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty platform', () => {
      const result = OsInfoSchema.safeParse({
        platform: '',
        arch: 'x86_64',
        version: '22.04',
        kernel: '5.15.0',
        hostname: 'prod-01',
        uptime: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative uptime', () => {
      const result = OsInfoSchema.safeParse({
        platform: 'ubuntu',
        arch: 'x86_64',
        version: '22.04',
        kernel: '5.15.0',
        hostname: 'prod-01',
        uptime: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SoftwareSchema', () => {
    it('should accept valid software', () => {
      const result = SoftwareSchema.safeParse({
        name: 'nginx',
        version: '1.24.0',
        configPath: '/etc/nginx',
        ports: [80, 443],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = SoftwareSchema.safeParse({
        name: '',
        version: '1.0',
        ports: [],
      });
      expect(result.success).toBe(false);
    });

    it('should accept software without optional fields', () => {
      const result = SoftwareSchema.safeParse({
        name: 'redis',
        version: '7.2',
        ports: [6379],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ServiceInfoSchema', () => {
    it('should accept valid service info', () => {
      const result = ServiceInfoSchema.safeParse({
        name: 'nginx',
        status: 'running',
        ports: [80],
        manager: 'systemd',
        uptime: 3600,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = ServiceInfoSchema.safeParse({
        name: 'nginx',
        status: 'unknown',
        ports: [],
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid status values', () => {
      for (const status of ['running', 'stopped', 'failed']) {
        const result = ServiceInfoSchema.safeParse({
          name: 'svc',
          status,
          ports: [],
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('PreferencesSchema', () => {
    it('should accept valid preferences', () => {
      const result = PreferencesSchema.safeParse({
        packageManager: 'apt',
        deploymentStyle: 'docker',
        shell: 'zsh',
        timezone: 'UTC',
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty preferences', () => {
      const result = PreferencesSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateProfileInputSchema', () => {
    it('should accept partial updates', () => {
      const result = UpdateProfileInputSchema.safeParse({
        software: [{ name: 'redis', version: '7.2', ports: [6379] }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty input', () => {
      const result = UpdateProfileInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('AddNoteInputSchema', () => {
    it('should accept valid note', () => {
      const result = AddNoteInputSchema.safeParse({ note: 'Server rebooted after kernel update' });
      expect(result.success).toBe(true);
    });

    it('should reject empty note', () => {
      const result = AddNoteInputSchema.safeParse({ note: '' });
      expect(result.success).toBe(false);
    });

    it('should reject note exceeding 500 chars', () => {
      const result = AddNoteInputSchema.safeParse({ note: 'x'.repeat(501) });
      expect(result.success).toBe(false);
    });
  });

  describe('RemoveNoteInputSchema', () => {
    it('should accept valid index', () => {
      const result = RemoveNoteInputSchema.safeParse({ index: 0 });
      expect(result.success).toBe(true);
    });

    it('should reject negative index', () => {
      const result = RemoveNoteInputSchema.safeParse({ index: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer index', () => {
      const result = RemoveNoteInputSchema.safeParse({ index: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('RecordOperationInputSchema', () => {
    it('should accept valid summary', () => {
      const result = RecordOperationInputSchema.safeParse({ summary: 'Installed nginx 1.24' });
      expect(result.success).toBe(true);
    });

    it('should reject empty summary', () => {
      const result = RecordOperationInputSchema.safeParse({ summary: '' });
      expect(result.success).toBe(false);
    });

    it('should reject summary exceeding 300 chars', () => {
      const result = RecordOperationInputSchema.safeParse({ summary: 'x'.repeat(301) });
      expect(result.success).toBe(false);
    });
  });

  describe('HistorySummaryInputSchema', () => {
    it('should accept valid summary with defaults', () => {
      const result = HistorySummaryInputSchema.safeParse({
        summary: 'Server had 10 operations in the last week.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keepRecentCount).toBe(20);
      }
    });

    it('should accept custom keepRecentCount', () => {
      const result = HistorySummaryInputSchema.safeParse({
        summary: 'Summary text',
        keepRecentCount: 50,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty summary', () => {
      const result = HistorySummaryInputSchema.safeParse({ summary: '' });
      expect(result.success).toBe(false);
    });

    it('should reject summary exceeding 5000 chars', () => {
      const result = HistorySummaryInputSchema.safeParse({
        summary: 'x'.repeat(5001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject keepRecentCount over 200', () => {
      const result = HistorySummaryInputSchema.safeParse({
        summary: 'Test',
        keepRecentCount: 201,
      });
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// getProfile
// ============================================================================

describe('getProfile', () => {
  it('should return profile for existing server', async () => {
    const server = await createTestServer();
    const profile = await mgr.getProfile(server.id, USER_ID);

    expect(profile).not.toBeNull();
    expect(profile!.serverId).toBe(server.id);
    expect(profile!.osInfo).toBeNull();
    expect(profile!.software).toEqual([]);
    expect(profile!.services).toEqual([]);
    expect(profile!.preferences).toBeNull();
    expect(profile!.notes).toEqual([]);
    expect(profile!.operationHistory).toEqual([]);
    expect(profile!.historySummary).toBeNull();
  });

  it('should return null for non-existent server', async () => {
    const profile = await mgr.getProfile('nonexistent', USER_ID);
    expect(profile).toBeNull();
  });

  it('should return null for wrong userId', async () => {
    const server = await createTestServer();
    const profile = await mgr.getProfile(server.id, OTHER_USER);
    expect(profile).toBeNull();
  });

  it('should include extension data after updates', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'Test note');
    mgr.setPreferences(server.id, { packageManager: 'apt' });

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.notes).toEqual(['Test note']);
    expect(profile!.preferences).toEqual({ packageManager: 'apt' });
  });
});

// ============================================================================
// updateProfile
// ============================================================================

describe('updateProfile', () => {
  it('should update OS info', async () => {
    const server = await createTestServer();
    const osInfo = {
      platform: 'ubuntu',
      arch: 'x86_64',
      version: '22.04',
      kernel: '5.15.0-76-generic',
      hostname: 'prod-01',
      uptime: 86400,
    };

    const updated = await mgr.updateProfile(server.id, USER_ID, { osInfo });
    expect(updated).not.toBeNull();
    expect(updated!.osInfo).toEqual(osInfo);
  });

  it('should update software list', async () => {
    const server = await createTestServer();
    const software = [
      { name: 'nginx', version: '1.24.0', configPath: '/etc/nginx', ports: [80, 443] },
      { name: 'redis', version: '7.2.0', ports: [6379] },
    ];

    const updated = await mgr.updateProfile(server.id, USER_ID, { software });
    expect(updated!.software).toHaveLength(2);
    expect(updated!.software[0].name).toBe('nginx');
  });

  it('should update services list', async () => {
    const server = await createTestServer();
    const services = [
      { name: 'nginx', status: 'running' as const, ports: [80], manager: 'systemd' },
      { name: 'redis', status: 'stopped' as const, ports: [6379] },
    ];

    const updated = await mgr.updateProfile(server.id, USER_ID, { services });
    expect(updated!.services).toHaveLength(2);
    expect(updated!.services[1].status).toBe('stopped');
  });

  it('should merge preferences', async () => {
    const server = await createTestServer();
    mgr.setPreferences(server.id, { packageManager: 'apt' });

    const updated = await mgr.updateProfile(server.id, USER_ID, {
      preferences: { deploymentStyle: 'docker' },
    });
    expect(updated!.preferences).toEqual({
      packageManager: 'apt',
      deploymentStyle: 'docker',
    });
  });

  it('should return null for non-existent server', async () => {
    const result = await mgr.updateProfile('nonexistent', USER_ID, {});
    expect(result).toBeNull();
  });

  it('should return null for wrong userId', async () => {
    const server = await createTestServer();
    const result = await mgr.updateProfile(server.id, OTHER_USER, {});
    expect(result).toBeNull();
  });

  it('should preserve unchanged fields', async () => {
    const server = await createTestServer();
    const osInfo = {
      platform: 'ubuntu', arch: 'x86_64', version: '22.04',
      kernel: '5.15.0', hostname: 'prod-01', uptime: 1000,
    };
    await mgr.updateProfile(server.id, USER_ID, { osInfo });

    const software = [{ name: 'nginx', version: '1.24', ports: [80] }];
    const updated = await mgr.updateProfile(server.id, USER_ID, { software });
    expect(updated!.osInfo).toEqual(osInfo);
    expect(updated!.software).toEqual(software);
  });

  it('should update the updatedAt timestamp', async () => {
    const server = await createTestServer();
    const before = (await mgr.getProfile(server.id, USER_ID))!.updatedAt;

    await new Promise((r) => setTimeout(r, 10));
    await mgr.updateProfile(server.id, USER_ID, {
      software: [{ name: 'redis', version: '7.0', ports: [] }],
    });

    const after = (await mgr.getProfile(server.id, USER_ID))!.updatedAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

// ============================================================================
// Notes
// ============================================================================

describe('addNote', () => {
  it('should add a note', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'First note');

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.notes).toEqual(['First note']);
  });

  it('should add multiple notes in order', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'Note 1');
    mgr.addNote(server.id, 'Note 2');
    mgr.addNote(server.id, 'Note 3');

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.notes).toEqual(['Note 1', 'Note 2', 'Note 3']);
  });

  it('should return true on success', () => {
    expect(mgr.addNote('any-server', 'A note')).toBe(true);
  });

  it('should enforce max notes cap', () => {
    const serverId = 'cap-test';
    for (let i = 0; i < 105; i++) {
      mgr.addNote(serverId, `Note ${i}`);
    }
    const profile = mgr['extensions'].get(serverId);
    expect(profile!.notes.length).toBeLessThanOrEqual(100);
    // The oldest notes should have been dropped
    expect(profile!.notes[0]).toBe('Note 5');
  });
});

describe('removeNote', () => {
  it('should remove a note by index', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'Note A');
    mgr.addNote(server.id, 'Note B');
    mgr.addNote(server.id, 'Note C');

    expect(mgr.removeNote(server.id, 1)).toBe(true);

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.notes).toEqual(['Note A', 'Note C']);
  });

  it('should return false for invalid index', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'Note');
    expect(mgr.removeNote(server.id, 5)).toBe(false);
    expect(mgr.removeNote(server.id, -1)).toBe(false);
  });

  it('should return false for unknown serverId', () => {
    expect(mgr.removeNote('nonexistent', 0)).toBe(false);
  });
});

// ============================================================================
// Operation History
// ============================================================================

describe('recordOperation', () => {
  it('should record an operation with timestamp', async () => {
    const server = await createTestServer();
    mgr.recordOperation(server.id, 'Installed nginx');

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.operationHistory).toHaveLength(1);
    expect(profile!.operationHistory[0]).toMatch(/\[.*\] Installed nginx/);
  });

  it('should maintain chronological order', async () => {
    const server = await createTestServer();
    mgr.recordOperation(server.id, 'Op 1');
    mgr.recordOperation(server.id, 'Op 2');

    const profile = await mgr.getProfile(server.id, USER_ID);
    expect(profile!.operationHistory[0]).toContain('Op 1');
    expect(profile!.operationHistory[1]).toContain('Op 2');
  });

  it('should enforce max history cap', () => {
    const serverId = 'history-cap';
    for (let i = 0; i < 210; i++) {
      mgr.recordOperation(serverId, `Op ${i}`);
    }
    const ext = mgr['extensions'].get(serverId);
    expect(ext!.operationHistory.length).toBeLessThanOrEqual(200);
  });
});

describe('getRecentOperations', () => {
  it('should return empty array for unknown server', () => {
    expect(mgr.getRecentOperations('nonexistent')).toEqual([]);
  });

  it('should return last N operations', async () => {
    const server = await createTestServer();
    for (let i = 0; i < 20; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    const recent = mgr.getRecentOperations(server.id, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toContain('Op 15');
    expect(recent[4]).toContain('Op 19');
  });

  it('should default to 10 entries', async () => {
    const server = await createTestServer();
    for (let i = 0; i < 20; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    const recent = mgr.getRecentOperations(server.id);
    expect(recent).toHaveLength(10);
  });
});

// ============================================================================
// Preferences
// ============================================================================

describe('setPreferences / getPreferences', () => {
  it('should set and get preferences', async () => {
    const server = await createTestServer();
    mgr.setPreferences(server.id, { packageManager: 'apt', shell: 'bash' });

    const prefs = mgr.getPreferences(server.id);
    expect(prefs).toEqual({ packageManager: 'apt', shell: 'bash' });
  });

  it('should merge with existing preferences', async () => {
    const server = await createTestServer();
    mgr.setPreferences(server.id, { packageManager: 'apt' });
    mgr.setPreferences(server.id, { deploymentStyle: 'docker' });

    const prefs = mgr.getPreferences(server.id);
    expect(prefs).toEqual({ packageManager: 'apt', deploymentStyle: 'docker' });
  });

  it('should return null for unknown server', () => {
    expect(mgr.getPreferences('nonexistent')).toBeNull();
  });

  it('should override existing preference values', async () => {
    const server = await createTestServer();
    mgr.setPreferences(server.id, { packageManager: 'apt' });
    mgr.setPreferences(server.id, { packageManager: 'yum' });

    expect(mgr.getPreferences(server.id)?.packageManager).toBe('yum');
  });
});

// ============================================================================
// History Summary
// ============================================================================

describe('setHistorySummary / getHistorySummary', () => {
  it('should set and get history summary', async () => {
    const server = await createTestServer();
    mgr.setHistorySummary(server.id, 'Server had 10 nginx updates.');

    expect(mgr.getHistorySummary(server.id)).toBe('Server had 10 nginx updates.');
  });

  it('should return null for unknown server', () => {
    expect(mgr.getHistorySummary('nonexistent')).toBeNull();
  });

  it('should overwrite existing summary', async () => {
    const server = await createTestServer();
    mgr.setHistorySummary(server.id, 'Old summary');
    mgr.setHistorySummary(server.id, 'New summary');

    expect(mgr.getHistorySummary(server.id)).toBe('New summary');
  });
});

describe('summarizeAndTrim', () => {
  it('should set summary and trim old history', async () => {
    const server = await createTestServer();
    for (let i = 0; i < 50; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    mgr.summarizeAndTrim(server.id, 'Performed 50 operations total.', 5);

    expect(mgr.getHistorySummary(server.id)).toBe('Performed 50 operations total.');
    const recent = mgr.getRecentOperations(server.id, 100);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toContain('Op 45');
  });

  it('should append to existing summary', async () => {
    const server = await createTestServer();
    mgr.setHistorySummary(server.id, 'First batch: 20 ops.');

    for (let i = 0; i < 30; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    mgr.summarizeAndTrim(server.id, 'Second batch: 30 ops.', 10);

    const summary = mgr.getHistorySummary(server.id);
    expect(summary).toContain('First batch: 20 ops.');
    expect(summary).toContain('Second batch: 30 ops.');
    expect(summary).toContain('---');
  });

  it('should use default keepRecentCount of 20', async () => {
    const server = await createTestServer();
    for (let i = 0; i < 50; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    mgr.summarizeAndTrim(server.id, 'Summary');

    const recent = mgr.getRecentOperations(server.id, 100);
    expect(recent).toHaveLength(20);
  });
});

// ============================================================================
// deleteProfile
// ============================================================================

describe('deleteProfile', () => {
  it('should delete extension data', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'A note');
    mgr.setPreferences(server.id, { shell: 'zsh' });
    mgr.setHistorySummary(server.id, 'Some summary');

    expect(mgr.deleteProfile(server.id)).toBe(true);
    expect(mgr.getPreferences(server.id)).toBeNull();
    expect(mgr.getHistorySummary(server.id)).toBeNull();
  });

  it('should return false for unknown server', () => {
    expect(mgr.deleteProfile('nonexistent')).toBe(false);
  });
});

// ============================================================================
// buildAIContext
// ============================================================================

describe('buildAIContext', () => {
  it('should return empty string for non-existent server', async () => {
    const context = await mgr.buildAIContext('nonexistent', USER_ID);
    expect(context).toBe('');
  });

  it('should return empty string for server with no data', async () => {
    const server = await createTestServer();
    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toBe('');
  });

  it('should include OS info in context', async () => {
    const server = await createTestServer();
    await mgr.updateProfile(server.id, USER_ID, {
      osInfo: {
        platform: 'ubuntu',
        arch: 'x86_64',
        version: '22.04',
        kernel: '5.15.0-76-generic',
        hostname: 'prod-01',
        uptime: 86400,
      },
    });

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('ubuntu');
    expect(context).toContain('22.04');
    expect(context).toContain('x86_64');
    expect(context).toContain('prod-01');
  });

  it('should include software list', async () => {
    const server = await createTestServer();
    await mgr.updateProfile(server.id, USER_ID, {
      software: [
        { name: 'nginx', version: '1.24.0', ports: [80, 443] },
        { name: 'redis', version: '7.2.0', ports: [6379] },
      ],
    });

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('nginx 1.24.0');
    expect(context).toContain('redis 7.2.0');
    expect(context).toContain('ports: 80, 443');
  });

  it('should include only running services', async () => {
    const server = await createTestServer();
    await mgr.updateProfile(server.id, USER_ID, {
      services: [
        { name: 'nginx', status: 'running', ports: [80] },
        { name: 'mysql', status: 'stopped', ports: [3306] },
      ],
    });

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('nginx');
    expect(context).not.toContain('mysql');
  });

  it('should include preferences', async () => {
    const server = await createTestServer();
    mgr.setPreferences(server.id, {
      packageManager: 'apt',
      deploymentStyle: 'docker',
    });

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('Package manager: apt');
    expect(context).toContain('Deployment: docker');
  });

  it('should include notes', async () => {
    const server = await createTestServer();
    mgr.addNote(server.id, 'Custom SSL cert at /etc/ssl/custom');

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('Custom SSL cert at /etc/ssl/custom');
  });

  it('should include history summary', async () => {
    const server = await createTestServer();
    mgr.setHistorySummary(server.id, 'Previously: installed nginx, redis, configured SSL.');

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('Operation history summary:');
    expect(context).toContain('Previously: installed nginx, redis, configured SSL.');
  });

  it('should include recent operations (max 5)', async () => {
    const server = await createTestServer();
    for (let i = 0; i < 10; i++) {
      mgr.recordOperation(server.id, `Op ${i}`);
    }

    const context = await mgr.buildAIContext(server.id, USER_ID);
    // Should include only the last 5
    expect(context).toContain('Op 5');
    expect(context).toContain('Op 9');
    expect(context).not.toContain('Op 4');
  });

  it('should include both summary and recent ops', async () => {
    const server = await createTestServer();
    mgr.setHistorySummary(server.id, 'Past: 50 nginx changes');
    mgr.recordOperation(server.id, 'Latest op');

    const context = await mgr.buildAIContext(server.id, USER_ID);
    expect(context).toContain('Past: 50 nginx changes');
    expect(context).toContain('Latest op');
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('singleton', () => {
  it('should return same instance', () => {
    _resetProfileManager();
    const a = getProfileManager();
    const b = getProfileManager();
    expect(a).toBe(b);
  });

  it('should return new instance after reset', () => {
    const a = getProfileManager();
    _resetProfileManager();
    const b = getProfileManager();
    expect(a).not.toBe(b);
  });
});
