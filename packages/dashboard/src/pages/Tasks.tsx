// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  Pencil,
  Filter,
  X,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTasksStore } from '@/stores/tasks';
import { useServersStore } from '@/stores/servers';
import { formatDate } from '@/utils/format';
import type { Task, TaskStatus, TaskLastStatus, CreateTaskInput, UpdateTaskInput } from '@/types/dashboard';

// ── Config Maps ──

const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }
> = {
  active: { label: 'Active', variant: 'default', icon: Play },
  paused: { label: 'Paused', variant: 'secondary', icon: Pause },
  deleted: { label: 'Deleted', variant: 'destructive', icon: XCircle },
};

const LAST_STATUS_CONFIG: Record<
  TaskLastStatus,
  { label: string; variant: 'default' | 'destructive'; icon: typeof CheckCircle2 }
> = {
  success: { label: 'Success', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
};

// ── Cron Description ──

function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:00`;
  }
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[Number(dow)] ?? dow;
    return `Every ${dayName} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min !== '*' && hour !== '*' && dom !== '*' && mon === '*' && dow === '*') {
    return `Monthly on day ${dom} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (cron === '* * * * *') return 'Every minute';
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every hour';
  }
  return cron;
}

// ── Sub-components ──

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG.active;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`task-status-${status}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function LastRunBadge({ lastStatus }: { lastStatus: TaskLastStatus | null | undefined }) {
  if (!lastStatus) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="last-status-none">
        Never run
      </span>
    );
  }
  const config = LAST_STATUS_CONFIG[lastStatus] ?? LAST_STATUS_CONFIG.success;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`last-status-${lastStatus}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function StatsCards() {
  const { tasks } = useTasksStore();

  const active = tasks.filter((t) => t.status === 'active').length;
  const paused = tasks.filter((t) => t.status === 'paused').length;
  const successCount = tasks.filter((t) => t.lastStatus === 'success').length;
  const failedCount = tasks.filter((t) => t.lastStatus === 'failed').length;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4" data-testid="task-stats">
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold sm:text-2xl">{tasks.length}</div>
              <p className="text-xs text-muted-foreground">Total Tasks</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
              <Play className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 sm:text-2xl">{active}</div>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100 text-yellow-600">
              <Pause className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-600 sm:text-2xl">{paused}</div>
              <p className="text-xs text-muted-foreground">Paused</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex gap-1 text-sm font-bold sm:text-base">
                <span className="text-green-600">{successCount}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-600">{failedCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">Last Run S/F</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
  const { filters, setFilters, resetFilters } = useTasksStore();
  const { servers } = useServersStore();

  const hasActiveFilters = Object.values(filters).some((v) => v !== '');

  return (
    <Card data-testid="task-filter-bar">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />

          <select
            value={filters.serverId}
            onChange={(e) => setFilters({ serverId: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by server"
            data-testid="filter-server"
          >
            <option value="">All Servers</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by status"
            data-testid="filter-task-status"
          >
            <option value="">All Status</option>
            {(['active', 'paused'] as const).map((s) => (
              <option key={s} value={s}>{TASK_STATUS_CONFIG[s].label}</option>
            ))}
          </select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 gap-1 text-xs"
              data-testid="reset-task-filters"
            >
              <X className="h-3 w-3" />
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  onEdit,
  onDelete,
  onToggleStatus,
  onRun,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onRun: (task: Task) => void;
}) {
  return (
    <tr
      className="border-b border-border/50 transition-colors hover:bg-muted/50"
      data-testid={`task-row-${task.id}`}
    >
      <td className="px-3 py-3 text-sm font-medium sm:px-4">{task.name}</td>
      <td className="px-3 py-3 text-sm sm:px-4">
        {task.serverName ?? task.serverId}
      </td>
      <td className="hidden px-3 py-3 text-sm sm:table-cell sm:px-4">
        <div>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{task.cron}</code>
          <p className="mt-0.5 text-xs text-muted-foreground">{describeCron(task.cron)}</p>
        </div>
      </td>
      <td className="px-3 py-3 sm:px-4">
        <TaskStatusBadge status={task.status} />
      </td>
      <td className="hidden px-3 py-3 sm:table-cell sm:px-4">
        <LastRunBadge lastStatus={task.lastStatus} />
      </td>
      <td className="hidden px-3 py-3 text-xs text-muted-foreground md:table-cell md:px-4">
        {task.nextRun ? formatDate(task.nextRun) : '-'}
      </td>
      <td className="px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onRun(task)}
            disabled={task.status !== 'active'}
            aria-label="Run task"
            data-testid={`run-task-${task.id}`}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onToggleStatus(task)}
            aria-label={task.status === 'active' ? 'Pause task' : 'Resume task'}
            data-testid={`toggle-task-${task.id}`}
          >
            {task.status === 'active' ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 text-green-600" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(task)}
            aria-label="Edit task"
            data-testid={`edit-task-${task.id}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => onDelete(task)}
            aria-label="Delete task"
            data-testid={`delete-task-${task.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function TasksTable() {
  const { tasks, isLoading, error, updateTask, deleteTask, runTask } = useTasksStore();
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);

  const handleToggleStatus = async (task: Task) => {
    const newStatus = task.status === 'active' ? 'paused' : 'active';
    try {
      await updateTask(task.id, { status: newStatus });
    } catch {
      // error handled by store
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteTask(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch {
      // error handled by store
    }
  };

  const handleRun = async (task: Task) => {
    try {
      await runTask(task.id);
    } catch {
      // error handled by store
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="tasks-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tasks.length === 0 && error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        data-testid="tasks-error"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center" data-testid="tasks-empty">
        <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">No scheduled tasks</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a task to automate recurring operations.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto" data-testid="tasks-table">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
              <th className="px-3 py-2 sm:px-4">Name</th>
              <th className="px-3 py-2 sm:px-4">Server</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">Schedule</th>
              <th className="px-3 py-2 sm:px-4">Status</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">Last Run</th>
              <th className="hidden px-3 py-2 md:table-cell md:px-4">Next Run</th>
              <th className="px-3 py-2 sm:px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={setEditTask}
                onDelete={setDeleteConfirm}
                onToggleStatus={handleToggleStatus}
                onRun={handleRun}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Dialog */}
      <EditTaskDialog
        task={editTask}
        onClose={() => setEditTask(null)}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirm != null} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="delete-task-dialog">
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteConfirm?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} data-testid="confirm-delete">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Create Task Dialog ──

function CreateTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { createTask, isSubmitting } = useTasksStore();
  const { servers } = useServersStore();

  const [name, setName] = useState('');
  const [serverId, setServerId] = useState('');
  const [cron, setCron] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function resetForm() {
    setName('');
    setServerId('');
    setCron('');
    setCommand('');
    setDescription('');
    setErrors({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Task name is required';
    if (!serverId) errs.serverId = 'Server is required';
    if (!cron.trim()) errs.cron = 'Cron expression is required';
    if (cron.trim() && cron.trim().split(/\s+/).length !== 5) errs.cron = 'Invalid cron expression (must have 5 fields)';
    if (!command.trim()) errs.command = 'Command is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    const input: CreateTaskInput = {
      name: name.trim(),
      serverId,
      cron: cron.trim(),
      command: command.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    try {
      await createTask(input);
      handleClose();
    } catch {
      // error handled by store
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" data-testid="create-task-dialog">
        <DialogHeader>
          <DialogTitle>Create Scheduled Task</DialogTitle>
          <DialogDescription>
            Set up a new recurring task to run on a server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">Task Name</Label>
            <Input
              id="task-name"
              placeholder="e.g. MySQL Daily Backup"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              data-testid="input-task-name"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-server">Target Server</Label>
            <select
              id="task-server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.serverId}
              data-testid="input-task-server"
            >
              <option value="">Select a server...</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {errors.serverId && <p className="text-sm text-destructive">{errors.serverId}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-cron">Cron Expression</Label>
            <Input
              id="task-cron"
              placeholder="e.g. 0 2 * * *"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              aria-invalid={!!errors.cron}
              data-testid="input-task-cron"
            />
            {cron.trim() && cron.trim().split(/\s+/).length === 5 && (
              <p className="text-xs text-muted-foreground" data-testid="cron-description">
                {describeCron(cron.trim())}
              </p>
            )}
            {errors.cron && <p className="text-sm text-destructive">{errors.cron}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-command">Command</Label>
            <Input
              id="task-command"
              placeholder="e.g. mysqldump -u root mydb > /backup/db.sql"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              aria-invalid={!!errors.command}
              data-testid="input-task-command"
            />
            {errors.command && <p className="text-sm text-destructive">{errors.command}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description (optional)</Label>
            <Input
              id="task-description"
              placeholder="Brief description of what this task does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-task-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="submit-create-task">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Task Dialog ──

function EditTaskDialog({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const { updateTask, isSubmitting } = useTasksStore();

  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (task) {
      setName(task.name);
      setCron(task.cron);
      setCommand(task.command);
      setDescription(task.description ?? '');
      setErrors({});
    }
  }, [task]);

  function handleClose() {
    setErrors({});
    onClose();
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Task name is required';
    if (!cron.trim()) errs.cron = 'Cron expression is required';
    if (cron.trim() && cron.trim().split(/\s+/).length !== 5) errs.cron = 'Invalid cron expression (must have 5 fields)';
    if (!command.trim()) errs.command = 'Command is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!task || !validate()) return;
    const input: UpdateTaskInput = {
      name: name.trim(),
      cron: cron.trim(),
      command: command.trim(),
      description: description.trim() || undefined,
    };
    try {
      await updateTask(task.id, input);
      handleClose();
    } catch {
      // error handled by store
    }
  }

  return (
    <Dialog open={task != null} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="edit-task-dialog">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update the scheduled task configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-task-name">Task Name</Label>
            <Input
              id="edit-task-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              data-testid="edit-input-task-name"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-task-cron">Cron Expression</Label>
            <Input
              id="edit-task-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              aria-invalid={!!errors.cron}
              data-testid="edit-input-task-cron"
            />
            {cron.trim() && cron.trim().split(/\s+/).length === 5 && (
              <p className="text-xs text-muted-foreground">{describeCron(cron.trim())}</p>
            )}
            {errors.cron && <p className="text-sm text-destructive">{errors.cron}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-task-command">Command</Label>
            <Input
              id="edit-task-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              aria-invalid={!!errors.command}
              data-testid="edit-input-task-command"
            />
            {errors.command && <p className="text-sm text-destructive">{errors.command}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-task-description">Description (optional)</Label>
            <Input
              id="edit-task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="edit-input-task-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="submit-edit-task">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──

export function Tasks() {
  const { fetchTasks, filters, error, clearError } = useTasksStore();
  const { fetchServers } = useServersStore();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetchTasks();
    fetchServers();
  }, [fetchTasks, fetchServers]);

  useEffect(() => {
    fetchTasks();
  }, [filters, fetchTasks]);

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tasks-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Scheduled Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage recurring scheduled tasks across your servers.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="create-task-btn">
          <Plus className="mr-2 h-4 w-4" />
          Create Task
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearError}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Stats */}
      <StatsCards />

      {/* Filters */}
      <FilterBar />

      {/* Table */}
      <Card>
        <CardContent className="p-0 sm:p-0">
          <TasksTable />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
