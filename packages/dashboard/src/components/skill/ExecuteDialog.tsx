// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Eye, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import type { SkillExecutionResult } from '@/types/skill';

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
  dryRun?: boolean;
  onDryRunChange?: (enabled: boolean) => void;
  onPreview?: () => void;
  isPreviewing?: boolean;
  dryRunResult?: SkillExecutionResult | null;
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
  dryRun,
  onDryRunChange,
  onPreview,
  isPreviewing,
  dryRunResult,
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
              <>
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
                {onDryRunChange && (
                  <label className="flex items-center gap-2 text-sm" data-testid="dry-run-toggle">
                    <input
                      type="checkbox"
                      checked={!!dryRun}
                      onChange={(e) => onDryRunChange(e.target.checked)}
                      className="rounded border-input"
                    />
                    <span className="font-medium">{t('skills.dryRun')}</span>
                    <span className="text-muted-foreground">{t('skills.dryRunDesc')}</span>
                  </label>
                )}
              </>
            )}

            {/* Dry-run result preview */}
            {dryRunResult && <DryRunResultPanel result={dryRunResult} />}
          </div>
        )}

        <DialogFooter>
          {executionId ? (
            <Button onClick={onClose}>{t('common.dismiss')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              {onPreview && (
                <Button
                  variant="secondary"
                  onClick={onPreview}
                  disabled={!selectedServerId || isPreviewing || isExecuting}
                  data-testid="preview-btn"
                >
                  {isPreviewing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('skills.previewing')}
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-4 w-4" />
                      {t('skills.preview')}
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={onExecute}
                disabled={!selectedServerId || isExecuting}
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('skills.executing')}
                  </>
                ) : dryRun ? (
                  t('skills.dryRunExecute')
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

// ============================================================================
// DryRunResultPanel — inline preview of dry-run output
// ============================================================================

function DryRunResultPanel({ result }: { result: SkillExecutionResult }) {
  const { t } = useTranslation();
  const output =
    result.result && typeof (result.result as Record<string, unknown>).output === 'string'
      ? (result.result as Record<string, unknown>).output as string
      : null;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2" data-testid="dry-run-result">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-semibold" data-testid="dry-run-badge">
          {t('skills.dryRunBadge')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {result.status === 'success' ? t('skills.execStatus.success') : t(`skills.execStatus.${result.status}`)}
        </span>
      </div>
      {output && (
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground" data-testid="dry-run-output">
          {output}
        </pre>
      )}
      {result.errors.length > 0 && (
        <ul className="space-y-1">
          {result.errors.map((err, i) => (
            <li key={i} className="text-xs text-destructive">{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
