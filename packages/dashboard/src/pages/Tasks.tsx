// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }
> = {
  active: { labelKey: 'status.active', variant: 'default', icon: Play },
  paused: { labelKey: 'status.paused', variant: 'secondary', icon: Pause },
  deleted: { labelKey: 'status.deleted', variant: 'destructive', icon: XCircle },
};

const LAST_STATUS_CONFIG: Record<
  TaskLastStatus,
  { labelKey: string; variant: 'default' | 'destructive'; icon: typeof CheckCircle2 }
> = {
  success: { labelKey: 'status.success', variant: 'default', icon: CheckCircle2 },
  failed: { labelKey: 'status.failed', variant: 'destructive', icon: XCircle },
};

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

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  const config = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG.active;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`task-status-${status}`}>
      <Icon className="h-3 w-3" />
      {t(config.labelKey)}
    </Badge>
  );
}

function LastRunBadge({ lastStatus }: { lastStatus: TaskLastStatus | null | undefined }) {
  const { t } = useTranslation();
  if (!lastStatus) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="last-status-none">
        {t('status.neverRun')}
      </span>
    );
  }
  const config = LAST_STATUS_CONFIG[lastStatus] ?? LAST_STATUS_CONFIG.success;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`last-status-${lastStatus}`}>
      <Icon className="h-3 w-3" />
      {t(config.labelKey)}
    </Badge>
  );
}

