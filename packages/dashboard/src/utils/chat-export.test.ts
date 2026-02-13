// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  messagesToMarkdown,
  messagesToJson,
  buildExportFilename,
  exportChat,
  downloadFile,
} from './chat-export';
import type { ChatMessage } from '@/types/chat';

const sampleMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'user',
    content: 'Install nginx on the server',
    timestamp: '2026-02-13T10:00:00Z',
  },
  {
    id: '2',
    role: 'assistant',
    content: 'I will install nginx using `apt install nginx`.\n\n```bash\nsudo apt install nginx\n```',
    timestamp: '2026-02-13T10:00:05Z',
  },
  {
    id: '3',
    role: 'system',
    content: 'Execution completed successfully',
    timestamp: '2026-02-13T10:00:30Z',
  },
];

describe('messagesToMarkdown', () => {
  it('generates markdown with header and all message roles', () => {
    const md = messagesToMarkdown(sampleMessages, 'Test Session', 'prod-01');

    expect(md).toContain('# Test Session');
    expect(md).toContain('**Server:** prod-01');
    expect(md).toContain('**Exported:**');
    expect(md).toContain('---');

    // User message as blockquote
    expect(md).toContain('### User');
    expect(md).toContain('> Install nginx on the server');

    // Assistant message as normal text
    expect(md).toContain('### Assistant');
    expect(md).toContain('I will install nginx');
    expect(md).toContain('```bash');

    // System message as italic
    expect(md).toContain('### System');
    expect(md).toContain('*Execution completed successfully*');
  });

  it('uses default title when sessionName is undefined', () => {
    const md = messagesToMarkdown(sampleMessages);
    expect(md).toContain('# Chat Export');
    expect(md).not.toContain('**Server:**');
  });

  it('handles multiline user messages with blockquotes', () => {
    const msgs: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'line one\nline two\nline three',
        timestamp: '2026-02-13T10:00:00Z',
      },
    ];
    const md = messagesToMarkdown(msgs);
    expect(md).toContain('> line one\n> line two\n> line three');
  });
});

describe('messagesToJson', () => {
  it('produces valid JSON with metadata and messages', () => {
    const jsonStr = messagesToJson(sampleMessages, 'My Session', 'server-01');
    const parsed = JSON.parse(jsonStr);

    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.sessionName).toBe('My Session');
    expect(parsed.serverName).toBe('server-01');
    expect(parsed.messageCount).toBe(3);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0]).toEqual({
      id: '1',
      role: 'user',
      content: 'Install nginx on the server',
      timestamp: '2026-02-13T10:00:00Z',
    });
  });

  it('sets null for missing sessionName and serverName', () => {
    const jsonStr = messagesToJson(sampleMessages);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.sessionName).toBeNull();
    expect(parsed.serverName).toBeNull();
  });

  it('excludes plan field from exported messages', () => {
    const msgs: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Here is the plan',
        timestamp: '2026-02-13T10:00:00Z',
        plan: {
          planId: 'p1',
          description: 'Install nginx',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: false,
        },
      },
    ];
    const jsonStr = messagesToJson(msgs);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.messages[0]).not.toHaveProperty('plan');
  });
});

describe('buildExportFilename', () => {
  it('builds markdown filename with session name', () => {
    const name = buildExportFilename('markdown', 'My Session');
    expect(name).toMatch(/^My_Session-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('builds json filename with default name', () => {
    const name = buildExportFilename('json');
    expect(name).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('sanitizes special characters in session name', () => {
    const name = buildExportFilename('markdown', 'Install / Configure & Deploy!');
    expect(name).not.toContain('/');
    expect(name).not.toContain('&');
    expect(name).not.toContain('!');
  });

  it('truncates long session names', () => {
    const longName = 'a'.repeat(100);
    const name = buildExportFilename('json', longName);
    // 50 chars max for name + date + extension
    expect(name.length).toBeLessThan(70);
  });
});

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;

    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement);
  });

  it('creates blob, triggers download, and cleans up', () => {
    downloadFile('test content', 'test.md', 'text/markdown');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});

describe('exportChat', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:test');
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = vi.fn();

    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement);
  });

  it('does nothing when messages array is empty', () => {
    exportChat({ messages: [], format: 'markdown' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('exports markdown format', () => {
    exportChat({ messages: sampleMessages, format: 'markdown', sessionName: 'Test' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');
  });

  it('exports json format', () => {
    exportChat({ messages: sampleMessages, format: 'json' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
  });
});
