// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for settings repository (in-memory implementation).
 *
 * @module db/repositories/settings-repository.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemorySettingsRepository,
  getSettingsRepository,
  setSettingsRepository,
  _resetSettingsRepository,
} from './settings-repository.js';

describe('InMemorySettingsRepository', () => {
  let repo: InMemorySettingsRepository;

  beforeEach(() => {
    repo = new InMemorySettingsRepository();
    _resetSettingsRepository();
  });

  afterEach(() => {
    _resetSettingsRepository();
  });

  describe('create', () => {
    it('should create settings with all defaults', async () => {
      const settings = await repo.create({ userId: 'user-1' });

      expect(settings.id).toBeTruthy();
      expect(settings.userId).toBe('user-1');
      expect(settings.aiProvider.provider).toBe('claude');
      expect(settings.notifications.emailNotifications).toBe(true);
      expect(settings.notifications.taskCompletion).toBe(true);
      expect(settings.notifications.systemAlerts).toBe(true);
      expect(settings.notifications.operationReports).toBe(false);
      expect(settings.knowledgeBase.autoLearning).toBe(false);
      expect(settings.knowledgeBase.documentSources).toEqual([]);
      expect(settings.createdAt).toBeTruthy();
      expect(settings.updatedAt).toBeTruthy();
    });

    it('should merge custom aiProvider with defaults', async () => {
      const settings = await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
      });

      expect(settings.aiProvider.provider).toBe('openai');
      expect(settings.aiProvider.apiKey).toBe('sk-test');
      expect(settings.aiProvider.model).toBe('gpt-4');
    });

    it('should merge custom notifications with defaults', async () => {
      const settings = await repo.create({
        userId: 'user-1',
        notifications: {
          emailNotifications: false,
          operationReports: true,
        },
      });

      expect(settings.notifications.emailNotifications).toBe(false);
      expect(settings.notifications.taskCompletion).toBe(true);
      expect(settings.notifications.systemAlerts).toBe(true);
      expect(settings.notifications.operationReports).toBe(true);
    });

    it('should merge custom knowledgeBase with defaults', async () => {
      const settings = await repo.create({
        userId: 'user-1',
        knowledgeBase: {
          autoLearning: true,
          documentSources: ['source-1'],
        },
      });

      expect(settings.knowledgeBase.autoLearning).toBe(true);
      expect(settings.knowledgeBase.documentSources).toEqual(['source-1']);
    });

    it('should create settings with all custom values', async () => {
      const settings = await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
        notifications: {
          emailNotifications: false,
          taskCompletion: false,
          systemAlerts: true,
          operationReports: true,
        },
        knowledgeBase: {
          autoLearning: true,
          documentSources: ['source-1'],
        },
      });

      expect(settings.aiProvider.provider).toBe('openai');
      expect(settings.notifications.emailNotifications).toBe(false);
      expect(settings.notifications.taskCompletion).toBe(false);
      expect(settings.notifications.operationReports).toBe(true);
      expect(settings.knowledgeBase.autoLearning).toBe(true);
      expect(settings.knowledgeBase.documentSources).toEqual(['source-1']);
    });
  });

  describe('findByUserId', () => {
    it('should return settings for an existing user', async () => {
      const created = await repo.create({ userId: 'user-1' });

      const found = await repo.findByUserId('user-1');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.userId).toBe('user-1');
    });

    it('should return null for non-existent user', async () => {
      const settings = await repo.findByUserId('non-existent');
      expect(settings).toBeNull();
    });

    it('should return the correct user when multiple exist', async () => {
      await repo.create({ userId: 'user-1' });
      await repo.create({
        userId: 'user-2',
        aiProvider: { provider: 'openai' },
      });

      const settings = await repo.findByUserId('user-2');
      expect(settings).not.toBeNull();
      expect(settings!.userId).toBe('user-2');
      expect(settings!.aiProvider.provider).toBe('openai');
    });
  });

  describe('update', () => {
    it('should merge aiProvider with existing settings', async () => {
      await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'claude', apiKey: 'sk-old', model: 'claude-3' },
      });

      const updated = await repo.update('user-1', {
        aiProvider: { model: 'claude-4' },
      });

      expect(updated).not.toBeNull();
      expect(updated!.aiProvider.provider).toBe('claude');
      expect(updated!.aiProvider.apiKey).toBe('sk-old');
      expect(updated!.aiProvider.model).toBe('claude-4');
    });

    it('should merge notifications with existing settings', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        notifications: {
          emailNotifications: false,
          operationReports: true,
        },
      });

      expect(updated).not.toBeNull();
      expect(updated!.notifications.emailNotifications).toBe(false);
      expect(updated!.notifications.taskCompletion).toBe(true);
      expect(updated!.notifications.systemAlerts).toBe(true);
      expect(updated!.notifications.operationReports).toBe(true);
    });

    it('should merge knowledgeBase with existing settings', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        knowledgeBase: {
          autoLearning: true,
          documentSources: ['source-1', 'source-2'],
        },
      });

      expect(updated).not.toBeNull();
      expect(updated!.knowledgeBase.autoLearning).toBe(true);
      expect(updated!.knowledgeBase.documentSources).toEqual(['source-1', 'source-2']);
    });

    it('should return null for non-existent user', async () => {
      const updated = await repo.update('non-existent', {
        aiProvider: { provider: 'openai' },
      });
      expect(updated).toBeNull();
    });

    it('should update multiple sections at once', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        aiProvider: { provider: 'ollama', baseUrl: 'http://localhost:11434' },
        notifications: { emailNotifications: false, taskCompletion: false, systemAlerts: true, operationReports: false },
        knowledgeBase: { autoLearning: true, documentSources: [] },
      });

      expect(updated).not.toBeNull();
      expect(updated!.aiProvider.provider).toBe('ollama');
      expect(updated!.aiProvider.baseUrl).toBe('http://localhost:11434');
      expect(updated!.notifications.emailNotifications).toBe(false);
      expect(updated!.notifications.taskCompletion).toBe(false);
      expect(updated!.knowledgeBase.autoLearning).toBe(true);
    });

    it('should update the updatedAt timestamp', async () => {
      const created = await repo.create({ userId: 'user-1' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await repo.update('user-1', {
        aiProvider: { provider: 'openai' },
      });

      expect(updated).not.toBeNull();
      expect(updated!.updatedAt).not.toBe(created.updatedAt);
    });

    it('should preserve sections not included in the update', async () => {
      await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'openai', apiKey: 'sk-key' },
        notifications: { emailNotifications: false, taskCompletion: false, systemAlerts: false, operationReports: true },
      });

      // Only update knowledgeBase
      const updated = await repo.update('user-1', {
        knowledgeBase: { autoLearning: true, documentSources: ['doc-1'] },
      });

      expect(updated).not.toBeNull();
      expect(updated!.aiProvider.provider).toBe('openai');
      expect(updated!.aiProvider.apiKey).toBe('sk-key');
      expect(updated!.notifications.emailNotifications).toBe(false);
      expect(updated!.notifications.operationReports).toBe(true);
      expect(updated!.knowledgeBase.autoLearning).toBe(true);
    });
  });

  describe('delete', () => {
    it('should remove settings and return true', async () => {
      await repo.create({ userId: 'user-1' });

      const result = await repo.delete('user-1');
      expect(result).toBe(true);

      const settings = await repo.findByUserId('user-1');
      expect(settings).toBeNull();
    });

    it('should return false for non-existent user', async () => {
      const result = await repo.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should not affect other users when deleting', async () => {
      await repo.create({ userId: 'user-1' });
      await repo.create({ userId: 'user-2' });

      await repo.delete('user-1');

      const settings1 = await repo.findByUserId('user-1');
      const settings2 = await repo.findByUserId('user-2');

      expect(settings1).toBeNull();
      expect(settings2).not.toBeNull();
      expect(settings2!.userId).toBe('user-2');
    });
  });

  describe('clear', () => {
    it('should remove all settings', async () => {
      await repo.create({ userId: 'user-1' });
      await repo.create({ userId: 'user-2' });
      await repo.create({ userId: 'user-3' });

      repo.clear();

      const s1 = await repo.findByUserId('user-1');
      const s2 = await repo.findByUserId('user-2');
      const s3 = await repo.findByUserId('user-3');

      expect(s1).toBeNull();
      expect(s2).toBeNull();
      expect(s3).toBeNull();
    });
  });

  describe('multiple users', () => {
    it('should handle multiple users independently', async () => {
      await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'claude' },
      });
      await repo.create({
        userId: 'user-2',
        aiProvider: { provider: 'openai' },
      });

      const settings1 = await repo.findByUserId('user-1');
      const settings2 = await repo.findByUserId('user-2');

      expect(settings1?.aiProvider.provider).toBe('claude');
      expect(settings2?.aiProvider.provider).toBe('openai');
    });

    it('should update one user without affecting others', async () => {
      await repo.create({ userId: 'user-1' });
      await repo.create({ userId: 'user-2' });

      await repo.update('user-1', {
        aiProvider: { provider: 'ollama' },
      });

      const settings1 = await repo.findByUserId('user-1');
      const settings2 = await repo.findByUserId('user-2');

      expect(settings1?.aiProvider.provider).toBe('ollama');
      expect(settings2?.aiProvider.provider).toBe('claude');
    });
  });
});

describe('SettingsRepository singleton', () => {
  afterEach(() => {
    _resetSettingsRepository();
  });

  it('should return an instance from getSettingsRepository', () => {
    const inMemory = new InMemorySettingsRepository();
    setSettingsRepository(inMemory);

    const repo = getSettingsRepository();
    expect(repo).toBe(inMemory);
  });

  it('should allow overriding with setSettingsRepository', () => {
    const custom = new InMemorySettingsRepository();
    setSettingsRepository(custom);

    expect(getSettingsRepository()).toBe(custom);

    const another = new InMemorySettingsRepository();
    setSettingsRepository(another);

    expect(getSettingsRepository()).toBe(another);
    expect(getSettingsRepository()).not.toBe(custom);
  });

  it('should reset to null with _resetSettingsRepository', () => {
    const custom = new InMemorySettingsRepository();
    setSettingsRepository(custom);

    _resetSettingsRepository();

    // After reset, setting a new one should work and be different from the old one
    const fresh = new InMemorySettingsRepository();
    setSettingsRepository(fresh);

    expect(getSettingsRepository()).toBe(fresh);
    expect(getSettingsRepository()).not.toBe(custom);
  });
});
