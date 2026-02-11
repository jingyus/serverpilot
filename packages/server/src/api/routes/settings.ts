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
import {
  getActiveProvider,
  setActiveProvider,
  checkProviderHealth,
} from '../../ai/providers/provider-factory.js';
import type { AIProviderType } from '../../ai/providers/provider-factory.js';
import { refreshChatAIAgent } from './chat-ai.js';
import { logger } from '../../utils/logger.js';

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

  // Try to switch the active provider (validates config)
  try {
    setActiveProvider({
      provider: body.provider as AIProviderType,
      apiKey: body.apiKey,
      model: body.model,
      baseUrl: body.baseUrl,
    });

    // Reset the chat agent so it picks up the new provider
    refreshChatAIAgent();

    logger.info(
      { operation: 'settings_ai_switch', provider: body.provider, userId },
      `AI provider switched to ${body.provider}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw ApiError.badRequest(`Failed to initialize provider "${body.provider}": ${msg}`);
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

// ============================================================================
// GET /settings/ai-provider/health — Check current AI provider availability
// ============================================================================

settings.get('/ai-provider/health', async (c) => {
  const provider = getActiveProvider();
  if (!provider) {
    return c.json({
      provider: null,
      available: false,
      error: 'No AI provider configured',
    });
  }

  const health = await checkProviderHealth(provider);
  return c.json(health);
});

export { settings };
