// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Chat session CRUD routes — list, get, rename, delete sessions.
 *
 * Separated from chat.ts to keep file sizes under the 500-line limit.
 * Mounts under the same `/chat` prefix via the route index.
 *
 * @module api/routes/chat-sessions
 */

import { Hono } from "hono";
import { CE_LIMITS } from "@aiinstaller/shared";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { ApiError } from "../middleware/error-handler.js";
import { FEATURES } from "../../config/edition.js";
import { getSessionManager } from "../../core/session/manager.js";
import { getServerRepository } from "../../db/repositories/server-repository.js";
import { logger } from "../../utils/logger.js";
import { hasActiveSessionWork } from "./chat-confirmations.js";
import { RenameSessionBodySchema } from "./schemas.js";
import type { RenameSessionBody } from "./schemas.js";
import type { ApiEnv } from "./types.js";

const chatSessions = new Hono<ApiEnv>();

// All session routes require authentication
chatSessions.use("*", requireAuth, resolveRole);

// GET /chat/:serverId/sessions — List chat sessions (paginated)
chatSessions.get(
  "/:serverId/sessions",
  requirePermission("chat:use"),
  async (c) => {
    const { serverId } = c.req.param();
    const userId = c.get("userId");

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset");

    // CE mode: only return the single active session
    const ceLimit = FEATURES.multiSession ? undefined : CE_LIMITS.maxSessions;

    const limit =
      ceLimit ??
      (limitRaw
        ? Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 100))
        : 100);
    const offset = ceLimit
      ? 0
      : offsetRaw
        ? Math.max(0, parseInt(offsetRaw, 10) || 0)
        : 0;

    const result = await getSessionManager().listSessions(serverId, userId, {
      limit,
      offset,
    });
    return c.json({ sessions: result.sessions, total: result.total });
  },
);

// GET /chat/:serverId/sessions/:sessionId — Get session details
chatSessions.get(
  "/:serverId/sessions/:sessionId",
  requirePermission("chat:use"),
  async (c) => {
    const { serverId, sessionId } = c.req.param();
    const userId = c.get("userId");

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    const session = await getSessionManager().getSession(sessionId, userId);
    if (!session || session.serverId !== serverId) {
      throw ApiError.notFound("Session");
    }

    return c.json({
      session: {
        id: session.id,
        messages: session.messages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  },
);

// PATCH /chat/:serverId/sessions/:sessionId — Rename session
chatSessions.patch(
  "/:serverId/sessions/:sessionId",
  requirePermission("chat:use"),
  validateBody(RenameSessionBodySchema),
  async (c) => {
    const { serverId, sessionId } = c.req.param();
    const userId = c.get("userId");
    const { name } = c.get("validatedBody") as RenameSessionBody;

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    const updated = await getSessionManager().renameSession(
      sessionId,
      serverId,
      userId,
      name,
    );
    if (!updated) {
      throw ApiError.notFound("Session");
    }

    logger.info(
      { operation: "session_rename", serverId, sessionId, userId },
      "Chat session renamed",
    );

    return c.json({ success: true });
  },
);

// DELETE /chat/:serverId/sessions/:sessionId — Delete session
chatSessions.delete(
  "/:serverId/sessions/:sessionId",
  requirePermission("chat:use"),
  async (c) => {
    const { serverId, sessionId } = c.req.param();
    const userId = c.get("userId");

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    // Prevent deleting a session with active plan executions or pending confirmations
    if (hasActiveSessionWork(sessionId)) {
      return c.json(
        {
          error: "Session has active executions — cancel them before deleting",
        },
        409,
      );
    }

    // CE mode: prevent deleting the only session
    if (!FEATURES.multiSession) {
      const existing = await getSessionManager().listSessions(
        serverId,
        userId,
        { limit: 2, offset: 0 },
      );
      if (existing.total <= 1) {
        return c.json(
          { error: "Cannot delete the only session in Community Edition" },
          403,
        );
      }
    }

    const deleted = await getSessionManager().deleteSession(
      sessionId,
      serverId,
      userId,
    );
    if (!deleted) {
      throw ApiError.notFound("Session");
    }

    logger.info(
      { operation: "session_delete", serverId, sessionId, userId },
      "Chat session deleted",
    );

    return c.json({ success: true });
  },
);

export { chatSessions };
