// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for AI profile context builder.
 *
 * Validates profile-to-context conversion, token budget management,
 * section priority trimming, and caveats generation.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProfileContext,
  buildProfileCaveats,
  estimateTokens,
} from './profile-context.js';
import type { FullServerProfile } from '../core/profile/manager.js';

// ============================================================================
// Helpers
// ============================================================================

function makeProfile(overrides: Partial<FullServerProfile> = {}): FullServerProfile {
  return {
    serverId: 'srv-001',
    osInfo: {
      platform: 'Ubuntu',
      arch: 'x86_64',
      version: '22.04',
      kernel: '5.15.0-91-generic',
      hostname: 'web-01',
      uptime: 86400,
    },
    software: [
      { name: 'nginx', version: '1.18.0', ports: [80, 443], configPath: '/etc/nginx', dataPath: '/var/www' },
      { name: 'mysql', version: '5.7.42', ports: [3306], configPath: '/etc/mysql', dataPath: '/var/lib/mysql' },
    ],
    services: [
      { name: 'nginx', status: 'running', ports: [80, 443], manager: 'systemd', uptime: 3600 },
      { name: 'mysql', status: 'running', ports: [3306], manager: 'systemd', uptime: 3600 },
      { name: 'redis', status: 'stopped', ports: [6379], manager: 'systemd' },
    ],
    preferences: {
      packageManager: 'apt',
      deploymentStyle: 'docker-compose',
      shell: 'bash',
      timezone: 'UTC',
    },
    notes: [
      'Production server - be careful with restarts',
      'MySQL max_connections set to 500',
    ],
    operationHistory: [
      '[2026-01-10T10:00:00Z] Installed nginx 1.18.0',
      '[2026-01-15T14:30:00Z] Updated MySQL config: max_connections=500',
      '[2026-02-01T09:00:00Z] Deployed app v2.3.0',
    ],
    historySummary: 'Server has been used primarily as a web application server running nginx and MySQL.',
    updatedAt: '2026-02-10T10:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// estimateTokens
// ============================================================================

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate ~4 chars per token', () => {
    const text = 'Hello, world!'; // 13 chars → ceil(13/4) = 4
    expect(estimateTokens(text)).toBe(4);
  });

  it('should handle longer text', () => {
    const text = 'a'.repeat(400); // 400 chars → 100 tokens
    expect(estimateTokens(text)).toBe(100);
  });
});

// ============================================================================
// buildProfileContext — basic cases
// ============================================================================

describe('buildProfileContext', () => {
  it('should return minimal context when profile is null', () => {
    const result = buildProfileContext(null, 'web-01');
    expect(result.text).toContain('Server Profile: web-01');
    expect(result.text).toContain('No profile data available');
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.wasTrimmed).toBe(false);
    expect(result.includedSections).toContain('header');
  });

  it('should include OS section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('Ubuntu 22.04 (x86_64)');
    expect(result.text).toContain('Kernel: 5.15.0-91-generic');
    expect(result.text).toContain('Hostname: web-01');
    expect(result.includedSections).toContain('os');
  });

  it('should include installed software section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('Installed Software');
    expect(result.text).toContain('nginx 1.18.0 (ports: 80, 443)');
    expect(result.text).toContain('mysql 5.7.42 (ports: 3306)');
    expect(result.includedSections).toContain('software');
  });

  it('should include running services section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('Running Services');
    expect(result.text).toContain('nginx: running');
    expect(result.text).toContain('mysql: running');
    expect(result.text).toContain('redis: stopped');
    expect(result.includedSections).toContain('services');
  });

  it('should include notes section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('Important Notes');
    expect(result.text).toContain('Production server - be careful with restarts');
    expect(result.text).toContain('MySQL max_connections set to 500');
    expect(result.includedSections).toContain('notes');
  });

  it('should include preferences section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('User Preferences');
    expect(result.text).toContain('Package manager: apt');
    expect(result.text).toContain('Deployment style: docker-compose');
    expect(result.includedSections).toContain('preferences');
  });

  it('should include operation history section', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).toContain('Operation History Summary');
    expect(result.text).toContain('Recent Operations');
    expect(result.text).toContain('Installed nginx 1.18.0');
    expect(result.includedSections).toContain('history');
  });

  it('should respect includeHistory=false option', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01', { includeHistory: false });
    expect(result.text).not.toContain('Recent Operations');
    expect(result.text).not.toContain('Operation History Summary');
  });

  it('should respect includeNotes=false option', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01', { includeNotes: false });
    expect(result.text).not.toContain('Important Notes');
  });

  it('should handle profile with no software', () => {
    const profile = makeProfile({ software: [] });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('Installed Software');
  });

  it('should handle profile with no services', () => {
    const profile = makeProfile({ services: [] });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('Running Services');
  });

  it('should handle profile with no notes', () => {
    const profile = makeProfile({ notes: [] });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('Important Notes');
  });

  it('should handle profile with no preferences', () => {
    const profile = makeProfile({ preferences: null });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('User Preferences');
  });

  it('should handle profile with empty preferences', () => {
    const profile = makeProfile({ preferences: {} });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('User Preferences');
  });

  it('should handle profile with no operation history', () => {
    const profile = makeProfile({ operationHistory: [], historySummary: null });
    const result = buildProfileContext(profile, 'web-01');
    expect(result.text).not.toContain('Recent Operations');
    expect(result.text).not.toContain('Operation History Summary');
  });

  it('should limit recent operations via maxRecentOperations', () => {
    const profile = makeProfile({
      operationHistory: Array.from({ length: 20 }, (_, i) => `[2026-01-${String(i + 1).padStart(2, '0')}] Op ${i + 1}`),
    });
    const result = buildProfileContext(profile, 'web-01', { maxRecentOperations: 3 });
    // Should only include last 3
    expect(result.text).toContain('Op 20');
    expect(result.text).toContain('Op 19');
    expect(result.text).toContain('Op 18');
    expect(result.text).not.toContain('Op 17');
  });
});

