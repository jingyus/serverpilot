// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Trash2,
  Edit,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Link,
  Send,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useWebhooksStore } from '@/stores/webhooks';
import { WEBHOOK_EVENT_TYPES, EVENT_LABELS } from '@/types/webhook';
import type { Webhook, WebhookEventType } from '@/types/webhook';

// ============================================================================
// Webhooks Page
// ============================================================================

export function Webhooks() {
  const { t } = useTranslation();
  const {
    webhooks,
    isLoading,
    error,
    fetchWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    testWebhook,
    clearError,
  } = useWebhooksStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<Webhook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);
  const [testTarget, setTestTarget] = useState<Webhook | null>(null);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleToggle = useCallback(async (webhook: Webhook) => {
    try {
      await updateWebhook(webhook.id, { enabled: !webhook.enabled });
    } catch { /* handled by store */ }
  }, [updateWebhook]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteWebhook(deleteTarget.id);
    } catch { /* handled by store */ }
    setDeleteTarget(null);
  }, [deleteTarget, deleteWebhook]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('webhooks.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('webhooks.description')}
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          {t('webhooks.addWebhook')}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearError}>
            {t('common.dismiss')}
          </Button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Link className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{t('webhooks.noWebhooks')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('webhooks.noWebhooksDesc')}
          </p>
          <Button className="mt-4" onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('webhooks.addFirstWebhook')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <WebhookCard
              key={webhook.id}
              webhook={webhook}
              onEdit={() => setEditTarget(webhook)}
              onDelete={() => setDeleteTarget(webhook)}
              onToggle={() => handleToggle(webhook)}
              onTest={() => setTestTarget(webhook)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <WebhookFormDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={async (name, url, events) => {
          await createWebhook(name, url, events);
          setShowAddDialog(false);
        }}
      />

      {editTarget && (
        <WebhookFormDialog
          open={true}
          onOpenChange={() => setEditTarget(null)}
          webhook={editTarget}
          onSubmit={async (name, url, events) => {
            await updateWebhook(editTarget.id, { name, url, events });
            setEditTarget(null);
          }}
        />
      )}

      <DeleteDialog
        open={!!deleteTarget}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <TestDialog
        open={!!testTarget}
        webhook={testTarget}
        onClose={() => setTestTarget(null)}
        onTest={testWebhook}
      />
    </div>
  );
}

// ============================================================================
// Webhook Card
// ============================================================================

function WebhookCard({
  webhook,
  onEdit,
  onDelete,
  onToggle,
  onTest,
}: {
  webhook: Webhook;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground">{webhook.name}</h3>
            <Badge variant={webhook.enabled ? 'default' : 'secondary'} className="text-xs">
              {webhook.enabled ? t('status.active') : t('status.disabled')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground break-all">{webhook.url}</p>
          <div className="flex flex-wrap gap-1 pt-1">
            {webhook.events.map((evt) => (
              <Badge key={evt} variant="outline" className="text-xs">
                {EVENT_LABELS[evt] ?? evt}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={onTest} title="Send test event">
            <Send className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title={webhook.enabled ? 'Disable' : 'Enable'}>
            {webhook.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} title="Edit">
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} title="Delete" className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Webhook Form Dialog (Create / Edit)
// ============================================================================

function WebhookFormDialog({
  open,
  onOpenChange,
  webhook,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: Webhook;
  onSubmit: (name: string, url: string, events: WebhookEventType[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<WebhookEventType[]>(webhook?.events ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleEvent = (evt: WebhookEventType) => {
    setEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setIsSubmitting(true);
    try {
      await onSubmit(name.trim(), url.trim(), events);
    } catch { /* handled by store */ } finally {
      setIsSubmitting(false);
    }
  };

  const isEdit = !!webhook;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('webhooks.editWebhook') : t('webhooks.addWebhook')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('webhooks.editWebhookDesc') : t('webhooks.addWebhookDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-name">{t('webhooks.webhookName')}</Label>
            <Input
              id="webhook-name"
              placeholder={t('webhooks.webhookNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">{t('webhooks.url')}</Label>
            <Input
              id="webhook-url"
              type="url"
              placeholder={t('webhooks.urlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('webhooks.events')}</Label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENT_TYPES.map((evt) => (
                <Button
                  key={evt}
                  variant={events.includes(evt) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleEvent(evt)}
                  type="button"
                >
                  {events.includes(evt) ? (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {EVENT_LABELS[evt]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !name.trim() || !url.trim() || events.length === 0}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t('webhooks.saveChanges') : t('webhooks.createWebhook')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Delete Confirmation Dialog
// ============================================================================

function DeleteDialog({
  open,
  name,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('webhooks.deleteWebhook')}</DialogTitle>
          <DialogDescription>
            {t('webhooks.deleteWebhookConfirm', { name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('common.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Test Event Dialog
// ============================================================================

function TestDialog({
  open,
  webhook,
  onClose,
  onTest,
}: {
  open: boolean;
  webhook: Webhook | null;
  onClose: () => void;
  onTest: (id: string, eventType: WebhookEventType) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selectedEvent, setSelectedEvent] = useState<WebhookEventType>('task.completed');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!webhook) return;
    setIsSending(true);
    try {
      await onTest(webhook.id, selectedEvent);
      setSent(true);
      setTimeout(() => { setSent(false); onClose(); }, 1500);
    } catch { /* handled by store */ } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('webhooks.sendTestEvent')}</DialogTitle>
          <DialogDescription>
            {t('webhooks.sendTestDesc', { name: webhook?.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>{t('webhooks.eventType')}</Label>
          <div className="flex flex-wrap gap-2">
            {WEBHOOK_EVENT_TYPES.map((evt) => (
              <Button
                key={evt}
                variant={selectedEvent === evt ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedEvent(evt)}
              >
                {EVENT_LABELS[evt]}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSend} disabled={isSending || sent}>
            {isSending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : sent ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {sent ? t('webhooks.sent') : t('webhooks.sendTest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
