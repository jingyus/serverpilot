// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cloudRegister,
  generateSlug,
  CloudRegisterError,
} from './cloud-register.js';
import { tenants, users } from '../db/pg-schema.js';

// Capture right-hand side of eq() so mock can filter (drizzle eq shape varies by env)
let lastEqRight: string | undefined;
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('drizzle-orm');
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => {
      lastEqRight = typeof right === 'string' ? right : undefined;
      return actual.eq(left, right);
    },
  };
});

// ---------------------------------------------------------------------------
// In-memory store for mock DB
// ---------------------------------------------------------------------------

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: string;
  maxServers: number;
  maxUsers: number;
  createdAt: Date;
  updatedAt: Date;
};
type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  timezone: string | null;
  tenantId: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

const tenantsStore: TenantRow[] = [];
const usersStore: UserRow[] = [];

function createMockDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number) => {
            const val = lastEqRight;
            const out =
              table === users
                ? usersStore.filter((r) => r.email === val)
                : table === tenants
                  ? tenantsStore.filter((r) => r.slug === val)
                  : [];
            return Promise.resolve(out);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === tenants) {
          tenantsStore.push(row as TenantRow);
        } else if (table === users) {
          usersStore.push(row as UserRow);
        }
        return Promise.resolve();
      },
    }),
  };
}

vi.mock('../db/pg-connection.js', () => ({
  getPgDatabase: vi.fn(() => createMockDb()),
}));

// Mock JWT_SECRET so generateTokens works
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!';
  lastEqRight = undefined;
  tenantsStore.length = 0;
  usersStore.length = 0;
});

describe('cloudRegister', () => {
  it('正常注册：创建 user + tenant，返回 JWT', async () => {
    const result = await cloudRegister({
      email: 'alice@example.com',
      password: 'password123',
      name: 'Alice',
    });

    expect(result.user.email).toBe('alice@example.com');
    expect(result.user.name).toBe('Alice');
    expect(result.user.tenantId).toBeTruthy();
    expect(result.user.role).toBe('owner');
    expect(result.tenant.plan).toBe('free');
    expect(result.tenant.maxServers).toBe(1);
    expect(result.tenant.maxUsers).toBe(1);
    expect(result.tenant.slug).toBeTruthy();
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(tenantsStore).toHaveLength(1);
    expect(usersStore).toHaveLength(1);
    expect(usersStore[0]!.tenantId).toBe(result.tenant.id);
    expect(tenantsStore[0]!.ownerId).toBe(result.user.id);
  });

  it('重复邮箱返回 EMAIL_ALREADY_REGISTERED', async () => {
    await cloudRegister({
      email: 'dup@example.com',
      password: 'password123',
    });
    await expect(
      cloudRegister({ email: 'dup@example.com', password: 'other456789' }),
    ).rejects.toThrow(CloudRegisterError);
    const err = await cloudRegister({
      email: 'dup@example.com',
      password: 'validpass8',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudRegisterError);
    expect((err as CloudRegisterError).code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('companyName 作为 tenant name', async () => {
    const result = await cloudRegister({
      email: 'bob@company.com',
      password: 'password123',
      name: 'Bob',
      companyName: 'Acme Inc',
    });
    expect(result.tenant.name).toBe('Acme Inc');
    expect(result.user.name).toBe('Bob');
  });

  it('无 companyName 时用 email 前缀作为 tenant name', async () => {
    const result = await cloudRegister({
      email: 'carol@example.com',
      password: 'password123',
    });
    expect(result.tenant.name).toBe('carol');
  });

  it('slug 唯一：重名追加数字', async () => {
    const r1 = await cloudRegister({
      email: 'first-slug@team.com',
      password: 'pass1234',
      companyName: 'Team',
    });
    expect(r1.tenant.slug).toBe('team');
    const r2 = await cloudRegister({
      email: 'second-slug@team.com',
      password: 'pass1234',
      companyName: 'Team',
    });
    expect(r2.tenant.slug).toBe('team-1');
    expect(r1.tenant.slug).not.toBe(r2.tenant.slug);
  });

  it('缺少 email 或 password 抛 INVALID_INPUT', async () => {
    await expect(cloudRegister({ email: '', password: 'x' } as never)).rejects.toThrow(
      CloudRegisterError,
    );
    await expect(cloudRegister({ email: 'a@b.com', password: '' } as never)).rejects.toThrow(
      CloudRegisterError,
    );
    const err = await cloudRegister({
      email: 'a@b.com',
      password: 'short',
    }).catch((e) => e);
    expect(err.code).toBe('INVALID_INPUT');
  });

  it('password 至少 8 位', async () => {
    await expect(
      cloudRegister({ email: 'u@x.com', password: '1234567' }),
    ).rejects.toThrow(CloudRegisterError);
  });

  it('返回的 user.id 和 tenant.id 为 UUID', async () => {
    const result = await cloudRegister({
      email: 'uuid@test.com',
      password: 'password123',
    });
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(result.user.id).toMatch(uuidRe);
    expect(result.tenant.id).toMatch(uuidRe);
  });
});

describe('generateSlug', () => {
  it('转小写、去特殊字符', async () => {
    const slug = await generateSlug('My Company & Co.');
    expect(slug).toBe('my-company-co');
  });

  it('空名回退为 tenant', async () => {
    const slug = await generateSlug('  ---  ');
    expect(slug).toBe('tenant');
  });
});
