// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Document source management section for the Settings page.
 *
 * Displays a list of configured documentation sources with options to
 * add, edit, delete, and manually trigger fetches.
 */

import { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  RefreshCw,
  Github,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useDocSourcesStore } from '@/stores/doc-sources';
import type { DocSource, CreateDocSourceInput } from '@/types/doc-source';

// ============================================================================
// Add Dialog
// ============================================================================

function AddDocSourceDialog({ onClose }: { onClose: () => void }) {
  const { createSource, isSaving } = useDocSourcesStore();

  const [type, setType] = useState<'github' | 'website'>('github');
  const [name, setName] = useState('');
  const [software, setSoftware] = useState('');

  // GitHub fields
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [paths, setPaths] = useState('');

  // Website fields
  const [baseUrl, setBaseUrl] = useState('');

  // Options
  const [autoUpdate, setAutoUpdate] = useState(false);

  const handleSubmit = async () => {
    const input: CreateDocSourceInput = {
      name,
      software,
      type,
      autoUpdate,
      enabled: true,
    };

    if (type === 'github') {
      input.githubConfig = {
        owner,
        repo,
        branch: branch || undefined,
        paths: paths ? paths.split(',').map((p) => p.trim()) : undefined,
      };
    } else {
      input.websiteConfig = {
        baseUrl,
      };
    }

    try {
      await createSource(input);
      onClose();
    } catch {
      // Error is handled by store
    }
  };

  const isValid =
    name.trim() !== '' &&
    software.trim() !== '' &&
    (type === 'github' ? owner.trim() !== '' && repo.trim() !== '' : baseUrl.trim() !== '');

  return (
    <div className="space-y-4">
      {/* Source Type */}
      <div className="space-y-2">
        <Label>Source Type</Label>
        <div className="flex gap-2">
          <Button
            variant={type === 'github' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setType('github')}
            data-testid="type-github"
          >
            <Github className="mr-1.5 h-4 w-4" />
            GitHub
          </Button>
          <Button
            variant={type === 'website' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setType('website')}
            data-testid="type-website"
          >
            <Globe className="mr-1.5 h-4 w-4" />
            Website
          </Button>
        </div>
      </div>

      {/* Common fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ds-name">Name</Label>
          <Input
            id="ds-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Nginx Docs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-software">Software</Label>
          <Input
            id="ds-software"
            value={software}
            onChange={(e) => setSoftware(e.target.value)}
            placeholder="e.g., nginx"
          />
        </div>
      </div>

      {/* Type-specific fields */}
      {type === 'github' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ds-owner">Owner</Label>
              <Input
                id="ds-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g., nginx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-repo">Repository</Label>
              <Input
                id="ds-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="e.g., nginx"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ds-branch">Branch (optional)</Label>
              <Input
                id="ds-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-paths">Paths (comma-separated)</Label>
              <Input
                id="ds-paths"
                value={paths}
                onChange={(e) => setPaths(e.target.value)}
                placeholder="docs/, README.md"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="ds-url">Base URL</Label>
          <Input
            id="ds-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://docs.example.com"
          />
        </div>
      )}

      {/* Auto-update toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="ds-auto-update">Auto Update</Label>
          <p className="text-xs text-muted-foreground">
            Periodically check for documentation updates
          </p>
        </div>
        <Switch
          id="ds-auto-update"
          checked={autoUpdate}
          onCheckedChange={setAutoUpdate}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!isValid || isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Adding...
            </>
          ) : (
            'Add Source'
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <Badge variant="outline">Not fetched</Badge>;
  }
  if (status === 'success') {
    return (
      <Badge variant="outline" className="border-green-500/50 text-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Success
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="border-red-500/50 text-red-700">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Clock className="mr-1 h-3 w-3" />
      {status}
    </Badge>
  );
}

// ============================================================================
// Source Item
// ============================================================================

function DocSourceItem({ source }: { source: DocSource }) {
  const { deleteSource, triggerFetch, updateSource, fetchingSources } = useDocSourcesStore();
  const isFetching = fetchingSources.has(source.id);

  const handleDelete = async () => {
    try {
      await deleteSource(source.id);
    } catch {
      // Error handled by store
    }
  };

  const handleFetch = async () => {
    try {
      await triggerFetch(source.id);
    } catch {
      // Error handled by store
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    try {
      await updateSource(source.id, { enabled });
    } catch {
      // Error handled by store
    }
  };

  return (
    <div
      className="flex items-center justify-between rounded-md border p-3"
      data-testid={`doc-source-${source.id}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {source.type === 'github' ? (
            <Github className="h-4 w-4" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{source.name}</span>
            <Badge variant="secondary" className="text-xs shrink-0">
              {source.software}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={source.lastFetchStatus} />
            {source.documentCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {source.documentCount} docs
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={source.enabled}
          onCheckedChange={handleToggleEnabled}
          aria-label={`Toggle ${source.name}`}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleFetch}
          disabled={isFetching || !source.enabled}
          title="Fetch now"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="text-destructive hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Section
// ============================================================================

export function DocSourceSection() {
  const { sources, isLoading, error, fetchSources, clearError } = useDocSourcesStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return (
    <div className="space-y-4" data-testid="doc-source-section">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Document Sources</Label>
          <p className="text-xs text-muted-foreground">
            Configure external documentation sources for the knowledge base
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" data-testid="add-doc-source-btn">
              <Plus className="mr-1.5 h-4 w-4" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Documentation Source</DialogTitle>
              <DialogDescription>
                Add a GitHub repository or website as a documentation source for the knowledge base.
              </DialogDescription>
            </DialogHeader>
            <AddDocSourceDialog onClose={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={clearError} className="h-auto p-0.5">
            Dismiss
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No documentation sources configured yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a GitHub repo or website URL to start building your knowledge base.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <DocSourceItem key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}
