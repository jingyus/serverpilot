// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAlertsStore } from '@/stores/alerts';
import { useServersStore } from '@/stores/servers';
import type {
  AlertRule,
  AlertSeverity,
  MetricType,
  ComparisonOperator,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '@/types/dashboard';

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

const METRIC_LABELS: Record<MetricType, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  disk: 'Disk',
};

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

interface RuleFormProps {
  open: boolean;
  onClose: () => void;
  editRule?: AlertRule | null;
}

export function RuleFormDialog({ open, onClose, editRule }: RuleFormProps) {
  const { createRule, updateRule } = useAlertsStore();
  const { servers, fetchServers } = useServersStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    serverId: '',
    name: '',
    metricType: 'cpu' as MetricType,
    operator: 'gt' as ComparisonOperator,
    threshold: 80,
    severity: 'warning' as AlertSeverity,
    cooldownMinutes: 5,
  });

  useEffect(() => {
    if (open && servers.length === 0) fetchServers();
  }, [open, servers.length, fetchServers]);

  useEffect(() => {
    if (editRule) {
      setForm({
        serverId: editRule.serverId,
        name: editRule.name,
        metricType: editRule.metricType,
        operator: editRule.operator,
        threshold: editRule.threshold,
        severity: editRule.severity,
        cooldownMinutes: editRule.cooldownMinutes ?? 5,
      });
    } else {
      setForm({
        serverId: '',
        name: '',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 80,
        severity: 'warning',
        cooldownMinutes: 5,
      });
    }
    setError(null);
  }, [editRule, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.serverId || !form.name) {
      setError('Server and rule name are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (editRule) {
        const update: UpdateAlertRuleInput = {
          name: form.name,
          metricType: form.metricType,
          operator: form.operator,
          threshold: form.threshold,
          severity: form.severity,
          cooldownMinutes: form.cooldownMinutes,
        };
        await updateRule(editRule.id, update);
      } else {
        const input: CreateAlertRuleInput = { ...form };
        await createRule(input);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="rule-form-dialog">
        <DialogHeader>
          <DialogTitle>{editRule ? 'Edit Alert Rule' : 'Create Alert Rule'}</DialogTitle>
          <DialogDescription>
            {editRule ? 'Modify the alert rule configuration.' : 'Set up a threshold-based alert for a server metric.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rule-server">Server</Label>
            <select
              id="rule-server"
              value={form.serverId}
              onChange={(e) => setForm({ ...form, serverId: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!!editRule}
            >
              <option value="">Select server...</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-name">Rule Name</Label>
            <Input
              id="rule-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., High CPU Alert"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rule-metric">Metric</Label>
              <select
                id="rule-metric"
                value={form.metricType}
                onChange={(e) => setForm({ ...form, metricType: e.target.value as MetricType })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['cpu', 'memory', 'disk'] as const).map((m) => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-operator">Operator</Label>
              <select
                id="rule-operator"
                value={form.operator}
                onChange={(e) => setForm({ ...form, operator: e.target.value as ComparisonOperator })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['gt', 'lt', 'gte', 'lte'] as const).map((op) => (
                  <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-threshold">Threshold %</Label>
              <Input
                id="rule-threshold"
                type="number"
                min={0}
                max={100}
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rule-severity">Severity</Label>
              <select
                id="rule-severity"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value as AlertSeverity })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['info', 'warning', 'critical'] as const).map((s) => (
                  <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-cooldown">Cooldown (min)</Label>
              <Input
                id="rule-cooldown"
                type="number"
                min={1}
                max={1440}
                value={form.cooldownMinutes}
                onChange={(e) => setForm({ ...form, cooldownMinutes: Number(e.target.value) })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editRule ? 'Save Changes' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirmation ──

export function DeleteRuleDialog({
  rule,
  onClose,
}: {
  rule: AlertRule | null;
  onClose: () => void;
}) {
  const { deleteRule } = useAlertsStore();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!rule) return;
    setDeleting(true);
    try {
      await deleteRule(rule.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={rule != null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm" data-testid="delete-rule-dialog">
        <DialogHeader>
          <DialogTitle>Delete Alert Rule</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{rule?.name}&quot;? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
