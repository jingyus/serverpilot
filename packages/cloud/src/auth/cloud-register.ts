// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Cloud 用户注册 — 注册时自动创建独立 Tenant，用户为该 Tenant 的 owner。
 *
 * 与 Self-Hosted 区别：Cloud 下每个用户一个 Tenant，Free 计划，maxServers:1, maxUsers:1。
 *
 * @module cloud/auth/cloud-register
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getPgDatabase } from '../db/pg-connection.js';
import { tenants, users } from '../db/pg-schema.js';
import { hashPassword } from '../utils/password.js';
import { generateTokens } from './tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudRegisterInput {
  email: string;
  password: string;
  name?: string;
  companyName?: string;
}

export interface CloudRegisterResult {
  user: { id: string; email: string; name: string | null; tenantId: string; role: string };
  tenant: { id: string; name: string; slug: string; plan: string; maxServers: number; maxUsers: number };
  tokens: { accessToken: string; refreshToken: string };
}

export class CloudRegisterError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMAIL_ALREADY_REGISTERED' | 'INVALID_INPUT',
  ) {
    super(message);
    this.name = 'CloudRegisterError';
  }
}

// ---------------------------------------------------------------------------
// 欢迎邮件（占位：打日志，后续可接 SMTP/SendGrid）
// ---------------------------------------------------------------------------

function sendWelcomeEmail(email: string, tenantName: string, slug: string): Promise<void> {
  const dashboardUrl = process.env.DASHBOARD_BASE_URL
    ? `${process.env.DASHBOARD_BASE_URL}`
    : 'https://app.serverpilot.io';
  console.info(
    '[cloud-register] Welcome email (stub)',
    { email, tenantName, slug, dashboardUrl },
  );
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Slug 生成：小写、去特殊字符、唯一性（冲突追加数字）
// ---------------------------------------------------------------------------

/**
 * 生成 URL 安全的 tenant slug（小写字母、数字、短横线）。
 * 若已存在则追加数字直到唯一。
 */
export async function generateSlug(baseName: string): Promise<string> {
  const raw = baseName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'tenant';

  const db = getPgDatabase();
  let slug = raw;
  let n = 0;
  for (;;) {
    const existing = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (existing.length === 0) return slug;
    n += 1;
    slug = `${raw}-${n}`;
  }
}

// ---------------------------------------------------------------------------
// 注册主流程
// ---------------------------------------------------------------------------

/**
 * Cloud 用户注册：创建 Tenant + User（owner），返回 user、tenant、tokens。
 *
 * - 邮箱唯一性校验
 * - Tenant slug 唯一
 * - JWT 与 server 兼容（sub = userId），tenantId 由 server 从 user.tenantId 解析
 */
export async function cloudRegister(data: CloudRegisterInput): Promise<CloudRegisterResult> {
  const email = data.email?.trim();
  const password = data.password;

  if (!email || !password) {
    throw new CloudRegisterError('Email and password are required', 'INVALID_INPUT');
  }
  if (password.length < 8) {
    throw new CloudRegisterError('Password must be at least 8 characters', 'INVALID_INPUT');
  }

  const db = getPgDatabase();

  // 1. 邮箱唯一性
  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length > 0) {
    throw new CloudRegisterError('Email already registered', 'EMAIL_ALREADY_REGISTERED');
  }

  // 2. Tenant 名称与 slug
  const tenantName =
    data.companyName?.trim() || data.name?.trim() || email.replace(/@.*/, '') || 'My Team';
  const slug = await generateSlug(tenantName);

  const userId = randomUUID();
  const tenantId = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(password);
  const name = data.name?.trim() || null;

  // 3. 先创建 tenant（ownerId 指向即将创建的 user）
  await db.insert(tenants).values({
    id: tenantId,
    name: tenantName,
    slug,
    ownerId: userId,
    plan: 'free',
    maxServers: 1,
    maxUsers: 1,
    createdAt: now,
    updatedAt: now,
  });

  // 4. 创建 user（tenantId, role: owner）
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    name,
    timezone: 'UTC',
    tenantId,
    role: 'owner',
    createdAt: now,
    updatedAt: now,
  });

  // 5. 生成 JWT（与 server 格式一致）
  const tokens = await generateTokens(userId);

  // 6. 欢迎邮件（当前打日志，后续可接 SMTP）
  sendWelcomeEmail(email, tenantName, slug).catch(() => {});

  return {
    user: {
      id: userId,
      email,
      name,
      tenantId,
      role: 'owner',
    },
    tenant: {
      id: tenantId,
      name: tenantName,
      slug,
      plan: 'free',
      maxServers: 1,
      maxUsers: 1,
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
  };
}