// ============================================================================
// buildProfileContext — token budget trimming
// ============================================================================

describe('buildProfileContext — token trimming', () => {
  it('should stay within default 20% budget for full profile', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01');
    // Default: 200K context × 20% = 40K tokens budget
    expect(result.estimatedTokens).toBeLessThanOrEqual(40000);
  });

  it('should trim optional sections when budget is tight', () => {
    const profile = makeProfile();
    // Very small budget: 50 tokens = 200 chars
    const result = buildProfileContext(profile, 'web-01', { maxTokens: 50 });
    expect(result.wasTrimmed).toBe(true);
    expect(result.omittedSections.length).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThanOrEqual(50);
  });

  it('should prioritize OS, software, services over history', () => {
    const profile = makeProfile();
    // Budget enough for OS+software+services but not everything
    const result = buildProfileContext(profile, 'web-01', { maxTokens: 100 });
    // OS section should always be included (high priority)
    const hasOs = result.includedSections.some((s) => s.startsWith('os'));
    expect(hasOs).toBe(true);
  });

  it('should respect custom maxContextPercentage', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01', {
      modelContextWindow: 100_000,
      maxContextPercentage: 0.10, // 10% = 10K tokens
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(10000);
  });

  it('should respect explicit maxTokens over percentage', () => {
    const profile = makeProfile();
    const result = buildProfileContext(profile, 'web-01', {
      maxTokens: 200,
      modelContextWindow: 1_000_000, // Would allow much more via percentage
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// buildProfileCaveats
// ============================================================================

describe('buildProfileCaveats', () => {
  it('should return empty array for null profile', () => {
    const caveats = buildProfileCaveats(null);
    expect(caveats).toEqual([]);
  });

  it('should warn about installed software', () => {
    const profile = makeProfile();
    const caveats = buildProfileCaveats(profile);
    const nginxCaveat = caveats.find((c) => c.includes('nginx'));
    expect(nginxCaveat).toBeDefined();
    expect(nginxCaveat).toContain('1.18.0');
    expect(nginxCaveat).toContain('do not reinstall');
  });

  it('should warn about running services on ports', () => {
    const profile = makeProfile();
    const caveats = buildProfileCaveats(profile);
    const portCaveat = caveats.find((c) => c.includes('port'));
    expect(portCaveat).toBeDefined();
    expect(portCaveat).toContain('80, 443');
    expect(portCaveat).toContain('avoid port conflicts');
  });

  it('should not warn about stopped services', () => {
    const profile = makeProfile({
      services: [
        { name: 'redis', status: 'stopped', ports: [6379], manager: 'systemd' },
      ],
    });
    const caveats = buildProfileCaveats(profile);
    const redisCaveat = caveats.find((c) => c.includes('redis') && c.includes('port'));
    expect(redisCaveat).toBeUndefined();
  });

  it('should handle profile with no software', () => {
    const profile = makeProfile({ software: [] });
    const caveats = buildProfileCaveats(profile);
    const softwareCaveats = caveats.filter((c) => c.includes('installed'));
    expect(softwareCaveats).toHaveLength(0);
  });

  it('should handle services without ports', () => {
    const profile = makeProfile({
      services: [
        { name: 'cron', status: 'running', ports: [], manager: 'systemd' },
      ],
    });
    const caveats = buildProfileCaveats(profile);
    const cronCaveat = caveats.find((c) => c.includes('cron') && c.includes('port'));
    expect(cronCaveat).toBeUndefined();
  });
});

// ============================================================================
// buildSystemPrompt (from chat-ai.ts)
// ============================================================================

describe('buildSystemPrompt', () => {
  // Import inline since it's in the routes module
  let buildSystemPrompt: (profileContext?: string, caveats?: string[]) => string;

  beforeAll(async () => {
    const mod = await import('../api/routes/chat-ai.js');
    buildSystemPrompt = mod.buildSystemPrompt;
  });

  it('should return base prompt when no profile context', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('json-plan');
    expect(prompt).not.toContain('Server Profile');
  });

  it('should append profile context to base prompt', () => {
    const prompt = buildSystemPrompt('# Server Profile: web-01\n## OS\n- Ubuntu 22.04');
    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('Server Profile: web-01');
    expect(prompt).toContain('Ubuntu 22.04');
  });

  it('should append caveats section', () => {
    const prompt = buildSystemPrompt(undefined, [
      'Nginx 1.18.0 is already installed',
      'MySQL is running on port 3306',
    ]);
    expect(prompt).toContain('Important Caveats');
    expect(prompt).toContain('Nginx 1.18.0 is already installed');
    expect(prompt).toContain('MySQL is running on port 3306');
  });

  it('should include both profile context and caveats', () => {
    const prompt = buildSystemPrompt(
      '# Server Profile: web-01',
      ['Nginx installed'],
    );
    expect(prompt).toContain('Server Profile: web-01');
    expect(prompt).toContain('Nginx installed');
  });

  it('should not include empty caveats section', () => {
    const prompt = buildSystemPrompt('profile context', []);
    expect(prompt).not.toContain('Important Caveats');
  });
});
