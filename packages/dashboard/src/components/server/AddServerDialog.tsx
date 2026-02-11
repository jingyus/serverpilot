// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
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
  .min(1, 'Server name is required')
  .max(100, 'Server name must be 100 characters or less')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'Name must start with a letter or number and contain only letters, numbers, dots, hyphens, or underscores'
  );

const tagSchema = z.string().min(1).max(50);

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, tags?: string[]) => Promise<{ token: string; installCommand: string }>;
}

export function AddServerDialog({ open, onOpenChange, onAdd }: AddServerDialogProps) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ token: string; installCommand: string } | null>(null);

  function resetState() {
    setName('');
    setNameError('');
    setTagInput('');
    setTags([]);
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

  async function handleSubmit() {
    const parsed = serverNameSchema.safeParse(name.trim());
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      return;
    }
    setNameError('');
    setIsSubmitting(true);
    try {
      const data = await onAdd(parsed.data, tags.length > 0 ? tags : undefined);
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
          <DialogTitle>Add Server</DialogTitle>
          <DialogDescription>
            {result
              ? 'Run this command on your server to install the agent.'
              : 'Enter a name and optional tags for your new server.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <TokenDisplay token={result.token} installCommand={result.installCommand} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">Server Name</Label>
              <Input
                id="server-name"
                placeholder="e.g. production-web-01"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              <Label htmlFor="server-tags">Tags (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="server-tags"
                  placeholder="e.g. production"
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
                  Add
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
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Server
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
