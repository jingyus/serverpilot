// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic system prompt builders.
 *
 * Validates prompt content structure, tool guidance, scenario examples,
 * error recovery strategies, and full system prompt composition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FullServerProfile } from '../core/profile/manager.js';
import { buildAgenticSystemPrompt, buildFullSystemPrompt } from './agentic-prompts.js';

// Mock dependencies for buildFullSystemPrompt
vi.mock('./profile-context.js', () => ({
  buildProfileContext: vi.fn(() => ({ text: '## Server Profile\nUbuntu 22.04', tokenCount: 10 })),
  buildProfileCaveats: vi.fn(() => ['Disk usage above 80%']),
}));

vi.mock('../knowledge/rag-pipeline.js', () => ({
  getRagPipeline: vi.fn(() => null),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ============================================================================
// buildAgenticSystemPrompt — content structure
// ============================================================================

describe('buildAgenticSystemPrompt', () => {
  let prompt: string;

  beforeEach(() => {
    prompt = buildAgenticSystemPrompt();
  });

  it('returns a non-empty string', () => {
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('contains the agent identity', () => {
    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('autonomous AI DevOps agent');
  });

  // ---- Tool Guidance ----

  it('describes all three tools (execute_command, read_file, list_files)', () => {
    expect(prompt).toContain('### execute_command');
    expect(prompt).toContain('### read_file');
    expect(prompt).toContain('### list_files');
  });

  it('contains tool selection decision tree', () => {
    expect(prompt).toContain('Tool Selection Decision Tree');
    expect(prompt).toContain('read_file first');
  });

  it('advises preferring read_file over cat for reading configs', () => {
    expect(prompt).toContain('prefer read_file over execute_command');
  });

  // ---- Scenario Examples (at least 3) ----

  it('contains at least 4 scenario examples', () => {
    const exampleMatches = prompt.match(/### Example \d+:/g);
    expect(exampleMatches).not.toBeNull();
    expect(exampleMatches!.length).toBeGreaterThanOrEqual(4);
  });

  it('includes Nginx installation scenario', () => {
    expect(prompt).toContain('Install and configure Nginx');
    expect(prompt).toContain('nginx -t');
  });

  it('includes service debugging scenario', () => {
    expect(prompt).toContain('Debug a failing service');
    expect(prompt).toContain('journalctl');
  });

  it('includes disk space investigation scenario', () => {
    expect(prompt).toContain('disk space');
    expect(prompt).toContain('df -h');
  });

  it('includes firewall configuration scenario', () => {
    expect(prompt).toContain('firewall');
    expect(prompt).toContain('ufw');
  });

  // ---- Error Recovery ----

  it('contains error recovery strategy section', () => {
    expect(prompt).toContain('Error Recovery Strategy');
  });

  it('covers common error causes (permission, package not found, port in use)', () => {
    expect(prompt).toContain('Permission denied');
    expect(prompt).toContain('Package not found');
    expect(prompt).toContain('Port already in use');
  });

  it('advises trying different approach after repeated failures', () => {
    expect(prompt).toContain('fails twice');
    expect(prompt).toContain('fundamentally different method');
  });

  // ---- Multi-Step Strategy ----

  it('contains multi-step task breakdown strategy', () => {
    expect(prompt).toContain('Multi-Step Task Strategy');
    expect(prompt).toContain('Investigate');
    expect(prompt).toContain('Verify');
  });

  // ---- Verification Patterns ----

  it('contains verification patterns section', () => {
    expect(prompt).toContain('Verification Patterns');
    expect(prompt).toContain('--version');
    expect(prompt).toContain('systemctl is-active');
  });

  // ---- Security & Communication ----

  it('instructs Chinese for user-facing text', () => {
    expect(prompt).toContain('Chinese');
  });

  it('contains security guidelines', () => {
    expect(prompt).toContain('Security');
    expect(prompt).toContain('NEVER');
    expect(prompt).toContain('bypass security restrictions');
  });

  // ---- Size constraints ----

  it('prompt content is between 80 and 200 lines', () => {
    const lines = prompt.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(80);
    expect(lines).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// buildFullSystemPrompt — composition
// ============================================================================

describe('buildFullSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns base prompt when no profile or RAG available', async () => {
    const result = await buildFullSystemPrompt('hello');
    expect(result).toContain('ServerPilot');
    expect(result).toContain('Tool Selection Decision Tree');
    expect(result).not.toContain('Server Profile');
  });

  it('includes profile context when serverProfile is provided', async () => {
    const fakeProfile = { osInfo: { platform: 'Ubuntu' } } as unknown as FullServerProfile;
    const result = await buildFullSystemPrompt('hello', fakeProfile, 'web-01');
    expect(result).toContain('Server Profile');
    expect(result).toContain('Ubuntu 22.04');
  });

  it('includes caveats when profile generates them', async () => {
    const fakeProfile = { osInfo: { platform: 'Ubuntu' } };
    const result = await buildFullSystemPrompt('hello', fakeProfile);
    expect(result).toContain('Important Caveats');
    expect(result).toContain('Disk usage above 80%');
  });

  it('includes RAG knowledge when pipeline is ready', async () => {
    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue({
      isReady: () => true,
      search: vi.fn().mockResolvedValue({
        hasResults: true,
        contextText: '## Knowledge Base\nNginx reverse proxy docs',
      }),
    } as never);

    const result = await buildFullSystemPrompt('how to configure nginx');
    expect(result).toContain('Knowledge Base');
    expect(result).toContain('Nginx reverse proxy docs');
  });

  it('gracefully degrades when RAG search throws', async () => {
    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue({
      isReady: () => true,
      search: vi.fn().mockRejectedValue(new Error('embedding failed')),
    } as never);

    const result = await buildFullSystemPrompt('test query');
    // Should still return the base prompt without throwing
    expect(result).toContain('ServerPilot');
    expect(result).not.toContain('Knowledge Base');
  });

  it('skips RAG when pipeline is null', async () => {
    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue(null as never);

    const result = await buildFullSystemPrompt('test query');
    expect(result).toContain('ServerPilot');
  });

  it('skips RAG when pipeline is not ready', async () => {
    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue({
      isReady: () => false,
    } as never);

    const result = await buildFullSystemPrompt('test query');
    expect(result).toContain('ServerPilot');
  });

  it('excludes knowledge context when RAG search returns no results', async () => {
    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue({
      isReady: () => true,
      search: vi.fn().mockResolvedValue({
        hasResults: false,
        contextText: '',
      }),
    } as never);

    const result = await buildFullSystemPrompt('obscure query');
    expect(result).toContain('ServerPilot');
    expect(result).not.toContain('Knowledge');
  });

  it('omits caveats section when profile produces empty caveats array', async () => {
    const { buildProfileCaveats } = await import('./profile-context.js');
    vi.mocked(buildProfileCaveats).mockReturnValue([]);

    const fakeProfile = { osInfo: { platform: 'Ubuntu' } };
    const result = await buildFullSystemPrompt('hello', fakeProfile);
    expect(result).toContain('Server Profile');
    expect(result).not.toContain('Important Caveats');
  });

  it('uses default server name when serverName is not provided', async () => {
    const { buildProfileContext } = await import('./profile-context.js');
    const fakeProfile = { osInfo: { platform: 'Ubuntu' } };
    await buildFullSystemPrompt('hello', fakeProfile);
    expect(buildProfileContext).toHaveBeenCalledWith(fakeProfile, 'server');
  });

  it('combines all sections with double newline separator', async () => {
    // Restore caveats mock (may have been overridden by prior test)
    const { buildProfileCaveats } = await import('./profile-context.js');
    vi.mocked(buildProfileCaveats).mockReturnValue(['Disk usage above 80%']);

    const { getRagPipeline } = await import('../knowledge/rag-pipeline.js');
    vi.mocked(getRagPipeline).mockReturnValue({
      isReady: () => true,
      search: vi.fn().mockResolvedValue({
        hasResults: true,
        contextText: '## KB\nsome knowledge',
      }),
    } as never);

    const fakeProfile = { osInfo: { platform: 'Ubuntu' } };
    const result = await buildFullSystemPrompt('query', fakeProfile, 'srv');
    // Base prompt, profile, caveats, and knowledge should all be present
    expect(result).toContain('ServerPilot');
    expect(result).toContain('Server Profile');
    expect(result).toContain('Important Caveats');
    expect(result).toContain('some knowledge');
    // Sections are joined by double newline
    expect(result).toContain('\n\n## Important Caveats');
  });
});
