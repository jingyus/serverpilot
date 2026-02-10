/**
 * Tests for default admin account seeding.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { initDatabase, closeDatabase, createTables } from './connection.js';
import { seedDefaultAdmin } from './seed-admin.js';
import { getUserRepository, _resetUserRepository } from './repositories/user-repository.js';
import { verifyPassword } from '../utils/password.js';

describe('seedDefaultAdmin', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    createTables();
    _resetUserRepository();
  });

  afterEach(() => {
    _resetUserRepository();
    closeDatabase();
    vi.unstubAllEnvs();
  });

  it('should create admin user when users table is empty', async () => {
    await seedDefaultAdmin();

    const repo = getUserRepository();
    const admin = await repo.findByEmail('admin@serverpilot.local');

    expect(admin).not.toBeNull();
    expect(admin!.name).toBe('Admin');
    expect(admin!.email).toBe('admin@serverpilot.local');
  });

  it('should use env ADMIN_EMAIL and ADMIN_PASSWORD when set', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'test@example.com');
    vi.stubEnv('ADMIN_PASSWORD', 'mypassword123');

    await seedDefaultAdmin();

    const repo = getUserRepository();
    const admin = await repo.findByEmail('test@example.com');

    expect(admin).not.toBeNull();
    expect(admin!.email).toBe('test@example.com');

    const passwordValid = await verifyPassword('mypassword123', admin!.passwordHash);
    expect(passwordValid).toBe(true);
  });

  it('should auto-generate password when ADMIN_PASSWORD is not set', async () => {
    vi.stubEnv('ADMIN_EMAIL', '');
    vi.stubEnv('ADMIN_PASSWORD', '');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await seedDefaultAdmin();

    const repo = getUserRepository();
    const admin = await repo.findByEmail('admin@serverpilot.local');
    expect(admin).not.toBeNull();

    // Should print credentials to console
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('DEFAULT ADMIN ACCOUNT CREATED');
    expect(output).toContain('admin@serverpilot.local');

    consoleSpy.mockRestore();
  });

  it('should skip seeding when users already exist', async () => {
    // Create a user first
    const repo = getUserRepository();
    await repo.create({
      email: 'existing@example.com',
      passwordHash: 'scrypt:16384:8:1:salt:hash',
      name: 'Existing',
    });

    await seedDefaultAdmin();

    // Should not create admin user
    const admin = await repo.findByEmail('admin@serverpilot.local');
    expect(admin).toBeNull();
  });

  it('should hash the password securely', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'securepass99');

    await seedDefaultAdmin();

    const repo = getUserRepository();
    const admin = await repo.findByEmail('admin@serverpilot.local');
    expect(admin).not.toBeNull();

    // Password should be stored as scrypt hash
    expect(admin!.passwordHash).toMatch(/^scrypt:\d+:\d+:\d+:[a-f0-9]+:[a-f0-9]+$/);

    // Should verify correctly
    const valid = await verifyPassword('securepass99', admin!.passwordHash);
    expect(valid).toBe(true);

    // Wrong password should fail
    const invalid = await verifyPassword('wrongpassword', admin!.passwordHash);
    expect(invalid).toBe(false);
  });
});
