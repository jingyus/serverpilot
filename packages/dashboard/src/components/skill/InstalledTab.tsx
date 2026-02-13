// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle, Loader2, History, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SkillCard } from './SkillCard';
import type { InstalledSkill } from '@/types/skill';

export interface InstalledTabProps {
  skills: InstalledSkill[];
  onToggle: (skill: InstalledSkill) => void;
  onConfigure: (skill: InstalledSkill) => void;
  onExecute: (skill: InstalledSkill) => void;
  onUninstall: (skill: InstalledSkill) => void;
  onHistory: (skill: InstalledSkill) => void;
  onUpgrade: (skill: InstalledSkill) => void;
  isUpgrading: string | null;
  onExport: (skill: InstalledSkill) => void;
  isExporting: string | null;
  onImport: (file: File) => void;
  isImporting: boolean;
}

export function InstalledTab({
  skills,
  onToggle,
  onConfigure,
  onExecute,
  onUninstall,
  onHistory,
  onUpgrade,
  isUpgrading,
  onExport,
  isExporting,
  onImport,
  isImporting,
}: InstalledTabProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <input
          ref={fileInputRef}
          type="file"
          accept=".tar.gz,.tgz"
          className="hidden"
          onChange={handleFileChange}
          data-testid="import-file-input"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          data-testid="import-skill-btn"
        >
          {isImporting ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1 h-4 w-4" />
          )}
          {t('skills.importSkill')}
        </Button>
      </div>

      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Puzzle className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{t('skills.noSkills')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('skills.noSkillsDesc')}</p>
        </div>
      ) : (
        skills.map((skill) => (
          <div key={skill.id} className="relative">
            <SkillCard
              skill={skill}
              onToggle={() => onToggle(skill)}
              onConfigure={() => onConfigure(skill)}
              onExecute={() => onExecute(skill)}
              onUninstall={() => onUninstall(skill)}
              onUpgrade={() => onUpgrade(skill)}
              isUpgrading={isUpgrading === skill.id}
              onExport={() => onExport(skill)}
              isExporting={isExporting === skill.id}
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
        ))
      )}
    </div>
  );
}
