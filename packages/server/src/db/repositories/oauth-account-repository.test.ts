// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OAuth account repository (in-memory implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryOAuthAccountRepository,
  getOAuthAccountRepository,
  setOAuthAccountRepository,
  _resetOAuthAccountRepository,
} from './oauth-account-repository.js';

let repo: InMemoryOAuthAccountRepository;

beforeEach(() => {
  repo = new InMemoryOAuthAccountRepository();
  _resetOAuthAccountRepository();
});

afterEach(() => {
  _resetOAuthAccountRepository();
});

describe('InMemoryOAuthAccountRepository', () => {
  describe('create', () => {
    it('should create an account with all correct fields', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
        providerUsername: 'testuser',
        providerAvatarUrl: 'https://example.com/avatar.png',
      });

      expect(account.id).toBeTruthy();
      expect(account.userId).toBe('user-1');
      expect(account.provider).toBe('github');
      expect(account.providerAccountId).toBe('12345');
      expect(account.providerUsername).toBe('testuser');
      expect(account.providerAvatarUrl).toBe('https://example.com/avatar.png');
      expect(account.createdAt).toBeTruthy();
      expect(account.updatedAt).toBeTruthy();
    });

    it('should generate unique IDs for each account', async () => {
      const account1 = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '111',
      });
      const account2 = await repo.create({
        userId: 'user-2',
        provider: 'github',
        providerAccountId: '222',
      });

      expect(account1.id).not.toBe(account2.id);
    });

    it('should default optional fields to null when not provided', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
      });

      expect(account.providerUsername).toBeNull();
      expect(account.providerAvatarUrl).toBeNull();
    });
  });

  describe('findByProviderAccount', () => {
    it('should return the matching account', async () => {
      const created = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
        providerUsername: 'testuser',
      });

      const found = await repo.findByProviderAccount('github', '12345');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.userId).toBe('user-1');
      expect(found!.providerUsername).toBe('testuser');
    });

    it('should return null for non-existent provider account', async () => {
      const found = await repo.findByProviderAccount('github', 'nonexistent');
      expect(found).toBeNull();
    });

    it('should distinguish between different provider account IDs', async () => {
      await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '111',
      });
      await repo.create({
        userId: 'user-2',
        provider: 'github',
        providerAccountId: '222',
      });

      const found = await repo.findByProviderAccount('github', '222');
      expect(found).not.toBeNull();
      expect(found!.userId).toBe('user-2');
    });
  });

  describe('findByUserId', () => {
    it('should return all accounts for a user', async () => {
      await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '111',
      });
      // Simulate a second provider account for the same user
      await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '222',
      });
      await repo.create({
        userId: 'user-2',
        provider: 'github',
        providerAccountId: '333',
      });

      const accounts = await repo.findByUserId('user-1');
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.providerAccountId).sort()).toEqual(['111', '222']);
    });

    it('should return empty array when user has no accounts', async () => {
      const accounts = await repo.findByUserId('nobody');
      expect(accounts).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update providerUsername', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
        providerUsername: 'old-name',
      });

      const updated = await repo.update(account.id, {
        providerUsername: 'new-name',
      });

      expect(updated).not.toBeNull();
      expect(updated!.providerUsername).toBe('new-name');
    });

    it('should update providerAvatarUrl', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
      });

      const updated = await repo.update(account.id, {
        providerAvatarUrl: 'https://new-avatar.png',
      });

      expect(updated).not.toBeNull();
      expect(updated!.providerAvatarUrl).toBe('https://new-avatar.png');
    });

    it('should update both providerUsername and providerAvatarUrl at once', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
        providerUsername: 'old-name',
        providerAvatarUrl: 'https://old-avatar.png',
      });

      const updated = await repo.update(account.id, {
        providerUsername: 'new-name',
        providerAvatarUrl: 'https://new-avatar.png',
      });

      expect(updated).not.toBeNull();
      expect(updated!.providerUsername).toBe('new-name');
      expect(updated!.providerAvatarUrl).toBe('https://new-avatar.png');
    });

    it('should update the updatedAt timestamp', async () => {
      const account = await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '12345',
      });
      const originalUpdatedAt = account.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await repo.update(account.id, {
        providerUsername: 'changed',
      });

      expect(updated).not.toBeNull();
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return null for non-existent id', async () => {
      const result = await repo.update('nonexistent', { providerUsername: 'name' });
      expect(result).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all accounts', async () => {
      await repo.create({
        userId: 'user-1',
        provider: 'github',
        providerAccountId: '111',
      });
      await repo.create({
        userId: 'user-2',
        provider: 'github',
        providerAccountId: '222',
      });

      repo.clear();

      const found1 = await repo.findByProviderAccount('github', '111');
      const found2 = await repo.findByProviderAccount('github', '222');
      const byUser = await repo.findByUserId('user-1');

      expect(found1).toBeNull();
      expect(found2).toBeNull();
      expect(byUser).toHaveLength(0);
    });
  });
});

describe('OAuthAccountRepository singleton', () => {
  afterEach(() => {
    _resetOAuthAccountRepository();
  });

  it('should return an instance from getOAuthAccountRepository', () => {
    const inMemory = new InMemoryOAuthAccountRepository();
    setOAuthAccountRepository(inMemory);

    const repo = getOAuthAccountRepository();
    expect(repo).toBe(inMemory);
  });

  it('should allow overriding with setOAuthAccountRepository', () => {
    const custom = new InMemoryOAuthAccountRepository();
    setOAuthAccountRepository(custom);

    expect(getOAuthAccountRepository()).toBe(custom);
  });

  it('should reset to null with _resetOAuthAccountRepository', () => {
    const custom = new InMemoryOAuthAccountRepository();
    setOAuthAccountRepository(custom);

    _resetOAuthAccountRepository();

    // After reset, set a new one and confirm it is different
    const fresh = new InMemoryOAuthAccountRepository();
    setOAuthAccountRepository(fresh);

    expect(getOAuthAccountRepository()).toBe(fresh);
    expect(getOAuthAccountRepository()).not.toBe(custom);
  });
});
