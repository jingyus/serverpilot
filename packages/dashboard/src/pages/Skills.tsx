// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Puzzle,
  Plus,
  Loader2,
  AlertCircle,
  Download,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useSkillsStore } from '@/stores/skills';
import { useServersStore } from '@/stores/servers';
import { SkillCard } from '@/components/skill/SkillCard';
import { SkillConfigModal } from '@/components/skill/SkillConfigModal';
import { ExecutionHistory } from '@/components/skill/ExecutionHistory';
import { ExecutionStream } from '@/components/skill/ExecutionStream';
import type { InstalledSkill, AvailableSkill } from '@/types/skill';
import { SKILL_SOURCE_LABELS } from '@/types/skill';
import type { SkillInputDef } from '@/components/skill/SkillConfigModal';

// ============================================================================
// Tab Type
// ============================================================================

type Tab = 'installed' | 'available';

// ============================================================================
// Skills Page
// ============================================================================

export function Skills() {
  const { t } = useTranslation();
  const {
    skills,
    available,
    executions,
    isLoading,
    error,
    fetchSkills,
    fetchAvailable,
    installSkill,
    uninstallSkill,
    configureSkill,
    updateStatus,
    executeSkill,
    fetchExecutions,
    clearSelectedExecution,
    clearError,
  } = useSkillsStore();

  const { servers, fetchServers } = useServersStore();

  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [configTarget, setConfigTarget] = useState<InstalledSkill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstalledSkill | null>(null);
  const [historyTarget, setHistoryTarget] = useState<InstalledSkill | null>(null);
  const [executeTarget, setExecuteTarget] = useState<InstalledSkill | null>(null);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    fetchSkills();
    fetchAvailable();
    fetchServers();
  }, [fetchSkills, fetchAvailable, fetchServers]);

  useEffect(() => {
    if (historyTarget) {
      fetchExecutions(historyTarget.id);
    }
  }, [historyTarget, fetchExecutions]);

  const handleToggle = useCallback(async (skill: InstalledSkill) => {
    const nextStatus = skill.status === 'enabled' ? 'paused' : 'enabled';
    try {
      await updateStatus(skill.id, nextStatus);
    } catch { /* handled by store */ }
  }, [updateStatus]);

  const handleInstall = useCallback(async (avail: AvailableSkill) => {
    try {
      await installSkill(avail.dirPath, avail.source);
    } catch { /* handled by store */ }
  }, [installSkill]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await uninstallSkill(deleteTarget.id);
    } catch { /* handled by store */ }
    setDeleteTarget(null);
  }, [deleteTarget, uninstallSkill]);

  const handleConfigure = useCallback(async (id: string, config: Record<string, unknown>) => {
    await configureSkill(id, config);
  }, [configureSkill]);

  const handleExecuteConfirm = useCallback(async () => {
    if (!executeTarget || !selectedServerId) return;
    setIsExecuting(true);
    try {
      const result = await executeSkill(executeTarget.id, selectedServerId);
      setExecutionId(result.executionId);
    } catch { /* handled by store */ }
    setIsExecuting(false);
  }, [executeTarget, selectedServerId, executeSkill]);

  const handleExecuteClose = useCallback(() => {
    setExecuteTarget(null);
    setSelectedServerId('');
    setExecutionId(null);
    setIsExecuting(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('skills.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('skills.description')}</p>
        </div>
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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <TabButton
          active={activeTab === 'installed'}
          onClick={() => setActiveTab('installed')}
          label={t('skills.installed')}
          count={skills.length}
        />
        <TabButton
          active={activeTab === 'available'}
          onClick={() => setActiveTab('available')}
          label={t('skills.available')}
          count={available.length}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : activeTab === 'installed' ? (
        <InstalledTab
          skills={skills}
          onToggle={handleToggle}
          onConfigure={setConfigTarget}
          onExecute={setExecuteTarget}
          onUninstall={setDeleteTarget}
          onHistory={setHistoryTarget}
        />
      ) : (
        <AvailableTab
          available={available}
          onInstall={handleInstall}
        />
      )}

      {/* Config Modal */}
      {configTarget && (
        <SkillConfigModal
          open={true}
          onOpenChange={() => setConfigTarget(null)}
          skill={configTarget}
          inputs={getSkillInputs(configTarget)}
          onSubmit={handleConfigure}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteDialog
        open={!!deleteTarget}
        name={deleteTarget?.displayName ?? deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Execution History */}
      {historyTarget && (
        <Dialog open={true} onOpenChange={() => { clearSelectedExecution(); setHistoryTarget(null); }}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('skills.executionHistory')}</DialogTitle>
              <DialogDescription>
                {historyTarget.displayName ?? historyTarget.name}
              </DialogDescription>
            </DialogHeader>
            <ExecutionHistory
              executions={executions}
              onReExecute={(skillId, serverId) => {
                clearSelectedExecution();
                setHistoryTarget(null);
                // Find the skill and open execute dialog
                const skill = skills.find((s) => s.id === skillId);
                if (skill) {
                  setExecuteTarget(skill);
                  setSelectedServerId(serverId);
                }
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Execute Skill Dialog */}
      <ExecuteDialog
        open={!!executeTarget}
        skillName={executeTarget?.displayName ?? executeTarget?.name ?? ''}
        servers={servers}
        selectedServerId={selectedServerId}
        onServerChange={setSelectedServerId}
        executionId={executionId}
        isExecuting={isExecuting}
        onExecute={handleExecuteConfirm}
        onClose={handleExecuteClose}
      />
    </div>
  );
}

// ============================================================================
// Tab Button
// ============================================================================

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {label}
      <Badge variant="secondary" className="ml-2 text-xs">
        {count}
      </Badge>
    </button>
  );
}

// ============================================================================
// Installed Skills Tab
// ============================================================================

function InstalledTab({
  skills,
  onToggle,
  onConfigure,
  onExecute,
  onUninstall,
  onHistory,
}: {
  skills: InstalledSkill[];
  onToggle: (skill: InstalledSkill) => void;
  onConfigure: (skill: InstalledSkill) => void;
  onExecute: (skill: InstalledSkill) => void;
  onUninstall: (skill: InstalledSkill) => void;
  onHistory: (skill: InstalledSkill) => void;
}) {
  const { t } = useTranslation();

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Puzzle className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">{t('skills.noSkills')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('skills.noSkillsDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {skills.map((skill) => (
        <div key={skill.id} className="relative">
          <SkillCard
            skill={skill}
            onToggle={() => onToggle(skill)}
            onConfigure={() => onConfigure(skill)}
            onExecute={() => onExecute(skill)}
            onUninstall={() => onUninstall(skill)}
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-2 bottom-1 text-xs text-muted-foreground"
            onClick={() => onHistory(skill)}
          >
            <History className="mr-1 h-3 w-3" />
            {t('skills.history')}
          </Button>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Available Skills Tab
// ============================================================================

function AvailableTab({
  available,
  onInstall,
}: {
  available: AvailableSkill[];
  onInstall: (skill: AvailableSkill) => void;
}) {
  const { t } = useTranslation();

  if (available.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Download className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">{t('skills.noAvailable')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('skills.noAvailableDesc')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {available.map((avail) => (
        <AvailableSkillCard
          key={avail.dirPath}
          skill={avail}
          onInstall={() => onInstall(avail)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Available Skill Card
// ============================================================================

function AvailableSkillCard({
  skill,
  onInstall,
}: {
  skill: AvailableSkill;
  onInstall: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-foreground">{skill.manifest.displayName}</h3>
              <Badge variant="outline" className="text-xs">
                v{skill.manifest.version}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {SKILL_SOURCE_LABELS[skill.source]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{skill.manifest.description}</p>
            {skill.manifest.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {skill.manifest.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={onInstall}
            disabled={skill.installed}
          >
            {skill.installed ? (
              t('skills.alreadyInstalled')
            ) : (
              <>
                <Plus className="mr-1 h-3 w-3" />
                {t('skills.install')}
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          by {skill.manifest.author}
        </p>
      </CardContent>
    </Card>
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
          <DialogTitle>{t('skills.uninstallSkill')}</DialogTitle>
          <DialogDescription>
            {t('skills.uninstallConfirm', { name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('skills.uninstall')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Execute Dialog
// ============================================================================

function ExecuteDialog({
  open,
  skillName,
  servers,
  selectedServerId,
  onServerChange,
  executionId,
  isExecuting,
  onExecute,
  onClose,
}: {
  open: boolean;
  skillName: string;
  servers: { id: string; name: string; status: string }[];
  selectedServerId: string;
  onServerChange: (id: string) => void;
  executionId: string | null;
  isExecuting: boolean;
  onExecute: () => void;
  onClose: () => void;
}) {
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract SkillInputDef[] from the skill's manifest inputs (provided by server API).
 * Falls back to inferring from config keys for backward compatibility.
 */
function getSkillInputs(skill: InstalledSkill): SkillInputDef[] {
  // Prefer manifest inputs from server API
  if (skill.inputs && skill.inputs.length > 0) {
    return skill.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      required: input.required,
      default: input.default,
      description: input.description,
      options: input.options,
    }));
  }

  // Fallback: infer from config keys (backward compatibility)
  if (!skill.config) return [];
  return Object.entries(skill.config).map(([key, value]) => ({
    name: key,
    type: inferType(value),
    required: false,
    default: value,
    description: `Configuration for ${key}`,
  }));
}

function inferType(value: unknown): SkillInputDef['type'] {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'string[]';
  return 'string';
}
