// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
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

export function SessionSidebar({
  sessions,
  activeSessionId,
  serverId,
  onSelect,
  onDelete,
  isLoading,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  if (sessions.length === 0 && !isLoading) return null;

  // Group sessions by date
  const grouped: Record<string, typeof sessions> = {};
  for (const session of sessions) {
    const group = getSessionDateGroup(session.createdAt);
    (grouped[group] ??= []).push(session);
  }
  const groupOrder = ['today', 'yesterday', 'thisWeek', 'older'];
  const sortedGroups = groupOrder.filter((g) => grouped[g]?.length);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div
      className="hidden w-56 shrink-0 overflow-y-auto rounded-lg border lg:block"
      data-testid="session-sidebar"
    >
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t('chat.sessions')}
        </h3>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
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
      )}
    </div>
  );
}
