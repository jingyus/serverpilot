// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';

export interface SessionItem {
  id: string;
  createdAt: string;
  lastMessage?: string;
  messageCount: number;
}

export interface SessionSidebarProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  serverId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
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

function SidebarContent({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  isLoading,
  collapsedGroups,
  toggleGroup,
  t,
}: {
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (group: string) => void;
  t: (key: string) => string;
}) {
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
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center justify-between rounded-md px-2 py-1.5 text-sm',
                    'cursor-pointer hover:bg-muted',
                    session.id === activeSessionId && 'bg-muted'
                  )}
                  onClick={() => onSelect(session.id)}
                  data-testid={`session-item-${session.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {session.lastMessage ?? t('chat.newSession')}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(session.createdAt)} &middot;{' '}
                      {session.messageCount} msgs
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ml-1 hidden shrink-0 rounded p-0.5 hover:bg-destructive/10 group-hover:block"
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
  isLoading,
  mobileOpen = false,
  onMobileClose,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  if (sessions.length === 0 && !isLoading) return null;

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const sharedProps = {
    sessions,
    activeSessionId,
    onSelect,
    onDelete,
    isLoading,
    collapsedGroups,
    toggleGroup,
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
            <SidebarContent {...sharedProps} />
          </div>
        </div>
      )}
    </>
  );
}
