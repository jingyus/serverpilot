// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for KnowledgeRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleKnowledgeRepository } from './knowledge-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleKnowledgeRepository;

describe('DrizzleKnowledgeRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleKnowledgeRepository(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create a knowledge entry', async () => {
    const entry = await repo.create({
      software: 'nginx',
      platform: 'ubuntu',
      content: {
        commands: ['apt install nginx'],
        verification: 'nginx -v',
        notes: ['Requires root'],
      },
      source: 'builtin',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.software).toBe('nginx');
    expect(entry.platform).toBe('ubuntu');
    expect(entry.successCount).toBe(0);
  });

  it('should find by software + platform', async () => {
    await repo.create({
      software: 'nginx',
      platform: 'ubuntu',
      content: { commands: ['apt install nginx'] },
      source: 'builtin',
    });

    const found = await repo.findBySoftwarePlatform('nginx', 'ubuntu');
    expect(found).not.toBeNull();
    expect(found!.software).toBe('nginx');
    expect(found!.platform).toBe('ubuntu');
  });

  it('should return null for non-existent software+platform', async () => {
    const found = await repo.findBySoftwarePlatform('nonexistent', 'linux');
    expect(found).toBeNull();
  });

  it('should search by software name', async () => {
    await repo.create({
      software: 'nginx',
      platform: 'ubuntu',
      content: { commands: ['apt install nginx'] },
      source: 'builtin',
    });
    await repo.create({
      software: 'nginx',
      platform: 'centos',
      content: { commands: ['yum install nginx'] },
      source: 'builtin',
    });
    await repo.create({
      software: 'redis',
      platform: 'ubuntu',
      content: { commands: ['apt install redis'] },
      source: 'builtin',
    });

    const results = await repo.search('nginx');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.software === 'nginx')).toBe(true);
  });

  it('should search with partial match', async () => {
    await repo.create({
      software: 'nodejs',
      platform: 'ubuntu',
      content: { commands: ['nvm install node'] },
      source: 'builtin',
    });

    const results = await repo.search('node');
    expect(results).toHaveLength(1);
    expect(results[0].software).toBe('nodejs');
  });

  it('should update knowledge entry', async () => {
    const created = await repo.create({
      software: 'mysql',
      platform: 'ubuntu',
      content: { commands: ['apt install mysql-server'] },
      source: 'builtin',
    });

    const updated = await repo.update(created.id, {
      content: {
        commands: ['apt install mysql-server', 'mysql_secure_installation'],
        verification: 'mysql --version',
      },
    });

    expect(updated).not.toBeNull();
    expect(updated!.content.commands).toHaveLength(2);
  });

  it('should update source', async () => {
    const created = await repo.create({
      software: 'redis',
      platform: 'ubuntu',
      content: { commands: ['apt install redis'] },
      source: 'builtin',
    });

    const updated = await repo.update(created.id, { source: 'auto_learn' });
    expect(updated!.source).toBe('auto_learn');
  });

  it('should return null when updating non-existent entry', async () => {
    const result = await repo.update('nonexistent', {
      content: { commands: ['nope'] },
    });
    expect(result).toBeNull();
  });

  it('should record usage', async () => {
    const created = await repo.create({
      software: 'docker',
      platform: 'ubuntu',
      content: { commands: ['apt install docker.io'] },
      source: 'builtin',
    });

    expect(created.successCount).toBe(0);

    await repo.recordUsage(created.id);
    await repo.recordUsage(created.id);

    const found = await repo.findBySoftwarePlatform('docker', 'ubuntu');
    expect(found!.successCount).toBe(2);
    expect(found!.lastUsed).toBeTruthy();
  });

  it('should return false when recording usage for non-existent entry', async () => {
    const result = await repo.recordUsage('nonexistent');
    expect(result).toBe(false);
  });

  it('should get entries by source', async () => {
    await repo.create({
      software: 'nginx',
      platform: 'ubuntu',
      content: { commands: ['apt install nginx'] },
      source: 'builtin',
    });
    await repo.create({
      software: 'custom-app',
      platform: 'ubuntu',
      content: { commands: ['make install'] },
      source: 'auto_learn',
    });

    const builtins = await repo.getBySource('builtin');
    expect(builtins).toHaveLength(1);
    expect(builtins[0].software).toBe('nginx');

    const learned = await repo.getBySource('auto_learn');
    expect(learned).toHaveLength(1);
    expect(learned[0].software).toBe('custom-app');
  });

  it('should delete a knowledge entry', async () => {
    const created = await repo.create({
      software: 'deprecated',
      platform: 'ubuntu',
      content: { commands: ['old command'] },
      source: 'builtin',
    });

    const deleted = await repo.delete(created.id);
    expect(deleted).toBe(true);

    const found = await repo.findBySoftwarePlatform('deprecated', 'ubuntu');
    expect(found).toBeNull();
  });

  it('should return false when deleting non-existent entry', async () => {
    const result = await repo.delete('nonexistent');
    expect(result).toBe(false);
  });

  it('should order search results by success count', async () => {
    const popular = await repo.create({
      software: 'nginx',
      platform: 'ubuntu',
      content: { commands: ['apt install nginx'] },
      source: 'builtin',
    });
    await repo.create({
      software: 'nginx',
      platform: 'centos',
      content: { commands: ['yum install nginx'] },
      source: 'builtin',
    });

    // Make the ubuntu entry more popular
    await repo.recordUsage(popular.id);
    await repo.recordUsage(popular.id);

    const results = await repo.search('nginx');
    expect(results[0].platform).toBe('ubuntu');
    expect(results[0].successCount).toBe(2);
  });
});
