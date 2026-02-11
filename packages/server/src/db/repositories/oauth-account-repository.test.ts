// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OAuth account repository (in-memory implementation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryOAuthAccountRepository } from './oauth-account-repository.js';

let repo: InMemoryOAuthAccountRepository;

beforeEach(() => {
  repo = new InMemoryOAuthAccountRepository();
});

describe('InMemoryOAuthAccountRepository', () => {
  it('should create and find by provider account', async () => {
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

    const found = await repo.findByProviderAccount('github', '12345');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(account.id);
  });

  it('should return null for non-existent provider account', async () => {
    const found = await repo.findByProviderAccount('github', 'nonexistent');
    expect(found).toBeNull();
  });

  it('should find all accounts by user ID', async () => {
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

    const accounts = await repo.findByUserId('user-1');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerAccountId).toBe('111');
  });

  it('should return empty array when user has no accounts', async () => {
    const accounts = await repo.findByUserId('nobody');
    expect(accounts).toHaveLength(0);
  });

  it('should update provider username and avatar', async () => {
    const account = await repo.create({
      userId: 'user-1',
      provider: 'github',
      providerAccountId: '12345',
      providerUsername: 'old-name',
    });

    const updated = await repo.update(account.id, {
      providerUsername: 'new-name',
      providerAvatarUrl: 'https://new-avatar.png',
    });

    expect(updated).not.toBeNull();
    expect(updated!.providerUsername).toBe('new-name');
    expect(updated!.providerAvatarUrl).toBe('https://new-avatar.png');
  });

  it('should return null when updating non-existent account', async () => {
    const result = await repo.update('nonexistent', { providerUsername: 'name' });
    expect(result).toBeNull();
  });

  it('should default optional fields to null', async () => {
    const account = await repo.create({
      userId: 'user-1',
      provider: 'github',
      providerAccountId: '12345',
    });

    expect(account.providerUsername).toBeNull();
    expect(account.providerAvatarUrl).toBeNull();
  });

  it('should clear all accounts', async () => {
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

    const found = await repo.findByProviderAccount('github', '111');
    expect(found).toBeNull();
  });
});
