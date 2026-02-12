// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';

export function Skills() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('skills.title')}</h1>
        <p className="text-muted-foreground">{t('skills.description')}</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12">
        <Puzzle className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-sm text-muted-foreground">{t('skills.noSkills')}</p>
      </div>
    </div>
  );
}
