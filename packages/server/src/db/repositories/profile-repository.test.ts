// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for ProfileRepository (Drizzle implementation).
 *
 * Validates CRUD, notes, preferences, operation history,
 * history summary, and user isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleProfileRepository } from './profile-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleProfileRepository;

function seedUser(id: string, email: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(id: string, userId: string, name: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${id}', '${name}', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

function seedProfile(id: string, serverId: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO profiles (id, server_id, os_info, software, services, preferences, notes, operation_history, history_summary, updated_at)
     VALUES ('${id}', '${serverId}', null, '[]', '[]', null, '[]', '[]', null, ${Date.now()})`,
  );
}

describe('DrizzleProfileRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleProfileRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1', 'Server 1');
    seedServer('srv-2', 'user-2', 'Server 2');
    seedProfile('prof-1', 'srv-1');
    seedProfile('prof-2', 'srv-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  // ==========================================================================
  // getByServerId
  // ==========================================================================

  it('should get profile by server ID', async () => {
    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile).not.toBeNull();
    expect(profile!.serverId).toBe('srv-1');
    expect(profile!.software).toEqual([]);
    expect(profile!.historySummary).toBeNull();
  });

  it('should deny profile access to wrong user', async () => {
    const profile = await repo.getByServerId('srv-1', 'user-2');
    expect(profile).toBeNull();
  });

  it('should return null for non-existent server', async () => {
    const profile = await repo.getByServerId('nonexistent', 'user-1');
    expect(profile).toBeNull();
  });

  // ==========================================================================
  // create
  // ==========================================================================

  it('should create a new profile', async () => {
    seedServer('srv-3', 'user-1', 'Server 3');

    const profile = await repo.create('srv-3', 'user-1');
    expect(profile.serverId).toBe('srv-3');
    expect(profile.osInfo).toBeNull();
    expect(profile.software).toEqual([]);
    expect(profile.notes).toEqual([]);
    expect(profile.historySummary).toBeNull();
  });

  it('should throw when creating profile for non-owned server', async () => {
    await expect(repo.create('srv-2', 'user-1')).rejects.toThrow(
      'Server not found or access denied',
    );
  });

  // ==========================================================================
  // update
  // ==========================================================================

  it('should update profile OS info', async () => {
    const osInfo = {
      platform: 'linux',
      arch: 'x64',
      version: 'Ubuntu 22.04',
      kernel: '5.15.0',
      hostname: 'web-01',
      uptime: 86400,
    };

    const updated = await repo.update('srv-1', 'user-1', { osInfo });
    expect(updated).not.toBeNull();
    expect(updated!.osInfo).toEqual(osInfo);
  });

  it('should update profile software list', async () => {
    const software = [
      { name: 'nginx', version: '1.24', ports: [80, 443] },
      { name: 'nodejs', version: '22.0', ports: [3000] },
    ];

    const updated = await repo.update('srv-1', 'user-1', { software });
    expect(updated!.software).toHaveLength(2);
    expect(updated!.software[0].name).toBe('nginx');
  });

  it('should update profile services', async () => {
    const services = [
      { name: 'nginx', status: 'running' as const, ports: [80] },
    ];

    const updated = await repo.update('srv-1', 'user-1', { services });
    expect(updated!.services).toHaveLength(1);
  });

  it('should update preferences', async () => {
    const preferences = {
      packageManager: 'apt' as const,
      deploymentStyle: 'docker' as const,
    };

    const updated = await repo.update('srv-1', 'user-1', { preferences });
    expect(updated!.preferences).toEqual(preferences);
  });

  it('should NOT update profile for wrong user', async () => {
    const updated = await repo.update('srv-1', 'user-2', {
      osInfo: {
        platform: 'hacked',
        arch: 'x',
        version: 'x',
        kernel: 'x',
        hostname: 'x',
        uptime: 0,
      },
    });
    expect(updated).toBeNull();
  });

  // ==========================================================================
  // Notes
  // ==========================================================================

  it('should add a note', async () => {
    const result = await repo.addNote('srv-1', 'user-1', 'First note');
    expect(result).toBe(true);

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.notes).toContain('First note');
  });

  it('should add multiple notes', async () => {
    await repo.addNote('srv-1', 'user-1', 'Note 1');
    await repo.addNote('srv-1', 'user-1', 'Note 2');

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.notes).toEqual(['Note 1', 'Note 2']);
  });

  it('should NOT add note for wrong user', async () => {
    const result = await repo.addNote('srv-1', 'user-2', 'Hacked');
    expect(result).toBe(false);
  });

  it('should remove a note by index', async () => {
    await repo.addNote('srv-1', 'user-1', 'Note A');
    await repo.addNote('srv-1', 'user-1', 'Note B');
    await repo.addNote('srv-1', 'user-1', 'Note C');

    const result = await repo.removeNote('srv-1', 'user-1', 1);
    expect(result).toBe(true);

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.notes).toEqual(['Note A', 'Note C']);
  });

  it('should return false for invalid note index', async () => {
    await repo.addNote('srv-1', 'user-1', 'Note');
    expect(await repo.removeNote('srv-1', 'user-1', 5)).toBe(false);
    expect(await repo.removeNote('srv-1', 'user-1', -1)).toBe(false);
  });

  it('should NOT remove note for wrong user', async () => {
    await repo.addNote('srv-1', 'user-1', 'Note');
    const result = await repo.removeNote('srv-1', 'user-2', 0);
    expect(result).toBe(false);
  });

  // ==========================================================================
  // Preferences
  // ==========================================================================

  it('should update preferences via updatePreferences', async () => {
    const result = await repo.updatePreferences('srv-1', 'user-1', {
      packageManager: 'apt',
      shell: 'zsh',
    });
    expect(result).toBe(true);

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.preferences).toEqual({
      packageManager: 'apt',
      shell: 'zsh',
    });
  });

  it('should merge preferences with existing', async () => {
    await repo.updatePreferences('srv-1', 'user-1', { packageManager: 'apt' });
    await repo.updatePreferences('srv-1', 'user-1', { deploymentStyle: 'docker' });

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.preferences).toEqual({
      packageManager: 'apt',
      deploymentStyle: 'docker',
    });
  });

  it('should NOT update preferences for wrong user', async () => {
    const result = await repo.updatePreferences('srv-1', 'user-2', {
      packageManager: 'apt',
    });
    expect(result).toBe(false);
  });

  // ==========================================================================
  // Operation History
  // ==========================================================================

  it('should add operation history', async () => {
    const result = await repo.addOperationHistory(
      'srv-1',
      'user-1',
      'Installed nginx 1.24',
    );
    expect(result).toBe(true);

    const history = await repo.getOperationHistory('srv-1', 'user-1');
    expect(history).toContain('Installed nginx 1.24');
  });

  it('should return empty history for wrong user', async () => {
    const history = await repo.getOperationHistory('srv-1', 'user-2');
    expect(history).toEqual([]);
  });

  // ==========================================================================
  // History Summary
  // ==========================================================================

  it('should set history summary', async () => {
    const result = await repo.setHistorySummary(
      'srv-1',
      'user-1',
      'Server had 15 nginx config changes and 3 Redis restarts.',
    );
    expect(result).toBe(true);

    const profile = await repo.getByServerId('srv-1', 'user-1');
    expect(profile!.historySummary).toBe(
      'Server had 15 nginx config changes and 3 Redis restarts.',
    );
  });

  it('should NOT set history summary for wrong user', async () => {
    const result = await repo.setHistorySummary('srv-1', 'user-2', 'Hacked');
    expect(result).toBe(false);
  });

  it('should NOT set history summary for non-existent server', async () => {
    const result = await repo.setHistorySummary('nonexistent', 'user-1', 'Test');
    expect(result).toBe(false);
  });

  // ==========================================================================
  // Trim Operation History
  // ==========================================================================

  it('should trim operation history keeping only recent entries', async () => {
    for (let i = 0; i < 10; i++) {
      await repo.addOperationHistory('srv-1', 'user-1', `Op ${i}`);
    }

    const result = await repo.trimOperationHistory('srv-1', 'user-1', 3);
    expect(result).toBe(true);

    const history = await repo.getOperationHistory('srv-1', 'user-1');
    expect(history).toHaveLength(3);
    expect(history[0]).toBe('Op 7');
    expect(history[2]).toBe('Op 9');
  });

  it('should NOT trim history for wrong user', async () => {
    await repo.addOperationHistory('srv-1', 'user-1', 'Op');
    const result = await repo.trimOperationHistory('srv-1', 'user-2', 0);
    expect(result).toBe(false);
  });

  it('should handle trim when history is shorter than keepCount', async () => {
    await repo.addOperationHistory('srv-1', 'user-1', 'Op 1');
    await repo.addOperationHistory('srv-1', 'user-1', 'Op 2');

    const result = await repo.trimOperationHistory('srv-1', 'user-1', 10);
    expect(result).toBe(true);

    const history = await repo.getOperationHistory('srv-1', 'user-1');
    expect(history).toHaveLength(2);
  });
});