function StatsCards() {
  const { t } = useTranslation();
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
              <p className="text-xs text-muted-foreground">{t('tasks.totalTasks')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
              <Play className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 sm:text-2xl">{active}</div>
              <p className="text-xs text-muted-foreground">{t('tasks.active')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400">
              <Pause className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-600 sm:text-2xl">{paused}</div>
              <p className="text-xs text-muted-foreground">{t('tasks.paused')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex gap-1 text-sm font-bold sm:text-base">
                <span className="text-green-600">{successCount}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-600">{failedCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('tasks.lastRunSF')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
  const { t } = useTranslation();
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
            <option value="">{t('tasks.allServers')}</option>
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
            <option value="">{t('tasks.allStatus')}</option>
            {(['active', 'paused'] as const).map((s) => (
              <option key={s} value={s}>{t(TASK_STATUS_CONFIG[s].labelKey)}</option>
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
              {t('common.reset')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface TaskItemProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onRun: (task: Task) => void;
}

function TaskActions({ task, onRun, onToggleStatus, onEdit, onDelete, idPrefix = '' }: TaskItemProps & { idPrefix?: string }) {
  const { t } = useTranslation();
  const p = idPrefix;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRun(task)} disabled={task.status !== 'active'} aria-label={t('tasks.runTask')} data-testid={`${p}run-task-${task.id}`}>
        <Play className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onToggleStatus(task)} aria-label={task.status === 'active' ? t('tasks.pauseTask') : t('tasks.resumeTask')} data-testid={`${p}toggle-task-${task.id}`}>
        {task.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-green-600" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(task)} aria-label={t('tasks.editTaskBtn')} data-testid={`${p}edit-task-${task.id}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(task)} aria-label={t('tasks.deleteTaskBtn')} data-testid={`${p}delete-task-${task.id}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function TaskCard(props: TaskItemProps) {
  const { task } = props;
  return (
    <Card data-testid={`task-card-${task.id}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{task.name}</span>
              <TaskStatusBadge status={task.status} />
            </div>
            <p className="text-xs text-muted-foreground">{task.serverName ?? task.serverId}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{task.cron}</code>
              <span className="text-xs text-muted-foreground">{describeCron(task.cron)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <LastRunBadge lastStatus={task.lastStatus} />
              {task.nextRun && <span>Next: {formatDate(task.nextRun)}</span>}
            </div>
          </div>
          <TaskActions {...props} idPrefix="m-" />
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow(props: TaskItemProps) {
  const { task } = props;
  return (
    <tr
      className="border-b border-border/50 transition-colors hover:bg-muted/50"
      data-testid={`task-row-${task.id}`}
    >
      <td className="px-3 py-3 text-sm font-medium sm:px-4">{task.name}</td>
      <td className="px-3 py-3 text-sm sm:px-4">{task.serverName ?? task.serverId}</td>
      <td className="hidden px-3 py-3 text-sm sm:table-cell sm:px-4">
        <div>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{task.cron}</code>
          <p className="mt-0.5 text-xs text-muted-foreground">{describeCron(task.cron)}</p>
        </div>
      </td>
      <td className="px-3 py-3 sm:px-4"><TaskStatusBadge status={task.status} /></td>
      <td className="hidden px-3 py-3 sm:table-cell sm:px-4"><LastRunBadge lastStatus={task.lastStatus} /></td>
      <td className="hidden px-3 py-3 text-xs text-muted-foreground md:table-cell md:px-4">{task.nextRun ? formatDate(task.nextRun) : '-'}</td>
      <td className="px-3 py-3 sm:px-4"><TaskActions {...props} /></td>
    </tr>
  );
}

function TasksTable() {
  const { t } = useTranslation();
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
        <p className="mt-2 text-sm text-muted-foreground">{t('tasks.noTasks')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('tasks.noTasksDesc')}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile card view */}
      <div className="space-y-2 p-2 sm:hidden" data-testid="tasks-table">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onEdit={setEditTask}
            onDelete={setDeleteConfirm}
            onToggleStatus={handleToggleStatus}
            onRun={handleRun}
          />
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden sm:block" data-testid="tasks-table-desktop">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
              <th className="px-3 py-2 sm:px-4">{t('tasks.tableHeaders.name')}</th>
              <th className="px-3 py-2 sm:px-4">{t('tasks.tableHeaders.server')}</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">{t('tasks.tableHeaders.schedule')}</th>
              <th className="px-3 py-2 sm:px-4">{t('tasks.tableHeaders.status')}</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">{t('tasks.tableHeaders.lastRun')}</th>
              <th className="hidden px-3 py-2 md:table-cell md:px-4">{t('tasks.tableHeaders.nextRun')}</th>
              <th className="px-3 py-2 sm:px-4">{t('tasks.tableHeaders.actions')}</th>
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
            <DialogTitle>{t('tasks.deleteTask')}</DialogTitle>
            <DialogDescription>
              {t('tasks.deleteTaskConfirm', { name: deleteConfirm?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} data-testid="confirm-delete">
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
          <DialogTitle>{t('tasks.createScheduledTask')}</DialogTitle>
          <DialogDescription>
            {t('tasks.createTaskDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">{t('tasks.taskName')}</Label>
            <Input
              id="task-name"
              placeholder={t('tasks.taskNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              data-testid="input-task-name"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-server">{t('tasks.targetServer')}</Label>
            <select
              id="task-server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.serverId}
              data-testid="input-task-server"
            >
              <option value="">{t('tasks.selectServer')}</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {errors.serverId && <p className="text-sm text-destructive">{errors.serverId}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-cron">{t('tasks.cronExpression')}</Label>
            <Input
              id="task-cron"
              placeholder={t('tasks.cronPlaceholder')}
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
            <Label htmlFor="task-command">{t('tasks.command')}</Label>
            <Input
              id="task-command"
              placeholder={t('tasks.commandPlaceholder')}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              aria-invalid={!!errors.command}
              data-testid="input-task-command"
            />
            {errors.command && <p className="text-sm text-destructive">{errors.command}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">{t('tasks.descriptionOptional')}</Label>
            <Input
              id="task-description"
              placeholder={t('tasks.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-task-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="submit-create-task">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('tasks.createTask')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTaskDialog({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
          <DialogTitle>{t('tasks.editTask')}</DialogTitle>
          <DialogDescription>
            {t('tasks.editTaskDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-task-name">{t('tasks.taskName')}</Label>
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
            <Label htmlFor="edit-task-cron">{t('tasks.cronExpression')}</Label>
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
            <Label htmlFor="edit-task-command">{t('tasks.command')}</Label>
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
            <Label htmlFor="edit-task-description">{t('tasks.descriptionOptional')}</Label>
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
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="submit-edit-task">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('tasks.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Tasks() {
  const { t } = useTranslation();
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('tasks.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('tasks.description')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto" data-testid="create-task-btn">
          <Plus className="mr-2 h-4 w-4" />
          {t('tasks.createTask')}
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
