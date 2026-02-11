// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Settings routes.
 *
 * Handles user settings management including AI provider configuration,
 * user profile updates, notification preferences, and knowledge base settings.
 *
 * @module api/routes/settings
 */

import { Hono } from 'hono';
import {
  UpdateAIProviderBodySchema,
  UpdateUserProfileBodySchema,
  UpdateNotificationsBodySchema,
  UpdateKnowledgeBaseBodySchema,
} from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSettingsRepository } from '../../db/repositories/settings-repository.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';

import type {
  UpdateAIProviderBody,
  UpdateUserProfileBody,
  UpdateNotificationsBody,
  UpdateKnowledgeBaseBody,
} from './schemas.js';
import type { ApiEnv } from './types.js';

const settings = new Hono<ApiEnv>();

// All settings routes require authentication
settings.use('*', requireAuth);

// ============================================================================
// GET /settings
// ============================================================================

settings.get('/', async (c) => {
  const userId = c.get('userId');
  const settingsRepo = getSettingsRepository();
  const userRepo = getUserRepository();

  // Get user info
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Get or create settings
  let userSettings = await settingsRepo.findByUserId(userId);
  if (!userSettings) {
    // Create default settings for new user
    userSettings = await settingsRepo.create({ userId });
  }

  // Return combined data
  return c.json({
    aiProvider: userSettings.aiProvider,
    userProfile: {
      name: user.name ?? '',
      email: user.email,
      timezone: user.timezone ?? 'UTC',
    },
    notifications: userSettings.notifications,
    knowledgeBase: userSettings.knowledgeBase,
  });
});

// ============================================================================
// PUT /settings/ai-provider
// ============================================================================

settings.put('/ai-provider', validateBody(UpdateAIProviderBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as UpdateAIProviderBody;
  const settingsRepo = getSettingsRepository();
  const userRepo = getUserRepository();

  // Ensure settings exist
  let userSettings = await settingsRepo.findByUserId(userId);
  if (!userSettings) {
    userSettings = await settingsRepo.create({ userId });
  }

  // Update AI provider settings
  const updated = await settingsRepo.update(userId, {
    aiProvider: body,
  });

  if (!updated) {
    throw ApiError.internal('Failed to update AI provider settings');
  }

  // Get user info
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Return full settings
  return c.json({
    aiProvider: updated.aiProvider,
    userProfile: {
      name: user.name ?? '',
      email: user.email,
      timezone: user.timezone ?? 'UTC',
    },
    notifications: updated.notifications,
    knowledgeBase: updated.knowledgeBase,
  });
});

// ============================================================================
// PUT /settings/profile
// ============================================================================

settings.put('/profile', validateBody(UpdateUserProfileBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as UpdateUserProfileBody;
  const userRepo = getUserRepository();
  const settingsRepo = getSettingsRepository();

  // Update user info
  const user = await userRepo.update(userId, {
    name: body.name,
    timezone: body.timezone,
  });

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Note: Email update would require verification in production
  // For MVP, we'll skip email updates to avoid complexity

  // Get settings
  let userSettings = await settingsRepo.findByUserId(userId);
  if (!userSettings) {
    userSettings = await settingsRepo.create({ userId });
  }

  // Return full settings
  return c.json({
    aiProvider: userSettings.aiProvider,
    userProfile: {
      name: user.name ?? '',
      email: user.email,
      timezone: user.timezone ?? 'UTC',
    },
    notifications: userSettings.notifications,
    knowledgeBase: userSettings.knowledgeBase,
  });
});

// ============================================================================
// PUT /settings/notifications
// ============================================================================

settings.put('/notifications', validateBody(UpdateNotificationsBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as UpdateNotificationsBody;
  const settingsRepo = getSettingsRepository();
  const userRepo = getUserRepository();

  // Ensure settings exist
  let userSettings = await settingsRepo.findByUserId(userId);
  if (!userSettings) {
    userSettings = await settingsRepo.create({ userId });
  }

  // Update notifications
  const updated = await settingsRepo.update(userId, {
    notifications: body,
  });

  if (!updated) {
    throw ApiError.internal('Failed to update notification preferences');
  }

  // Get user info
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Return full settings
  return c.json({
    aiProvider: updated.aiProvider,
    userProfile: {
      name: user.name ?? '',
      email: user.email,
      timezone: user.timezone ?? 'UTC',
    },
    notifications: updated.notifications,
    knowledgeBase: updated.knowledgeBase,
  });
});

// ============================================================================
// PUT /settings/knowledge-base
// ============================================================================

settings.put('/knowledge-base', validateBody(UpdateKnowledgeBaseBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as UpdateKnowledgeBaseBody;
  const settingsRepo = getSettingsRepository();
  const userRepo = getUserRepository();

  // Ensure settings exist
  let userSettings = await settingsRepo.findByUserId(userId);
  if (!userSettings) {
    userSettings = await settingsRepo.create({ userId });
  }

  // Update knowledge base settings
  const updated = await settingsRepo.update(userId, {
    knowledgeBase: body,
  });

  if (!updated) {
    throw ApiError.internal('Failed to update knowledge base settings');
  }

  // Get user info
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Return full settings
  return c.json({
    aiProvider: updated.aiProvider,
    userProfile: {
      name: user.name ?? '',
      email: user.email,
      timezone: user.timezone ?? 'UTC',
    },
    notifications: updated.notifications,
    knowledgeBase: updated.knowledgeBase,
  });
});

export { settings };
