// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { AvailableSkill } from '@/types/skill';
import { SKILL_SOURCE_LABELS } from '@/types/skill';

// ============================================================================
// AvailableSkillCard Props
// ============================================================================

export interface AvailableSkillCardProps {
  skill: AvailableSkill;
  onInstall: () => void;
}

// ============================================================================
// AvailableSkillCard Component
// ============================================================================

export function AvailableSkillCard({
  skill,
  onInstall,
}: AvailableSkillCardProps) {
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
