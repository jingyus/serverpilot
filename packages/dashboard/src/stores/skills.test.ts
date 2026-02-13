// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsStore } from './skills';
import type { SkillSource, InstalledSkill, AvailableSkill, SkillExecution } from '@/types/skill';

// Mock the API client module
const mockApiRequest = vi.fn();
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const makeSkill = (overrides: Partial<InstalledSkill> = {}): InstalledSkill => ({
  id: 'sk-1',
  userId: 'user-1',
  tenantId: null,
  name: 'nginx-setup',
  displayName: 'Nginx Setup',
  version: '1.0.0',
  source: 'official' as SkillSource,
  skillPath: '/skills/official/nginx-setup',
  status: 'installed',
  config: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeAvailable = (overrides: Partial<AvailableSkill> = {}): AvailableSkill => ({
  manifest: {
    name: 'redis-setup',
    displayName: 'Redis Setup',
    version: '1.0.0',
    description: 'Install and configure Redis',
    author: 'ServerPilot',
    tags: ['database', 'cache'],
  },
  source: 'official' as SkillSource,
  dirPath: '/skills/official/redis-setup',
  installed: false,
  ...overrides,
});

const makeExecution = (overrides: Partial<SkillExecution> = {}): SkillExecution => ({
  id: 'exec-1',
  skillId: 'sk-1',
  serverId: 'srv-1',
  userId: 'user-1',
  triggerType: 'manual',
  status: 'success',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
  result: { output: 'done' },
  stepsExecuted: 3,
  duration: 60000,
  ...overrides,
});

describe('useSkillsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillsStore.setState({
      skills: [],
      available: [],
      executions: [],
      selectedExecution: null,
      isLoadingDetail: false,
      isLoading: false,
      error: null,
      stats: null,
      isLoadingStats: false,
    });
  });

  // --------------------------------------------------------------------------
  // fetchSkills
  // --------------------------------------------------------------------------

  describe('fetchSkills', () => {
    it('should fetch skills successfully and update state', async () => {
      const skills = [makeSkill(), makeSkill({ id: 'sk-2', name: 'redis-setup' })];
      mockApiRequest.mockResolvedValueOnce({ skills });

      await useSkillsStore.getState().fetchSkills();

      const state = useSkillsStore.getState();
      expect(state.skills).toEqual(skills);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/skills');
    });

    it('should set isLoading to true while fetching', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useSkillsStore.getState().fetchSkills();

      expect(useSkillsStore.getState().isLoading).toBe(true);

      resolvePromise!({ skills: [] });
      await fetchPromise;

      expect(useSkillsStore.getState().isLoading).toBe(false);
    });

    it('should handle ApiError on fetch', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server exploded'),
      );

      await useSkillsStore.getState().fetchSkills();

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Server exploded');
      expect(state.isLoading).toBe(false);
    });

    it('should use fallback message for non-ApiError', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useSkillsStore.getState().fetchSkills();

      expect(useSkillsStore.getState().error).toBe('Failed to load skills');
    });
  });

  // --------------------------------------------------------------------------
  // fetchAvailable
  // --------------------------------------------------------------------------

  describe('fetchAvailable', () => {
    it('should fetch available skills and update state', async () => {
      const available = [makeAvailable()];
      mockApiRequest.mockResolvedValueOnce({ skills: available });

      await useSkillsStore.getState().fetchAvailable();

      const state = useSkillsStore.getState();
      expect(state.available).toEqual(available);
      expect(state.isLoading).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/available');
    });

    it('should handle ApiError on fetchAvailable', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(403, 'FORBIDDEN', 'Not allowed'),
      );

      await useSkillsStore.getState().fetchAvailable();

      expect(useSkillsStore.getState().error).toBe('Not allowed');
    });
  });

  // --------------------------------------------------------------------------
  // installSkill
  // --------------------------------------------------------------------------

  describe('installSkill', () => {
    it('should install a skill and append to list', async () => {
      const existing = makeSkill({ id: 'sk-existing' });
      useSkillsStore.setState({ skills: [existing] });

      const newSkill = makeSkill({ id: 'sk-new', name: 'new-skill' });
      mockApiRequest.mockResolvedValueOnce({ skill: newSkill });

      const result = await useSkillsStore.getState().installSkill('/skills/new-skill', 'local');

      expect(result).toEqual(newSkill);
      expect(useSkillsStore.getState().skills).toHaveLength(2);
      expect(useSkillsStore.getState().skills[1]).toEqual(newSkill);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/install', {
        method: 'POST',
        body: JSON.stringify({ skillDir: '/skills/new-skill', source: 'local' }),
      });
    });

    it('should handle ApiError on install and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'BAD_REQUEST', 'Skill already installed'),
      );

      await expect(
        useSkillsStore.getState().installSkill('/skills/dup', 'official'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Skill already installed');
    });
  });

  // --------------------------------------------------------------------------
  // uninstallSkill
  // --------------------------------------------------------------------------

  describe('uninstallSkill', () => {
    it('should remove the skill from list', async () => {
      const sk1 = makeSkill({ id: 'sk-1' });
      const sk2 = makeSkill({ id: 'sk-2' });
      useSkillsStore.setState({ skills: [sk1, sk2] });

      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().uninstallSkill('sk-1');

      const state = useSkillsStore.getState();
      expect(state.skills).toHaveLength(1);
      expect(state.skills[0].id).toBe('sk-2');
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1', { method: 'DELETE' });
    });

    it('should handle ApiError on uninstall and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      useSkillsStore.setState({ skills: [makeSkill()] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Skill not found'),
      );

      await expect(
        useSkillsStore.getState().uninstallSkill('sk-1'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Skill not found');
    });
  });

  // --------------------------------------------------------------------------
  // configureSkill
  // --------------------------------------------------------------------------

  describe('configureSkill', () => {
    it('should configure skill and update local state', async () => {
      useSkillsStore.setState({ skills: [makeSkill({ id: 'sk-1', status: 'installed' })] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      const config = { port: 8080 };
      await useSkillsStore.getState().configureSkill('sk-1', config);

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.config).toEqual(config);
      expect(skill.status).toBe('configured');
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/config', {
        method: 'PUT',
        body: JSON.stringify({ config: { port: 8080 } }),
      });
    });

    it('should preserve enabled status when configuring', async () => {
      useSkillsStore.setState({ skills: [makeSkill({ id: 'sk-1', status: 'enabled' })] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      const config = { port: 9090 };
      await useSkillsStore.getState().configureSkill('sk-1', config);

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.config).toEqual(config);
      expect(skill.status).toBe('enabled');
    });

    it('should preserve paused status when configuring', async () => {
      useSkillsStore.setState({ skills: [makeSkill({ id: 'sk-1', status: 'paused' })] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      const config = { workers: 4 };
      await useSkillsStore.getState().configureSkill('sk-1', config);

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.config).toEqual(config);
      expect(skill.status).toBe('paused');
    });

    it('should use fallback message for non-ApiError on configure', async () => {
      useSkillsStore.setState({ skills: [makeSkill()] });
      mockApiRequest.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        useSkillsStore.getState().configureSkill('sk-1', {}),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Failed to configure skill');
    });
  });

  // --------------------------------------------------------------------------
  // updateStatus
  // --------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('should update skill status in local state', async () => {
      useSkillsStore.setState({ skills: [makeSkill({ id: 'sk-1', status: 'configured' })] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().updateStatus('sk-1', 'enabled');

      expect(useSkillsStore.getState().skills[0].status).toBe('enabled');
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/status', {
        method: 'PUT',
        body: JSON.stringify({ status: 'enabled' }),
      });
    });

    it('should handle ApiError on updateStatus', async () => {
      const { ApiError } = await import('@/api/client');
      useSkillsStore.setState({ skills: [makeSkill()] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'BAD_REQUEST', 'Invalid status transition'),
      );

      await expect(
        useSkillsStore.getState().updateStatus('sk-1', 'paused'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Invalid status transition');
    });
  });

  // --------------------------------------------------------------------------
  // executeSkill
  // --------------------------------------------------------------------------

  describe('executeSkill', () => {
    it('should execute a skill and return the result', async () => {
      const executionResult = {
        executionId: 'exec-1',
        status: 'success' as const,
        stepsExecuted: 3,
        duration: 5000,
        result: { output: 'done' },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      const result = await useSkillsStore.getState().executeSkill('sk-1', 'srv-1');

      expect(result).toEqual(executionResult);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/execute', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1' }),
      });
    });

    it('should pass optional config to execute', async () => {
      const executionResult = {
        executionId: 'exec-2',
        status: 'success' as const,
        stepsExecuted: 1,
        duration: 1000,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      await useSkillsStore.getState().executeSkill('sk-1', 'srv-1', { port: 3000 });

      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/execute', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1', config: { port: 3000 } }),
      });
    });

    it('should handle ApiError on execute and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'BAD_REQUEST', 'Skill not enabled'),
      );

      await expect(
        useSkillsStore.getState().executeSkill('sk-1', 'srv-1'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Skill not enabled');
    });

    it('should pass dryRun=true to API request', async () => {
      const executionResult = {
        executionId: 'exec-dry',
        status: 'success' as const,
        stepsExecuted: 0,
        duration: 200,
        result: { output: 'Step 1: shell — apt update' },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      const result = await useSkillsStore.getState().executeSkill('sk-1', 'srv-1', undefined, true);

      expect(result).toEqual(executionResult);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/execute', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1', dryRun: true }),
      });
    });

    it('should not include dryRun in body when it is falsy', async () => {
      const executionResult = {
        executionId: 'exec-normal',
        status: 'success' as const,
        stepsExecuted: 2,
        duration: 1000,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      await useSkillsStore.getState().executeSkill('sk-1', 'srv-1', undefined, false);

      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/execute', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1' }),
      });
    });
  });

  // --------------------------------------------------------------------------
  // fetchExecutions
  // --------------------------------------------------------------------------

  describe('fetchExecutions', () => {
    it('should fetch executions and update state', async () => {
      const executions = [makeExecution(), makeExecution({ id: 'exec-2' })];
      mockApiRequest.mockResolvedValueOnce({ executions });

      await useSkillsStore.getState().fetchExecutions('sk-1');

      const state = useSkillsStore.getState();
      expect(state.executions).toEqual(executions);
      expect(state.isLoading).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/executions');
    });

    it('should use fallback message for non-ApiError on fetchExecutions', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await useSkillsStore.getState().fetchExecutions('sk-1');

      expect(useSkillsStore.getState().error).toBe('Failed to load executions');
    });
  });

  // --------------------------------------------------------------------------
  // fetchExecutionDetail
  // --------------------------------------------------------------------------

  describe('fetchExecutionDetail', () => {
    it('should fetch execution detail and update selectedExecution', async () => {
      const execution = makeExecution({ id: 'exec-42', skillId: 'sk-1' });
      mockApiRequest.mockResolvedValueOnce({ execution });

      await useSkillsStore.getState().fetchExecutionDetail('sk-1', 'exec-42');

      const state = useSkillsStore.getState();
      expect(state.selectedExecution).toEqual(execution);
      expect(state.isLoadingDetail).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/executions/exec-42');
    });

    it('should set isLoadingDetail while fetching', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useSkillsStore.getState().fetchExecutionDetail('sk-1', 'exec-1');

      expect(useSkillsStore.getState().isLoadingDetail).toBe(true);

      resolvePromise!({ execution: makeExecution() });
      await fetchPromise;

      expect(useSkillsStore.getState().isLoadingDetail).toBe(false);
    });

    it('should handle error on fetchExecutionDetail', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Execution not found'),
      );

      await useSkillsStore.getState().fetchExecutionDetail('sk-1', 'exec-missing');

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Execution not found');
      expect(state.isLoadingDetail).toBe(false);
      expect(state.selectedExecution).toBeNull();
    });

    it('should use fallback message for non-ApiError', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('timeout'));

      await useSkillsStore.getState().fetchExecutionDetail('sk-1', 'exec-1');

      expect(useSkillsStore.getState().error).toBe('Failed to load execution detail');
    });
  });

  // --------------------------------------------------------------------------
  // fetchPendingConfirmations
  // --------------------------------------------------------------------------

  describe('fetchPendingConfirmations', () => {
    it('should fetch pending confirmations and update state', async () => {
      const pending = [makeExecution({ id: 'exec-p1', status: 'pending_confirmation', triggerType: 'cron' })];
      mockApiRequest.mockResolvedValueOnce({ executions: pending });

      await useSkillsStore.getState().fetchPendingConfirmations();

      const state = useSkillsStore.getState();
      expect(state.pendingConfirmations).toEqual(pending);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/pending-confirmations');
    });

    it('should handle error on fetchPendingConfirmations', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server error'),
      );

      await useSkillsStore.getState().fetchPendingConfirmations();

      expect(useSkillsStore.getState().error).toBe('Server error');
    });

    it('should use fallback message for non-ApiError', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await useSkillsStore.getState().fetchPendingConfirmations();

      expect(useSkillsStore.getState().error).toBe('Failed to load pending confirmations');
    });
  });

  // --------------------------------------------------------------------------
  // confirmExecution
  // --------------------------------------------------------------------------

  describe('confirmExecution', () => {
    it('should confirm execution and remove from pending list', async () => {
      useSkillsStore.setState({
        pendingConfirmations: [
          makeExecution({ id: 'exec-p1', status: 'pending_confirmation' }),
          makeExecution({ id: 'exec-p2', status: 'pending_confirmation' }),
        ],
      });

      const result = {
        executionId: 'exec-p1',
        status: 'success' as const,
        stepsExecuted: 2,
        duration: 1000,
        result: { output: 'done' },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: result });

      const ret = await useSkillsStore.getState().confirmExecution('exec-p1');

      expect(ret).toEqual(result);
      expect(useSkillsStore.getState().pendingConfirmations).toHaveLength(1);
      expect(useSkillsStore.getState().pendingConfirmations[0].id).toBe('exec-p2');
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/executions/exec-p1/confirm', {
        method: 'POST',
      });
    });

    it('should handle error on confirmExecution and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'BAD_REQUEST', 'Execution has expired'),
      );

      await expect(
        useSkillsStore.getState().confirmExecution('exec-expired'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Execution has expired');
    });
  });

  // --------------------------------------------------------------------------
  // rejectExecution
  // --------------------------------------------------------------------------

  describe('rejectExecution', () => {
    it('should reject execution and remove from pending list', async () => {
      useSkillsStore.setState({
        pendingConfirmations: [
          makeExecution({ id: 'exec-p1', status: 'pending_confirmation' }),
        ],
      });

      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().rejectExecution('exec-p1');

      expect(useSkillsStore.getState().pendingConfirmations).toHaveLength(0);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/executions/exec-p1/reject', {
        method: 'POST',
      });
    });

    it('should handle error on rejectExecution and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Execution not found'),
      );

      await expect(
        useSkillsStore.getState().rejectExecution('exec-missing'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Execution not found');
    });

    it('should use fallback message for non-ApiError on reject', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await expect(
        useSkillsStore.getState().rejectExecution('exec-1'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Failed to reject execution');
    });
  });

  // --------------------------------------------------------------------------
  // clearSelectedExecution
  // --------------------------------------------------------------------------

  describe('clearSelectedExecution', () => {
    it('should clear the selectedExecution state', () => {
      useSkillsStore.setState({ selectedExecution: makeExecution() });

      useSkillsStore.getState().clearSelectedExecution();

      expect(useSkillsStore.getState().selectedExecution).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // fetchStats
  // --------------------------------------------------------------------------

  describe('fetchStats', () => {
    const sampleStats = {
      totalExecutions: 10,
      successRate: 0.8,
      avgDuration: 1500,
      topSkills: [{ skillId: 'sk-1', skillName: 'Nginx Setup', executionCount: 7, successCount: 6 }],
      dailyTrend: [{ date: '2026-02-12', total: 5, success: 4, failed: 1 }],
      triggerDistribution: [{ triggerType: 'manual' as const, count: 8 }],
    };

    it('should fetch stats successfully', async () => {
      mockApiRequest.mockResolvedValueOnce({ stats: sampleStats });

      await useSkillsStore.getState().fetchStats();

      const state = useSkillsStore.getState();
      expect(state.stats).toEqual(sampleStats);
      expect(state.isLoadingStats).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/stats');
    });

    it('should handle error on fetchStats', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Stats unavailable'),
      );

      await useSkillsStore.getState().fetchStats();

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Stats unavailable');
      expect(state.isLoadingStats).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // upgradeSkill
  // --------------------------------------------------------------------------

  describe('upgradeSkill', () => {
    it('should upgrade a skill and replace it in the list', async () => {
      const original = makeSkill({ id: 'sk-1', version: '1.0.0', source: 'community' });
      useSkillsStore.setState({ skills: [original] });

      const upgraded = makeSkill({ id: 'sk-1', version: '2.0.0', source: 'community' });
      mockApiRequest.mockResolvedValueOnce({ skill: upgraded });

      await useSkillsStore.getState().upgradeSkill('sk-1');

      const state = useSkillsStore.getState();
      expect(state.skills[0].version).toBe('2.0.0');
      expect(state.isUpgrading).toBeNull();
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/upgrade', {
        method: 'PUT',
      });
    });

    it('should set isUpgrading to the skill id while upgrading', async () => {
      useSkillsStore.setState({ skills: [makeSkill()] });
      let resolvePromise: (v: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending);

      const upgradePromise = useSkillsStore.getState().upgradeSkill('sk-1');
      expect(useSkillsStore.getState().isUpgrading).toBe('sk-1');

      resolvePromise!({ skill: makeSkill({ version: '2.0.0' }) });
      await upgradePromise;

      expect(useSkillsStore.getState().isUpgrading).toBeNull();
    });

    it('should handle ApiError on upgrade and re-throw', async () => {
      useSkillsStore.setState({ skills: [makeSkill()] });
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Skill not found'),
      );

      await expect(useSkillsStore.getState().upgradeSkill('sk-1')).rejects.toThrow();

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Skill not found');
      expect(state.isUpgrading).toBeNull();
    });

    it('should use fallback message for non-ApiError on upgrade', async () => {
      useSkillsStore.setState({ skills: [makeSkill()] });
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await expect(useSkillsStore.getState().upgradeSkill('sk-1')).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Failed to upgrade skill');
    });
  });

  // --------------------------------------------------------------------------
  // cancelExecution
  // --------------------------------------------------------------------------

  describe('cancelExecution', () => {
    it('should cancel execution and update status in list', async () => {
      useSkillsStore.setState({
        executions: [makeExecution({ id: 'exec-1', status: 'running' })],
        isStreaming: true,
      });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().cancelExecution('exec-1');

      const state = useSkillsStore.getState();
      expect(state.executions[0].status).toBe('cancelled');
      expect(state.isCancelling).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/executions/exec-1/cancel', {
        method: 'POST',
      });
    });

    it('should set isCancelling to the execution id while cancelling', async () => {
      useSkillsStore.setState({ executions: [makeExecution({ id: 'exec-1', status: 'running' })] });
      let resolvePromise: (v: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending);

      const cancelPromise = useSkillsStore.getState().cancelExecution('exec-1');
      expect(useSkillsStore.getState().isCancelling).toBe('exec-1');

      resolvePromise!({ success: true });
      await cancelPromise;

      expect(useSkillsStore.getState().isCancelling).toBeNull();
    });

    it('should handle ApiError on cancel and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'BAD_REQUEST', 'Execution not found or not running'),
      );

      await expect(useSkillsStore.getState().cancelExecution('exec-bad')).rejects.toThrow();

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Execution not found or not running');
      expect(state.isCancelling).toBeNull();
    });

    it('should use fallback message for non-ApiError on cancel', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('timeout'));

      await expect(useSkillsStore.getState().cancelExecution('exec-1')).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Failed to cancel execution');
    });
  });

  // --------------------------------------------------------------------------
  // dryRunSkill
  // --------------------------------------------------------------------------

  describe('dryRunSkill', () => {
    it('should call dedicated dry-run endpoint and store result', async () => {
      const executionResult = {
        executionId: 'exec-dry-1',
        status: 'success' as const,
        stepsExecuted: 0,
        duration: 800,
        result: { output: 'Step 1: run_command — apt update' },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult, dryRun: true });

      const result = await useSkillsStore.getState().dryRunSkill('sk-1', 'srv-1');

      expect(result).toEqual(executionResult);
      const state = useSkillsStore.getState();
      expect(state.dryRunResult).toEqual(executionResult);
      expect(state.isDryRunning).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/dry-run', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1' }),
      });
    });

    it('should pass inputs as config to the dry-run endpoint', async () => {
      const executionResult = {
        executionId: 'exec-dry-2',
        status: 'success' as const,
        stepsExecuted: 0,
        duration: 500,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult, dryRun: true });

      await useSkillsStore.getState().dryRunSkill('sk-1', 'srv-1', { port: 3000 });

      expect(mockApiRequest).toHaveBeenCalledWith('/skills/sk-1/dry-run', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'srv-1', config: { port: 3000 } }),
      });
    });

    it('should set isDryRunning while request is in-flight', async () => {
      let resolvePromise: (v: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending);

      const dryRunPromise = useSkillsStore.getState().dryRunSkill('sk-1', 'srv-1');

      expect(useSkillsStore.getState().isDryRunning).toBe(true);
      expect(useSkillsStore.getState().dryRunResult).toBeNull();

      resolvePromise!({ execution: { executionId: 'e', status: 'success', stepsExecuted: 0, duration: 0, result: null, errors: [] } });
      await dryRunPromise;

      expect(useSkillsStore.getState().isDryRunning).toBe(false);
    });

    it('should handle error on dryRunSkill and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'AI provider unavailable'),
      );

      await expect(
        useSkillsStore.getState().dryRunSkill('sk-1', 'srv-1'),
      ).rejects.toThrow();

      const state = useSkillsStore.getState();
      expect(state.error).toBe('AI provider unavailable');
      expect(state.isDryRunning).toBe(false);
      expect(state.dryRunResult).toBeNull();
    });

    it('should use fallback message for non-ApiError on dryRunSkill', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await expect(
        useSkillsStore.getState().dryRunSkill('sk-1', 'srv-1'),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Failed to preview skill');
    });
  });

  // --------------------------------------------------------------------------
  // clearDryRunResult
  // --------------------------------------------------------------------------

  describe('clearDryRunResult', () => {
    it('should clear the dryRunResult state', () => {
      useSkillsStore.setState({
        dryRunResult: {
          executionId: 'exec-dry-1',
          status: 'success',
          stepsExecuted: 0,
          duration: 500,
          result: { output: 'plan' },
          errors: [],
        },
      });

      useSkillsStore.getState().clearDryRunResult();

      expect(useSkillsStore.getState().dryRunResult).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // clearError
  // --------------------------------------------------------------------------

  describe('clearError', () => {
    it('should clear the error state', () => {
      useSkillsStore.setState({ error: 'Some error message' });

      useSkillsStore.getState().clearError();

      expect(useSkillsStore.getState().error).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // exportSkill
  // --------------------------------------------------------------------------

  describe('exportSkill', () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
      URL.revokeObjectURL = vi.fn();
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should download skill as file on successful export', async () => {
      const mockBlob = new Blob(['test'], { type: 'application/gzip' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="nginx-setup-1.0.0.tar.gz"',
        }),
      });

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValueOnce({
        set href(v: string) { /* noop */ },
        set download(v: string) { /* noop */ },
        click: clickSpy,
      } as unknown as HTMLAnchorElement);

      await useSkillsStore.getState().exportSkill('sk-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/skills/sk-1/export', expect.any(Object));
      expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      expect(useSkillsStore.getState().isExporting).toBeNull();
      expect(useSkillsStore.getState().error).toBeNull();
    });

    it('should set isExporting to skill id while exporting', async () => {
      let resolveFetch: (v: unknown) => void;
      const pending = new Promise((resolve) => { resolveFetch = resolve; });
      mockFetch.mockReturnValueOnce(pending);

      const exportPromise = useSkillsStore.getState().exportSkill('sk-1');
      expect(useSkillsStore.getState().isExporting).toBe('sk-1');

      resolveFetch!({
        ok: true,
        blob: () => Promise.resolve(new Blob()),
        headers: new Headers(),
      });

      vi.spyOn(document, 'createElement').mockReturnValueOnce({
        set href(_: string) { /* noop */ },
        set download(_: string) { /* noop */ },
        click: vi.fn(),
      } as unknown as HTMLAnchorElement);

      await exportPromise;
      expect(useSkillsStore.getState().isExporting).toBeNull();
    });

    it('should handle export error and set error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { message: 'Skill not found' } }),
      });

      await useSkillsStore.getState().exportSkill('sk-missing');

      expect(useSkillsStore.getState().error).toBe('Skill not found');
      expect(useSkillsStore.getState().isExporting).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // importSkill
  // --------------------------------------------------------------------------

  describe('importSkill', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
    });

    it('should import skill and append to list', async () => {
      const existing = makeSkill({ id: 'sk-existing' });
      useSkillsStore.setState({ skills: [existing] });

      const imported = makeSkill({ id: 'sk-imported', name: 'imported-skill' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ skill: imported, warnings: [] }),
      });

      const file = new File(['test'], 'skill.tar.gz', { type: 'application/gzip' });
      await useSkillsStore.getState().importSkill(file);

      expect(useSkillsStore.getState().skills).toHaveLength(2);
      expect(useSkillsStore.getState().skills[1]).toEqual(imported);
      expect(useSkillsStore.getState().isImporting).toBe(false);
    });

    it('should reject file larger than 50MB', async () => {
      const bigFile = new File(['x'], 'big.tar.gz', { type: 'application/gzip' });
      Object.defineProperty(bigFile, 'size', { value: 51 * 1024 * 1024 });

      await expect(
        useSkillsStore.getState().importSkill(bigFile),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('File too large. Maximum size is 50MB.');
      expect(useSkillsStore.getState().isImporting).toBe(false);
    });

    it('should reject invalid file format', async () => {
      const zipFile = new File(['x'], 'skill.zip', { type: 'application/zip' });

      await expect(
        useSkillsStore.getState().importSkill(zipFile),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Invalid file format. Please upload a .tar.gz or .tgz file.');
      expect(useSkillsStore.getState().isImporting).toBe(false);
    });

    it('should handle server error on import', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: { message: 'Skill already installed' } }),
      });

      const file = new File(['test'], 'skill.tar.gz', { type: 'application/gzip' });
      await expect(
        useSkillsStore.getState().importSkill(file),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe('Skill already installed');
      expect(useSkillsStore.getState().isImporting).toBe(false);
    });

    it('should set isImporting while request is in-flight', async () => {
      let resolveFetch: (v: unknown) => void;
      const pending = new Promise((resolve) => { resolveFetch = resolve; });
      mockFetch.mockReturnValueOnce(pending);

      const file = new File(['test'], 'skill.tar.gz', { type: 'application/gzip' });
      const importPromise = useSkillsStore.getState().importSkill(file);

      expect(useSkillsStore.getState().isImporting).toBe(true);

      resolveFetch!({
        ok: true,
        json: () => Promise.resolve({ skill: makeSkill(), warnings: [] }),
      });
      await importPromise;

      expect(useSkillsStore.getState().isImporting).toBe(false);
    });
  });
});
