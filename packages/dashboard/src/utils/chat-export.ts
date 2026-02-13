// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

import type { ChatMessage } from '@/types/chat';

export type ExportFormat = 'markdown' | 'json';

interface ExportOptions {
  messages: ChatMessage[];
  sessionName?: string;
  serverName?: string;
  format: ExportFormat;
}

/**
 * Convert messages to Markdown format.
 * - User messages rendered as blockquotes
 * - Assistant messages as normal text
 * - System messages as italic text
 * - Commands in code blocks
 */
export function messagesToMarkdown(
  messages: ChatMessage[],
  sessionName?: string,
  serverName?: string,
): string {
  const lines: string[] = [];

  // Header
  const title = sessionName || 'Chat Export';
  lines.push(`# ${title}`);
  if (serverName) {
    lines.push(`**Server:** ${serverName}`);
  }
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const time = formatTimestamp(msg.timestamp);

    if (msg.role === 'user') {
      lines.push(`### User (${time})`);
      lines.push('');
      // Blockquote user messages line by line
      const quoted = msg.content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      lines.push(quoted);
    } else if (msg.role === 'assistant') {
      lines.push(`### Assistant (${time})`);
      lines.push('');
      lines.push(msg.content);
    } else {
      lines.push(`### System (${time})`);
      lines.push('');
      lines.push(`*${msg.content}*`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert messages to a structured JSON export.
 */
export function messagesToJson(
  messages: ChatMessage[],
  sessionName?: string,
  serverName?: string,
): string {
  const exportData = {
    exportedAt: new Date().toISOString(),
    sessionName: sessionName || null,
    serverName: serverName || null,
    messageCount: messages.length,
    messages: messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Build a safe filename from session name and date.
 */
export function buildExportFilename(
  format: ExportFormat,
  sessionName?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeName = sessionName
    ? sessionName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50)
    : 'chat';
  const ext = format === 'markdown' ? 'md' : 'json';
  return `${safeName}-${date}.${ext}`;
}

/**
 * Trigger a browser file download with the given content.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export chat messages in the specified format and trigger download.
 */
export function exportChat({ messages, sessionName, serverName, format }: ExportOptions): void {
  if (messages.length === 0) return;

  const content =
    format === 'markdown'
      ? messagesToMarkdown(messages, sessionName, serverName)
      : messagesToJson(messages, sessionName, serverName);

  const filename = buildExportFilename(format, sessionName);
  const mimeType = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8';

  downloadFile(content, filename, mimeType);
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
