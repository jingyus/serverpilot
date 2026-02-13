// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Chat session export route — download conversation history as JSON or Markdown.
 *
 * Separated from chat.ts to keep file sizes under the 800-line limit.
 * Mounts under the same `/chat` prefix via the route index.
 *
 * @module api/routes/chat-export
 */

import { Hono } from 'hono';
import { ExportSessionQuerySchema } from './schemas.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSessionManager } from '../../core/session/manager.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import type { ApiEnv } from './types.js';
import type { ConversationExport, ExportMessage } from '@aiinstaller/shared';

// ============================================================================
// Helpers
// ============================================================================

/** Render messages as Markdown text for export download. */
export function buildExportMarkdown(
  title: string,
  serverName: string,
  exportedAt: string,
  messages: ExportMessage[],
): string {
  const lines = [
    `# ${title}`,
    `**Server:** ${serverName}`,
    `**Exported:** ${exportedAt}`,
    '',
    '---',
    '',
  ];
  for (const msg of messages) {
    const label = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`### ${label} (${msg.timestamp})`, '');
    if (msg.role === 'user') {
      lines.push(msg.content.split('\n').map((l) => `> ${l}`).join('\n'));
    } else if (msg.role === 'system') {
      lines.push(`*${msg.content}*`);
    } else {
      lines.push(msg.content);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Build a safe filename from session name and date. */
export function buildExportFilename(
  format: 'json' | 'markdown',
  sessionName: string | null | undefined,
  date: string,
): string {
  const safeName = sessionName
    ? sessionName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50)
    : 'chat';
  const ext = format === 'markdown' ? 'md' : 'json';
  return `${safeName}-${date}.${ext}`;
}

// ============================================================================
// Route
// ============================================================================

const chatExport = new Hono<ApiEnv>();

chatExport.use('*', requireAuth, resolveRole);

// GET /chat/:serverId/sessions/:sessionId/export?format=json|markdown
chatExport.get(
  '/:serverId/sessions/:sessionId/export',
  requirePermission('chat:use'),
  async (c) => {
    const { serverId, sessionId } = c.req.param();
    const userId = c.get('userId');
    const query = ExportSessionQuerySchema.parse(c.req.query());

    const server = await getServerRepository().findById(serverId, userId);
    if (!server) throw ApiError.notFound('Server');

    const session = await getSessionManager().getSession(sessionId, userId);
    if (!session || session.serverId !== serverId) throw ApiError.notFound('Session');

    const messages: ExportMessage[] = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }));

    const exportedAt = new Date().toISOString();
    const title = session.name ?? 'Chat Session';
    const exportData: ConversationExport = {
      id: session.id,
      title,
      serverId,
      createdAt: session.createdAt,
      exportedAt,
      format: query.format,
      messages,
    };

    const date = exportedAt.slice(0, 10);
    const filename = buildExportFilename(query.format, session.name, date);
    const contentType = query.format === 'markdown'
      ? 'text/markdown; charset=utf-8'
      : 'application/json; charset=utf-8';

    c.header('Content-Type', contentType);
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Cache-Control', 'no-cache');

    if (query.format === 'markdown') {
      return c.body(buildExportMarkdown(title, server.name, exportedAt, messages));
    }

    return c.body(JSON.stringify(exportData));
  },
);

export { chatExport };
