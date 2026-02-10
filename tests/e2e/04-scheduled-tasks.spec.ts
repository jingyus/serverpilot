/**
 * E2E Test: Scheduled Task Creation & Execution
 *
 * Tests the task management lifecycle:
 * 1. Create a scheduled task (cron-based)
 * 2. List tasks
 * 3. Get task details
 * 4. Update task
 * 5. Manual task execution (requires agent)
 * 6. Delete task
 * 7. Validation (invalid cron, access control)
 *
 * @module tests/e2e/04-scheduled-tasks
 */

import { test, expect } from '@playwright/test';
import {
  registerUser,
  createServer,
  setAuthInBrowser,
  apiGet,
  apiPatch,
  apiDelete,
  apiPost,
} from './helpers';

test.describe('Scheduled Task Creation & Execution', () => {
  test('API: create a scheduled task', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Task Server');

    const { status, body } = await apiPost(
      request,
      '/tasks',
      user.accessToken,
      {
        serverId: server.id,
        name: 'Daily Backup',
        cron: '0 2 * * *', // Every day at 2 AM
        command: 'tar -czf /backup/daily.tar.gz /var/data',
        description: 'Daily data backup',
      },
    );

    expect(status).toBe(201);
    const task = (body as { task: { id: string; name: string; cron: string } }).task;
    expect(task.id).toBeTruthy();
    expect(task.name).toBe('Daily Backup');
    expect(task.cron).toBe('0 2 * * *');
  });

  test('API: list tasks', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Task List Server');

    // Create two tasks
    await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Task A',
      cron: '0 * * * *',
      command: 'echo hello',
    });
    await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Task B',
      cron: '30 * * * *',
      command: 'echo world',
    });

    const result = await apiGet(
      request,
      `/tasks?serverId=${server.id}`,
      user.accessToken,
    ) as { tasks: unknown[]; total: number };

    expect(result.tasks.length).toBe(2);
    expect(result.total).toBe(2);
  });

  test('API: get task details', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Task Detail Server');

    const { body: created } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Detail Task',
      cron: '0 0 * * *',
      command: 'uptime',
      description: 'Check uptime',
    });
    const taskId = (created as { task: { id: string } }).task.id;

    const result = await apiGet(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
    ) as { task: { id: string; name: string; description: string } };

    expect(result.task.id).toBe(taskId);
    expect(result.task.name).toBe('Detail Task');
    expect(result.task.description).toBe('Check uptime');
  });

  test('API: update task', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Task Update Server');

    const { body: created } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Original Task',
      cron: '0 0 * * *',
      command: 'echo original',
    });
    const taskId = (created as { task: { id: string } }).task.id;

    const { status, body } = await apiPatch(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
      { name: 'Updated Task', command: 'echo updated' },
    );

    expect(status).toBe(200);
    const task = (body as { task: { name: string; command: string } }).task;
    expect(task.name).toBe('Updated Task');
    expect(task.command).toBe('echo updated');
  });

  test('API: pause and resume task', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Pause Server');

    const { body: created } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Pausable Task',
      cron: '0 0 * * *',
      command: 'echo test',
    });
    const taskId = (created as { task: { id: string } }).task.id;

    // Pause
    const { status: pauseStatus } = await apiPatch(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
      { status: 'paused' },
    );
    expect(pauseStatus).toBe(200);

    // Verify paused
    const paused = await apiGet(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
    ) as { task: { status: string } };
    expect(paused.task.status).toBe('paused');

    // Resume
    const { status: activeStatus } = await apiPatch(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
      { status: 'active' },
    );
    expect(activeStatus).toBe(200);
  });

  test('API: delete task', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Task Delete Server');

    const { body: created } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'To Delete Task',
      cron: '0 0 * * *',
      command: 'echo delete',
    });
    const taskId = (created as { task: { id: string } }).task.id;

    const { status, body } = await apiDelete(
      request,
      `/tasks/${taskId}`,
      user.accessToken,
    );

    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  test('API: manual run requires agent connection', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Run Task Server');

    const { body: created } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Manual Run Task',
      cron: '0 0 * * *',
      command: 'echo hello',
    });
    const taskId = (created as { task: { id: string } }).task.id;

    // Manual run should fail — no agent connected
    const { status } = await apiPost(
      request,
      `/tasks/${taskId}/run`,
      user.accessToken,
      {},
    );

    // 503 = server offline
    expect(status).toBe(503);
  });

  test('API: reject invalid cron expression', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Invalid Cron Server');

    const { status } = await apiPost(request, '/tasks', user.accessToken, {
      serverId: server.id,
      name: 'Bad Cron Task',
      cron: 'invalid-cron-expression',
      command: 'echo bad',
    });

    expect(status).toBe(400);
  });

  test('UI: navigate to tasks page (authenticated)', async ({ page, request }) => {
    const user = await registerUser(request);

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/tasks');

    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });
});
