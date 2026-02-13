// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, Pencil, ChevronDown, ChevronRight, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';

export interface SessionItem {
  id: string;
  createdAt: string;
  lastMessage?: string;
  messageCount: number;
  name?: string | null;
}

export interface SessionSidebarProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  serverId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  isLoading: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function getSessionDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'thisWeek';
  return 'older';
}

export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return sessions;
  return sessions.filter((s) => {
    const name = (s.name ?? '').toLowerCase();
    const msg = (s.lastMessage ?? '').toLowerCase();
    return name.includes(trimmed) || msg.includes(trimmed);
  });
}

export function highlightText(text: string, query: string): (string | { highlight: string })[] {
  const trimmed = query.trim();
  if (!trimmed) return [text];
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part) =>
    regex.test(part) ? { highlight: part } : part,
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const parts = highlightText(text, query);
  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 rounded-sm" data-testid="search-highlight">
            {part.highlight}
          </mark>
        ),
      )}
    </>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (v: string) => {
      setLocalValue(v);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(v), 300);
    },
    [onChange],
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="relative" data-testid="session-search">
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        className="w-full rounded border bg-background py-1 pl-7 pr-7 text-xs outline-none focus:border-primary"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        data-testid="session-search-input"
      />
      {localValue && (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
          onClick={() => handleChange('')}
          aria-label="Clear search"
          data-testid="session-search-clear"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

function SessionItemRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  editingId,
  setEditingId,
  searchQuery,
  t,
}: {
  session: SessionItem;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  searchQuery: string;
  t: (key: string) => string;
}) {
  const isEditing = editingId === session.id;
  const displayTitle = session.name || session.lastMessage || t('chat.newSession');
  const [editValue, setEditValue] = useState(displayTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayTitle) {
      onRename(session.id, trimmed);
    }
    setEditingId(null);
  };

  const handleCancel = () => {
    setEditValue(displayTitle);
    setEditingId(null);
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayTitle);
    setEditingId(session.id);
  };

  return (
    <div
      className={cn(
        'group flex items-center justify-between rounded-md px-2 py-1.5 text-sm',
        'cursor-pointer hover:bg-muted',
        isActive && 'bg-muted',
      )}
      onClick={() => !isEditing && onSelect(session.id)}
      data-testid={`session-item-${session.id}`}
    >
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="w-full rounded border bg-background px-1 text-xs font-medium outline-none focus:border-primary"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') handleCancel();
            }}
            onBlur={handleSave}
            onClick={(e) => e.stopPropagation()}
            data-testid={`rename-input-${session.id}`}
          />
        ) : (
          <p className="truncate text-xs font-medium">
            <HighlightedText text={displayTitle} query={searchQuery} />
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {formatDate(session.createdAt)} &middot; {session.messageCount} msgs
        </p>
      </div>
      {!isEditing && (
        <div className="ml-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted-foreground/10"
            onClick={handleStartEdit}
            aria-label="Rename session"
            data-testid={`rename-session-${session.id}`}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            aria-label="Delete session"
            data-testid={`delete-session-${session.id}`}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarContent({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  isLoading,
  collapsedGroups,
  toggleGroup,
  searchQuery,
  noResultsText,
  t,
}: {
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  isLoading: boolean;
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (group: string) => void;
  searchQuery: string;
  noResultsText: string;
  t: (key: string) => string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const grouped: Record<string, SessionItem[]> = {};
  for (const session of sessions) {
    const group = getSessionDateGroup(session.createdAt);
    (grouped[group] ??= []).push(session);
  }
  const groupOrder = ['today', 'yesterday', 'thisWeek', 'older'];
  const sortedGroups = groupOrder.filter((g) => grouped[g]?.length);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (searchQuery.trim() && sortedGroups.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-muted-foreground" data-testid="session-search-empty">
        {noResultsText}
      </div>
    );
  }

  return (
    <div className="p-1">
      {sortedGroups.map((group) => (
        <div key={group} data-testid={`session-group-${group}`}>
          <button
            type="button"
            className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
            onClick={() => toggleGroup(group)}
            data-testid={`session-group-toggle-${group}`}
          >
            {collapsedGroups[group] ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {t(`chat.sessionGroup.${group}`)}
          </button>
          {!collapsedGroups[group] && (
            <div className="space-y-0.5">
              {grouped[group].map((session) => (
                <SessionItemRow
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onRename={onRename}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  searchQuery={searchQuery}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  serverId,
  onSelect,
  onDelete,
  onRename,
  isLoading,
  mobileOpen = false,
  onMobileClose,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  if (sessions.length === 0 && !isLoading) return null;

  const filteredSessions = filterSessions(sessions, searchQuery);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const noResultsText = t('chat.noSearchResults');

  const sharedProps = {
    sessions: filteredSessions,
    activeSessionId,
    onSelect,
    onDelete,
    onRename,
    isLoading,
    collapsedGroups,
    toggleGroup,
    searchQuery,
    noResultsText,
    t,
  };

  return (
    <>
      {/* Desktop sidebar — always visible on lg+ */}
      <div
        className="hidden w-56 shrink-0 overflow-y-auto rounded-lg border lg:block"
        data-testid="session-sidebar"
      >
        <div className="border-b px-3 py-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('chat.sessions')}
          </h3>
        </div>
        <div className="px-2 pt-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t('chat.searchSessions')}
          />
        </div>
        <SidebarContent {...sharedProps} />
      </div>

      {/* Mobile overlay sidebar — shown via hamburger toggle */}
      {mobileOpen && (
        <div className="lg:hidden" data-testid="mobile-session-sidebar">
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={onMobileClose}
            data-testid="mobile-sidebar-backdrop"
          />
          {/* Panel */}
          <div className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto border-r bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {t('chat.sessions')}
              </h3>
              <button
                type="button"
                onClick={onMobileClose}
                className="rounded p-1 hover:bg-muted"
                data-testid="mobile-sidebar-close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-2 pt-2">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('chat.searchSessions')}
              />
            </div>
            <SidebarContent {...sharedProps} />
          </div>
        </div>
      )}
    </>
  );
}
