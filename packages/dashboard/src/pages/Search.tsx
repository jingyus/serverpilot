// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base search page
 *
 * Allows users to search for knowledge entries, filter by source,
 * and view detailed information about each entry.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, X, Loader2, BookOpen, Package, Brain, Users, Terminal } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useKnowledgeStore } from '@/stores/knowledge';
import { formatDate } from '@/utils/format';
import { cn } from '@/lib/utils';
import type { Knowledge, KnowledgeSource } from '@/types/knowledge';

const sourceIcons: Record<KnowledgeSource, typeof BookOpen> = {
  builtin: BookOpen,
  auto_learn: Brain,
  scrape: Package,
  community: Users,
};

const sourceLabels: Record<KnowledgeSource, string> = {
  builtin: 'Built-in',
  auto_learn: 'Auto Learn',
  scrape: 'Documentation',
  community: 'Community',
};

const sourceColors: Record<KnowledgeSource, string> = {
  builtin: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  auto_learn: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  scrape: 'bg-green-500/10 text-green-700 dark:text-green-400',
  community: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
};

export function Search() {
  const { t } = useTranslation();
  const {
    query,
    results,
    isSearching,
    error,
    selectedSource,
    selectedKnowledge,
    setQuery,
    setSelectedSource,
    search,
    selectKnowledge,
    clearError,
  } = useKnowledgeStore();

  const [inputValue, setInputValue] = useState(query);

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const handleSearch = () => {
    search(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSourceFilter = (source: KnowledgeSource | 'all') => {
    setSelectedSource(source);
    if (query) {
      search(query);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col sm:h-[calc(100vh-4rem)]" data-testid="search-page">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('search.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('search.description')}
            </p>
          </div>

          {/* Search input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('search.searchPlaceholder')}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-9"
                data-testid="search-input"
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('');
                    setQuery('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={t('search.clearSearch')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button onClick={handleSearch} disabled={isSearching || !inputValue.trim()} data-testid="search-button">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.search')}
            </Button>
          </div>

          {/* Source filters */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={selectedSource === 'all' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => handleSourceFilter('all')}
              data-testid="filter-all"
            >
              {t('search.allSources')}
            </Badge>
            {(['builtin', 'auto_learn', 'scrape', 'community'] as const).map((source) => (
              <Badge
                key={source}
                variant={selectedSource === source ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => handleSourceFilter(source)}
                data-testid={`filter-${source}`}
              >
                {sourceLabels[source]}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <Card className="mb-4 border-destructive bg-destructive/10">
            <CardContent className="flex items-center justify-between p-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="ghost" size="sm" onClick={clearError}>
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {isSearching ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('search.resultCount', { count: results.length, query })}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((knowledge) => (
                <KnowledgeCard
                  key={knowledge.id}
                  knowledge={knowledge}
                  onClick={() => selectKnowledge(knowledge)}
                />
              ))}
            </div>
          </div>
        ) : query ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <SearchIcon className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold text-foreground">{t('search.noResults')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('search.noResultsDesc')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold text-foreground">{t('search.searchPrompt')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('search.searchPromptDesc')}
            </p>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <KnowledgeDetailDialog
        knowledge={selectedKnowledge}
        onClose={() => selectKnowledge(null)}
      />
    </div>
  );
}

interface KnowledgeCardProps {
  knowledge: Knowledge;
  onClick: () => void;
}

function KnowledgeCard({ knowledge, onClick }: KnowledgeCardProps) {
  const { t } = useTranslation();
  const Icon = sourceIcons[knowledge.source];
  const sourceColor = sourceColors[knowledge.source];

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent"
      onClick={onClick}
      data-testid={`knowledge-card-${knowledge.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{knowledge.software}</CardTitle>
          <Badge className={cn('ml-2 gap-1', sourceColor)} variant="secondary">
            <Icon className="h-3 w-3" />
            {sourceLabels[knowledge.source]}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {t('search.platform', { value: knowledge.platform })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {knowledge.content.commands.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t('search.commands')}</p>
            <code className="block truncate rounded bg-muted px-2 py-1 text-xs">
              {knowledge.content.commands[0]}
            </code>
            {knowledge.content.commands.length > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('search.moreItems', { count: knowledge.content.commands.length - 1 })}
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('search.usedCount', { count: knowledge.successCount })}</span>
          {knowledge.lastUsed && <span>{formatDate(knowledge.lastUsed)}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

interface KnowledgeDetailDialogProps {
  knowledge: Knowledge | null;
  onClose: () => void;
}

function KnowledgeDetailDialog({ knowledge, onClose }: KnowledgeDetailDialogProps) {
  const { t } = useTranslation();

  if (!knowledge) return null;

  const Icon = sourceIcons[knowledge.source];
  const sourceColor = sourceColors[knowledge.source];

  return (
    <Dialog open={!!knowledge} onOpenChange={(open) => !open && onClose()}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={onClose}>
        <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="knowledge-detail-dialog">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-xl">{knowledge.software}</CardTitle>
                <CardDescription className="mt-1">
                  {t('search.platform', { value: knowledge.platform })}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Badge className={cn('gap-1', sourceColor)} variant="secondary">
                <Icon className="h-3 w-3" />
                {sourceLabels[knowledge.source]}
              </Badge>
              <Badge variant="outline">
                {t('search.usedCount', { count: knowledge.successCount })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Commands */}
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Terminal className="h-4 w-4" />
                {t('search.installationCommands')}
              </h3>
              <div className="space-y-2">
                {knowledge.content.commands.map((cmd, index) => (
                  <code
                    key={index}
                    className="block rounded bg-muted px-3 py-2 text-xs"
                  >
                    {cmd}
                  </code>
                ))}
              </div>
            </div>

            {/* Verification */}
            {knowledge.content.verification && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('search.verification')}</h3>
                <code className="block rounded bg-muted px-3 py-2 text-xs">
                  {knowledge.content.verification}
                </code>
              </div>
            )}

            {/* Notes */}
            {knowledge.content.notes && knowledge.content.notes.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('search.notes')}</h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {knowledge.content.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Metadata */}
            <div className="border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium">{t('search.created')}</p>
                  <p>{formatDate(knowledge.createdAt)}</p>
                </div>
                <div>
                  <p className="font-medium">{t('search.lastUpdated')}</p>
                  <p>{formatDate(knowledge.updatedAt)}</p>
                </div>
                {knowledge.lastUsed && (
                  <div>
                    <p className="font-medium">{t('search.lastUsed')}</p>
                    <p>{formatDate(knowledge.lastUsed)}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Dialog>
  );
}
