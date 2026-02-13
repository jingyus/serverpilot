// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TokenDisplay } from './TokenDisplay';

const serverNameSchema = z
  .string()
  .min(1, 'servers.serverNameRequired')
  .max(100, 'servers.serverNameTooLong')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'servers.serverNameInvalid'
  );

const tagSchema = z.string().min(1).max(50);

function RequiredMark() {
  return <span className="text-destructive ml-0.5" aria-hidden="true">*</span>;
}

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, tags?: string[], group?: string) => Promise<{ token: string; installCommand: string }>;
  availableGroups?: string[];
}

export function AddServerDialog({ open, onOpenChange, onAdd, availableGroups = [] }: AddServerDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ token: string; installCommand: string } | null>(null);

  function resetState() {
    setName('');
    setNameError('');
    setTagInput('');
    setTags([]);
    setGroup('');
    setResult(null);
    setIsSubmitting(false);
  }

  function handleClose() {
    resetState();
    onOpenChange(false);
  }

  function handleAddTag() {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    const parsed = tagSchema.safeParse(trimmed);
    if (!parsed.success) return;
    if (tags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) return;
    setTags([...tags, trimmed]);
    setTagInput('');
  }

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function validateName(value: string): string {
    const parsed = serverNameSchema.safeParse(value);
    if (!parsed.success) return t(parsed.error.issues[0].message);
    return '';
  }

  function handleNameBlur() {
    const error = validateName(name.trim());
    setNameError(error);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (nameError) setNameError('');
  }

  async function handleSubmit() {
    const error = validateName(name.trim());
    if (error) {
      setNameError(error);
      return;
    }
    setNameError('');
    setIsSubmitting(true);
    try {
      const trimmedGroup = group.trim() || undefined;
      const data = await onAdd(name.trim(), tags.length > 0 ? tags : undefined, trimmedGroup);
      setResult({ token: data.token, installCommand: data.installCommand });
    } catch {
      // error handled by store
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('servers.addServerTitle')}</DialogTitle>
          <DialogDescription>
            {result
              ? t('servers.addServerInstallDesc')
              : t('servers.addServerDesc')}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <TokenDisplay token={result.token} installCommand={result.installCommand} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">{t('servers.serverName')}<RequiredMark /></Label>
              <Input
                id="server-name"
                placeholder={t('servers.serverNamePlaceholder')}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={handleNameBlur}
                aria-invalid={!!nameError}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
              {nameError && (
                <p className="text-sm text-destructive" data-testid="name-error">
                  {nameError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-tags">{t('servers.tagsOptional')}</Label>
              <div className="flex gap-2">
                <Input
                  id="server-tags"
                  placeholder={t('servers.tagPlaceholder')}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim()}
                  aria-label="Add tag"
                >
                  {t('servers.addTag')}
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1" data-testid="tag-list">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => handleRemoveTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-group">{t('servers.groupOptional')}</Label>
              <Input
                id="server-group"
                list="group-suggestions"
                placeholder={t('servers.groupPlaceholder')}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                maxLength={100}
              />
              {availableGroups.length > 0 && (
                <datalist id="group-suggestions">
                  {availableGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={handleClose}>{t('servers.done')}</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('servers.addServerBtn')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
