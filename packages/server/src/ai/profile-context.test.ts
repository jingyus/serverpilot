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
  countCjkChars,
  getCharsPerToken,
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
// countCjkChars
// ============================================================================

describe('countCjkChars', () => {
  it('should return 0 for pure ASCII text', () => {
    expect(countCjkChars('Hello, world!')).toBe(0);
  });

  it('should count Chinese characters', () => {
    expect(countCjkChars('你好世界')).toBe(4);
  });

  it('should count Japanese hiragana and katakana', () => {
    expect(countCjkChars('こんにちは')).toBe(5);
    expect(countCjkChars('カタカナ')).toBe(4);
  });

  it('should count Korean hangul', () => {
    expect(countCjkChars('안녕하세요')).toBe(5);
  });

  it('should count CJK in mixed text', () => {
    expect(countCjkChars('Hello 你好 World')).toBe(2);
  });

  it('should count fullwidth characters', () => {
    // Fullwidth Latin letters are in FF00-FFEF range
    expect(countCjkChars('ＡＢＣ')).toBe(3);
  });

  it('should return 0 for empty string', () => {
    expect(countCjkChars('')).toBe(0);
  });
});

// ============================================================================
// getCharsPerToken
// ============================================================================

describe('getCharsPerToken', () => {
  it('should return 4.0 for pure ASCII text', () => {
    expect(getCharsPerToken('Hello, world!')).toBe(4);
  });

  it('should return 1.5 for pure CJK text', () => {
    expect(getCharsPerToken('你好世界测试')).toBe(1.5);
  });

  it('should return weighted average for mixed text', () => {
    // 'Hi你好' = 4 chars, 2 CJK, 2 ASCII
    // ratio = 0.5 CJK → 1.5 * 0.5 + 4 * 0.5 = 2.75
    const ratio = getCharsPerToken('Hi你好');
    expect(ratio).toBeCloseTo(2.75, 5);
  });

  it('should return 4.0 for empty string', () => {
    expect(getCharsPerToken('')).toBe(4);
  });
});

// ============================================================================
// estimateTokens
// ============================================================================

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate ~4 chars per token for English text', () => {
    const text = 'Hello, world!'; // 13 chars → ceil(13/4) = 4
    expect(estimateTokens(text)).toBe(4);
  });

  it('should handle longer ASCII text', () => {
    const text = 'a'.repeat(400); // 400 chars / 4 = 100 tokens
    expect(estimateTokens(text)).toBe(100);
  });

  it('should estimate ~1.5 chars per token for Chinese text', () => {
    // '你好世界' = 4 chars / 1.5 = ceil(2.67) = 3
    const result = estimateTokens('你好世界');
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(5);
  });

  it('should return reasonable estimate for short Chinese', () => {
    // '你好' = 2 chars / 1.5 = ceil(1.33) = 2
    expect(estimateTokens('你好')).toBe(2);
  });

  it('should handle longer Chinese text', () => {
    // 100 CJK chars / 1.5 = ceil(66.67) = 67
    const text = '测'.repeat(100);
    expect(estimateTokens(text)).toBe(67);
  });

  it('should handle mixed Chinese/English text', () => {
    // 'Hello你好World' = 12 chars total, 2 CJK (2/12 CJK)
    // ratio = 1.5*(2/12) + 4*(10/12) = 0.25 + 3.333 = 3.583
    // tokens = ceil(12 / 3.583) = ceil(3.349) = 4
    const mixed = 'Hello你好World';
    const result = estimateTokens(mixed);
    expect(result).toBe(4);
  });

  it('should handle Japanese text', () => {
    // 'こんにちは' = 5 chars / 1.5 = ceil(3.33) = 4
    expect(estimateTokens('こんにちは')).toBe(4);
  });

  it('should handle Korean text', () => {
    // '안녕하세요' = 5 chars / 1.5 = ceil(3.33) = 4
    expect(estimateTokens('안녕하세요')).toBe(4);
  });

  it('should not undercount Chinese text vs old behavior', () => {
    // Old behavior: '你好世界' → ceil(4/4) = 1 (WRONG)
    // New behavior: '你好世界' → ceil(4/1.5) = 3 (CORRECT)
    expect(estimateTokens('你好世界')).toBeGreaterThan(1);
  });

  it('should estimate realistic token count for Chinese paragraphs', () => {
    // 50 Chinese chars: should estimate ~33 tokens (50/1.5), not ~13 (50/4)
    const paragraph = '这是一段用于测试的中文文本，包含了足够多的字符来验证估算的准确性。这段话大约有五十个中文字符左右。';
    const result = estimateTokens(paragraph);
    // Should be significantly higher than text.length / 4
    expect(result).toBeGreaterThan(paragraph.length / 4);
    // Should be in the ballpark of text.length / 1.5
    expect(result).toBeLessThanOrEqual(Math.ceil(paragraph.length / 1.5) + 1);
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
