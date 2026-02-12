// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Bot, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ChatHeaderProps {
  serverName: string;
  sessionId: string | null;
  onNewSession: () => void;
}

export function ChatHeader({ serverName, sessionId, onNewSession }: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center justify-between border-b px-2 py-2 sm:px-4 sm:py-3"
      data-testid="chat-header"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-9 sm:w-9">
          <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold sm:text-lg">{t('chat.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {t('chat.server', { name: serverName })}
            {sessionId && (
              <span className="ml-2">
                {t('chat.session', { id: `${sessionId.slice(0, 8)}...` })}
              </span>
            )}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onNewSession}
        data-testid="new-session-btn"
        className="shrink-0"
      >
        <MessageSquarePlus className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">{t('chat.newChat')}</span>
      </Button>
    </div>
  );
}
