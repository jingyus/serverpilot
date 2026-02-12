// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ExecutionStream } from '@/components/skill/ExecutionStream';

// ============================================================================
// ExecuteDialog Props
// ============================================================================

export interface ExecuteDialogProps {
  open: boolean;
  skillName: string;
  servers: { id: string; name: string; status: string }[];
  selectedServerId: string;
  onServerChange: (id: string) => void;
  executionId: string | null;
  isExecuting: boolean;
  onExecute: () => void;
  onClose: () => void;
}

// ============================================================================
// ExecuteDialog Component
// ============================================================================

export function ExecuteDialog({
  open,
  skillName,
  servers,
  selectedServerId,
  onServerChange,
  executionId,
  isExecuting,
  onExecute,
  onClose,
}: ExecuteDialogProps) {
  const { t } = useTranslation();
  const onlineServers = servers.filter((s) => s.status === 'online');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('skills.executeSkill')}</DialogTitle>
          <DialogDescription>{skillName}</DialogDescription>
        </DialogHeader>

        {executionId ? (
          <ExecutionStream executionId={executionId} />
        ) : (
          <div className="space-y-4">
            {onlineServers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('skills.noServers')}</p>
            ) : (
              <div className="space-y-2">
                <label htmlFor="exec-server" className="text-sm font-medium">
                  {t('skills.selectServer')}
                </label>
                <select
                  id="exec-server"
                  value={selectedServerId}
                  onChange={(e) => onServerChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="exec-server-select"
                >
                  <option value="">{t('skills.selectServer')}</option>
                  {onlineServers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {executionId ? (
            <Button onClick={onClose}>{t('common.dismiss')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                onClick={onExecute}
                disabled={!selectedServerId || isExecuting}
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('skills.executing')}
                  </>
                ) : (
                  t('skills.execute')
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
