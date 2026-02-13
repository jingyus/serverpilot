// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { AvailableSkillCard } from './AvailableSkillCard';
import type { AvailableSkill } from '@/types/skill';

export interface AvailableTabProps {
  available: AvailableSkill[];
  onInstall: (skill: AvailableSkill) => void;
}

export function AvailableTab({ available, onInstall }: AvailableTabProps) {
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
