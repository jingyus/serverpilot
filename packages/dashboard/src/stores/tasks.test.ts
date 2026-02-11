// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTasksStore } from './tasks';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

const mockTasks = [
  {
    id: 'task-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    userId: 'user-1',
    name: 'MySQL Daily Backup',
    description: 'Daily backup of MySQL database',
    cron: '0 2 * * *',
    command: 'mysqldump -u root mydb > /backup/db.sql',
    status: 'active' as const,
    lastRun: '2026-02-09T02:00:00Z',
    lastStatus: 'success' as const,
    nextRun: '2026-02-10T02:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'task-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    userId: 'user-1',
    name: 'Log Cleanup',
    description: null,
    cron: '0 3 * * 0',
    command: 'find /var/log -name "*.log" -mtime +30 -delete',
    status: 'paused' as const,
    lastRun: '2026-02-02T03:00:00Z',
    lastStatus: 'failed' as const,
    nextRun: null,
    createdAt: '2026-01-15T00:00:00Z',
  },
];

function resetStore() {
  useTasksStore.setState({
    tasks: [],
    total: 0,
    selectedTask: null,
    filters: { serverId: '', status: '' },
    isLoading: false,
    isSubmitting: false,
    error: null,
  });
}

describe('useTasksStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const state = useTasksStore.getState();
      expect(state.tasks).toEqual([]);
      expect(state.total).toBe(0);
      expect(state.selectedTask).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isSubmitting).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filters).toEqual({ serverId: '', status: '' });
    });
  });

  describe('fetchTasks', () => {
    it('fetches tasks successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        tasks: mockTasks,
        total: 2,
      });

      await useTasksStore.getState().fetchTasks();

      const state = useTasksStore.getState();
      expect(state.tasks).toEqual(mockTasks);
      expect(state.total).toBe(2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(apiRequest).toHaveBeenCalledWith('/tasks');
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useTasksStore.getState().fetchTasks();
      expect(useTasksStore.getState().isLoading).toBe(true);

      resolvePromise!({ tasks: [], total: 0 });
      await promise;
      expect(useTasksStore.getState().isLoading).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server error')
      );

      await useTasksStore.getState().fetchTasks();

      const state = useTasksStore.getState();
      expect(state.error).toBe('Server error');
      expect(state.isLoading).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error'));

      await useTasksStore.getState().fetchTasks();

      const state = useTasksStore.getState();
      expect(state.error).toBe('Failed to load tasks');
      expect(state.isLoading).toBe(false);
    });

    it('includes filters in query string', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({ tasks: [], total: 0 });

      useTasksStore.setState({
        filters: { serverId: 'srv-1', status: 'active' },
      });

      await useTasksStore.getState().fetchTasks();

      const callArg = vi.mocked(apiRequest).mock.calls[0][0];
      expect(callArg).toContain('serverId=srv-1');
      expect(callArg).toContain('status=active');
    });

    it('does not include empty filters', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({ tasks: [], total: 0 });

      await useTasksStore.getState().fetchTasks();

      expect(apiRequest).toHaveBeenCalledWith('/tasks');
    });
  });

  describe('createTask', () => {
    it('creates task successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      const newTask = { ...mockTasks[0], id: 'task-3', name: 'New Task' };
      vi.mocked(apiRequest).mockResolvedValueOnce({ task: newTask });

      await useTasksStore.getState().createTask({
        name: 'New Task',
        serverId: 'srv-1',
        cron: '0 2 * * *',
        command: 'echo hello',
      });

      const state = useTasksStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].name).toBe('New Task');
      expect(state.total).toBe(1);
      expect(state.isSubmitting).toBe(false);
      expect(apiRequest).toHaveBeenCalledWith('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Task',
          serverId: 'srv-1',
          cron: '0 2 * * *',
          command: 'echo hello',
        }),
      });
    });

    it('sets isSubmitting during creation', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useTasksStore.getState().createTask({
        name: 'Test',
        serverId: 'srv-1',
        cron: '0 0 * * *',
        command: 'test',
      });
      expect(useTasksStore.getState().isSubmitting).toBe(true);

      resolvePromise!({ task: mockTasks[0] });
      await promise;
      expect(useTasksStore.getState().isSubmitting).toBe(false);
    });

    it('handles API error on create', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION', 'Invalid cron')
      );

      await expect(
        useTasksStore.getState().createTask({
          name: 'Test',
          serverId: 'srv-1',
          cron: 'bad',
          command: 'test',
        })
      ).rejects.toThrow();

      const state = useTasksStore.getState();
      expect(state.error).toBe('Invalid cron');
      expect(state.isSubmitting).toBe(false);
    });
  });

  describe('updateTask', () => {
    it('updates task successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      const updated = { ...mockTasks[0], name: 'Updated Name' };
      vi.mocked(apiRequest).mockResolvedValueOnce({ task: updated });

      await useTasksStore.getState().updateTask('task-1', { name: 'Updated Name' });

      const state = useTasksStore.getState();
      expect(state.tasks[0].name).toBe('Updated Name');
      expect(state.isSubmitting).toBe(false);
      expect(apiRequest).toHaveBeenCalledWith('/tasks/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
      });
    });

    it('handles API error on update', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Task not found')
      );

      await expect(
        useTasksStore.getState().updateTask('task-1', { name: 'New' })
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Task not found');
      expect(useTasksStore.getState().isSubmitting).toBe(false);
    });

    it('handles generic error on update', async () => {
      const { apiRequest } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network'));

      await expect(
        useTasksStore.getState().updateTask('task-1', { name: 'New' })
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Failed to update task');
    });
  });

  describe('deleteTask', () => {
    it('deletes task successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      vi.mocked(apiRequest).mockResolvedValueOnce(undefined);

      await useTasksStore.getState().deleteTask('task-1');

      const state = useTasksStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].id).toBe('task-2');
      expect(state.total).toBe(1);
      expect(state.isSubmitting).toBe(false);
      expect(apiRequest).toHaveBeenCalledWith('/tasks/task-1', {
        method: 'DELETE',
      });
    });

    it('handles API error on delete', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(403, 'FORBIDDEN', 'Not authorized')
      );

      await expect(
        useTasksStore.getState().deleteTask('task-1')
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Not authorized');
      expect(useTasksStore.getState().tasks).toHaveLength(2);
    });

    it('handles generic error on delete', async () => {
      const { apiRequest } = await import('@/api/client');
      useTasksStore.setState({ tasks: [...mockTasks], total: 2 });

      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network'));

      await expect(
        useTasksStore.getState().deleteTask('task-1')
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Failed to delete task');
    });
  });

  describe('runTask', () => {
    it('runs task successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce(undefined);

      await useTasksStore.getState().runTask('task-1');

      expect(apiRequest).toHaveBeenCalledWith('/tasks/task-1/run', {
        method: 'POST',
      });
      expect(useTasksStore.getState().error).toBeNull();
    });

    it('handles API error on run', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'ERROR', 'Execution failed')
      );

      await expect(
        useTasksStore.getState().runTask('task-1')
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Execution failed');
    });

    it('handles generic error on run', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network'));

      await expect(
        useTasksStore.getState().runTask('task-1')
      ).rejects.toThrow();

      expect(useTasksStore.getState().error).toBe('Failed to run task');
    });
  });

  describe('filters', () => {
    it('setFilters merges partial filters', () => {
      useTasksStore.getState().setFilters({ serverId: 'srv-1' });

      const state = useTasksStore.getState();
      expect(state.filters.serverId).toBe('srv-1');
      expect(state.filters.status).toBe('');
    });

    it('setFilters merges multiple partial filter updates', () => {
      useTasksStore.getState().setFilters({ serverId: 'srv-1' });
      useTasksStore.getState().setFilters({ status: 'active' });

      const state = useTasksStore.getState();
      expect(state.filters.serverId).toBe('srv-1');
      expect(state.filters.status).toBe('active');
    });

    it('resetFilters clears all filters', () => {
      useTasksStore.setState({
        filters: { serverId: 'srv-1', status: 'active' },
      });

      useTasksStore.getState().resetFilters();

      expect(useTasksStore.getState().filters).toEqual({
        serverId: '',
        status: '',
      });
    });
  });

  describe('selectedTask', () => {
    it('sets and clears selected task', () => {
      useTasksStore.getState().setSelectedTask(mockTasks[0]);
      expect(useTasksStore.getState().selectedTask).toEqual(mockTasks[0]);

      useTasksStore.getState().setSelectedTask(null);
      expect(useTasksStore.getState().selectedTask).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears the error', () => {
      useTasksStore.setState({ error: 'Some error' });

      useTasksStore.getState().clearError();

      expect(useTasksStore.getState().error).toBeNull();
    });
  });
});
