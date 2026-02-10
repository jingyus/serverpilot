/**
 * Settings repository tests.
 *
 * @module db/repositories/settings-repository.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySettingsRepository } from './settings-repository.js';
import type { UserSettings } from './settings-repository.js';

describe('InMemorySettingsRepository', () => {
  let repo: InMemorySettingsRepository;

  beforeEach(() => {
    repo = new InMemorySettingsRepository();
  });

  describe('create', () => {
    it('should create settings with defaults', async () => {
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
    });

    it('should create settings with custom values', async () => {
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
      expect(settings.aiProvider.apiKey).toBe('sk-test');
      expect(settings.aiProvider.model).toBe('gpt-4');
      expect(settings.notifications.emailNotifications).toBe(false);
      expect(settings.notifications.operationReports).toBe(true);
      expect(settings.knowledgeBase.autoLearning).toBe(true);
      expect(settings.knowledgeBase.documentSources).toEqual(['source-1']);
    });
  });

  describe('findByUserId', () => {
    it('should return null if settings not found', async () => {
      const settings = await repo.findByUserId('non-existent');
      expect(settings).toBeNull();
    });

    it('should find settings by user ID', async () => {
      await repo.create({ userId: 'user-1' });
      await repo.create({ userId: 'user-2' });

      const settings = await repo.findByUserId('user-1');
      expect(settings).toBeTruthy();
      expect(settings?.userId).toBe('user-1');
    });
  });

  describe('update', () => {
    it('should return null if settings not found', async () => {
      const updated = await repo.update('non-existent', {
        aiProvider: { provider: 'openai' },
      });
      expect(updated).toBeNull();
    });

    it('should update AI provider settings', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        aiProvider: { provider: 'openai', apiKey: 'sk-test' },
      });

      expect(updated).toBeTruthy();
      expect(updated?.aiProvider.provider).toBe('openai');
      expect(updated?.aiProvider.apiKey).toBe('sk-test');
    });

    it('should merge AI provider settings', async () => {
      await repo.create({
        userId: 'user-1',
        aiProvider: { provider: 'claude', apiKey: 'sk-old', model: 'claude-3' },
      });

      const updated = await repo.update('user-1', {
        aiProvider: { model: 'claude-4' },
      });

      expect(updated?.aiProvider.provider).toBe('claude');
      expect(updated?.aiProvider.apiKey).toBe('sk-old');
      expect(updated?.aiProvider.model).toBe('claude-4');
    });

    it('should update notification settings', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        notifications: {
          emailNotifications: false,
          taskCompletion: false,
          systemAlerts: false,
          operationReports: true,
        },
      });

      expect(updated?.notifications.emailNotifications).toBe(false);
      expect(updated?.notifications.taskCompletion).toBe(false);
      expect(updated?.notifications.systemAlerts).toBe(false);
      expect(updated?.notifications.operationReports).toBe(true);
    });

    it('should update knowledge base settings', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        knowledgeBase: {
          autoLearning: true,
          documentSources: ['source-1', 'source-2'],
        },
      });

      expect(updated?.knowledgeBase.autoLearning).toBe(true);
      expect(updated?.knowledgeBase.documentSources).toEqual(['source-1', 'source-2']);
    });

    it('should update multiple sections at once', async () => {
      await repo.create({ userId: 'user-1' });

      const updated = await repo.update('user-1', {
        aiProvider: { provider: 'ollama', baseUrl: 'http://localhost:11434' },
        notifications: { emailNotifications: false, taskCompletion: false, systemAlerts: true, operationReports: false },
        knowledgeBase: { autoLearning: true, documentSources: [] },
      });

      expect(updated?.aiProvider.provider).toBe('ollama');
      expect(updated?.aiProvider.baseUrl).toBe('http://localhost:11434');
      expect(updated?.notifications.emailNotifications).toBe(false);
      expect(updated?.knowledgeBase.autoLearning).toBe(true);
    });

    it('should update updatedAt timestamp', async () => {
      const created = await repo.create({ userId: 'user-1' });

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await repo.update('user-1', {
        aiProvider: { provider: 'openai' },
      });

      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });
  });

  describe('delete', () => {
    it('should return false if settings not found', async () => {
      const result = await repo.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete settings', async () => {
      await repo.create({ userId: 'user-1' });

      const result = await repo.delete('user-1');
      expect(result).toBe(true);

      const settings = await repo.findByUserId('user-1');
      expect(settings).toBeNull();
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
