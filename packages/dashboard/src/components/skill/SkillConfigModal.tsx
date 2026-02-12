// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { InstalledSkill } from '@/types/skill';

// ============================================================================
// Input Definition (mirrors shared SkillInput)
// ============================================================================

export interface SkillInputDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'enum';
  required: boolean;
  default?: unknown;
  description: string;
  options?: string[];
}

// ============================================================================
// SkillConfigModal Component
// ============================================================================

export function SkillConfigModal({
  open,
  onOpenChange,
  skill,
  inputs,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: InstalledSkill;
  inputs: SkillInputDef[];
  onSubmit: (id: string, config: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    buildDefaults(inputs, skill.config),
  );

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(skill.id, values);
      onOpenChange(false);
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('skills.configureSkill')}</DialogTitle>
          <DialogDescription>
            {skill.displayName ?? skill.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {inputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('skills.noInputs')}</p>
          ) : (
            inputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={values[input.name]}
                onChange={(val) => setValue(input.name, val)}
              />
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('skills.saveConfig')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dynamic Input Field Renderer
// ============================================================================

function InputField({
  input,
  value,
  onChange,
}: {
  input: SkillInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `skill-input-${input.name}`;
  const requiredMark = input.required ? ' *' : '';

  switch (input.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor={id}>{input.name}{requiredMark}</Label>
            <p className="text-xs text-muted-foreground">{input.description}</p>
          </div>
          <Switch
            id={id}
            checked={!!value}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      );

    case 'number':
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{input.name}{requiredMark}</Label>
          <p className="text-xs text-muted-foreground">{input.description}</p>
          <Input
            id={id}
            type="number"
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
      );

    case 'enum':
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{input.name}{requiredMark}</Label>
          <p className="text-xs text-muted-foreground">{input.description}</p>
          <select
            id={id}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select...</option>
            {input.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );

    case 'string[]':
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{input.name}{requiredMark}</Label>
          <p className="text-xs text-muted-foreground">{input.description} (comma-separated)</p>
          <Input
            id={id}
            value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      );

    default: // string
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{input.name}{requiredMark}</Label>
          <p className="text-xs text-muted-foreground">{input.description}</p>
          <Input
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildDefaults(
  inputs: SkillInputDef[],
  existingConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const input of inputs) {
    if (existingConfig && input.name in existingConfig) {
      defaults[input.name] = existingConfig[input.name];
    } else if (input.default !== undefined) {
      defaults[input.name] = input.default;
    }
  }
  return defaults;
}
