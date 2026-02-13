// SPDX-License-Identifier: AGPL-3.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServerVars, buildSkillVars } from './engine-template-vars.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { SkillExecution } from '../../db/repositories/skill-repository.js';

// ── Mock server repository ──────────────────────────────────────────
const mockFindById = vi.fn();
const mockGetProfile = vi.fn();
vi.mock('../../db/repositories/server-repository.js', () => ({
  getServerRepository: () => ({
    findById: mockFindById,
    getProfile: mockGetProfile,
  }),
}));

// ── Mock logger (suppress output) ───────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  createContextLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────
function createMockSkillRepo(
  overrides: Partial<SkillRepository> = {},
): SkillRepository {
  return {
    listExecutions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as SkillRepository;
}

function makeExecution(partial: Partial<SkillExecution>): SkillExecution {
  return {
    id: 'exec-1',
    skillId: 'skill-1',
    serverId: 'srv-1',
    userId: 'user-1',
    triggerType: 'manual',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    result: null,
    stepsExecuted: 1,
    duration: null,
    ...partial,
  } as SkillExecution;
}

// ── Tests ───────────────────────────────────────────────────────────
describe('buildServerVars', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockGetProfile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full vars when server and profile are available', async () => {
    mockFindById.mockResolvedValue({ name: 'prod-web-1' });
    mockGetProfile.mockResolvedValue({
      osInfo: { platform: 'linux', hostname: '10.0.0.5' },
    });

    const vars = await buildServerVars('srv-1', 'user-1');
    expect(vars).toEqual({ name: 'prod-web-1', os: 'linux', ip: '10.0.0.5' });
    expect(mockFindById).toHaveBeenCalledWith('srv-1', 'user-1');
    expect(mockGetProfile).toHaveBeenCalledWith('srv-1', 'user-1');
  });

  it('returns defaults when server is not found', async () => {
    mockFindById.mockResolvedValue(null);

    const vars = await buildServerVars('nonexistent', 'user-1');
    expect(vars).toEqual({ name: '', os: '', ip: '' });
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it('returns name with empty os/ip when profile is null', async () => {
    mockFindById.mockResolvedValue({ name: 'staging-1' });
    mockGetProfile.mockResolvedValue(null);

    const vars = await buildServerVars('srv-2', 'user-1');
    expect(vars).toEqual({ name: 'staging-1', os: '', ip: '' });
  });

  it('returns name with empty os/ip when osInfo is null', async () => {
    mockFindById.mockResolvedValue({ name: 'staging-2' });
    mockGetProfile.mockResolvedValue({ osInfo: null });

    const vars = await buildServerVars('srv-3', 'user-1');
    expect(vars).toEqual({ name: 'staging-2', os: '', ip: '' });
  });

  it('returns name with empty os/ip when getProfile throws', async () => {
    mockFindById.mockResolvedValue({ name: 'broken-profile' });
    mockGetProfile.mockRejectedValue(new Error('DB error'));

    const vars = await buildServerVars('srv-4', 'user-1');
    expect(vars).toEqual({ name: 'broken-profile', os: '', ip: '' });
  });

  it('returns defaults when findById throws', async () => {
    mockFindById.mockRejectedValue(new Error('connection lost'));

    const vars = await buildServerVars('srv-5', 'user-1');
    expect(vars).toEqual({ name: '', os: '', ip: '' });
  });
});

describe('buildSkillVars', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns last completed execution with string output', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([
        makeExecution({
          completedAt: '2026-02-10T12:00:00.000Z',
          result: { output: 'nginx restarted successfully' },
        }),
      ]),
    });

    const vars = await buildSkillVars(repo, 'skill-1');
    expect(vars).toEqual({
      last_run: '2026-02-10T12:00:00.000Z',
      last_result: 'nginx restarted successfully',
    });
    expect(repo.listExecutions).toHaveBeenCalledWith('skill-1', 5);
  });

  it('returns JSON-stringified result when output is not a string', async () => {
    const resultObj = { exitCode: 0, lines: 42 };
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([
        makeExecution({
          completedAt: '2026-02-10T12:00:00.000Z',
          result: resultObj,
        }),
      ]),
    });

    const vars = await buildSkillVars(repo, 'skill-2');
    expect(vars).toEqual({
      last_run: '2026-02-10T12:00:00.000Z',
      last_result: JSON.stringify(resultObj),
    });
  });

  it('returns N/A for result when result is null', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([
        makeExecution({
          completedAt: '2026-02-10T12:00:00.000Z',
          result: null,
        }),
      ]),
    });

    const vars = await buildSkillVars(repo, 'skill-3');
    expect(vars).toEqual({
      last_run: '2026-02-10T12:00:00.000Z',
      last_result: 'N/A',
    });
  });

  it('skips in-progress executions and picks first completed one', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([
        makeExecution({ id: 'exec-running', completedAt: null }),
        makeExecution({
          id: 'exec-done',
          completedAt: '2026-02-09T08:00:00.000Z',
          result: { output: 'done' },
        }),
      ]),
    });

    const vars = await buildSkillVars(repo, 'skill-4');
    expect(vars).toEqual({
      last_run: '2026-02-09T08:00:00.000Z',
      last_result: 'done',
    });
  });

  it('returns N/A defaults when no executions exist', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([]),
    });

    const vars = await buildSkillVars(repo, 'skill-5');
    expect(vars).toEqual({ last_run: 'N/A', last_result: 'N/A' });
  });

  it('returns N/A defaults when all executions are in-progress', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockResolvedValue([
        makeExecution({ completedAt: null }),
        makeExecution({ id: 'exec-2', completedAt: null }),
      ]),
    });

    const vars = await buildSkillVars(repo, 'skill-6');
    expect(vars).toEqual({ last_run: 'N/A', last_result: 'N/A' });
  });

  it('returns N/A defaults when listExecutions throws', async () => {
    const repo = createMockSkillRepo({
      listExecutions: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });

    const vars = await buildSkillVars(repo, 'skill-7');
    expect(vars).toEqual({ last_run: 'N/A', last_result: 'N/A' });
  });
});
