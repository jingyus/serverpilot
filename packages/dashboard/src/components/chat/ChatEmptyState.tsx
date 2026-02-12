// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ChatEmptyStateProps {
  serverName: string;
  onSuggestionClick: (text: string) => void;
  disabled: boolean;
}

export function ChatEmptyState({ serverName, onSuggestionClick, disabled }: ChatEmptyStateProps) {
  const { t } = useTranslation();

  const suggestions = [
    t('chat.suggestion1'),
    t('chat.suggestion2'),
    t('chat.suggestion3'),
    t('chat.suggestion4'),
  ];

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-4 sm:gap-4 sm:p-8"
      data-testid="empty-state"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-16 sm:w-16">
        <Bot className="h-6 w-6 sm:h-8 sm:w-8" />
      </div>
      <div className="text-center">
        <h2 className="text-base font-semibold sm:text-lg">{t('chat.startConversation')}</h2>
        <p className="mt-1 max-w-md text-xs text-muted-foreground sm:text-sm">
          {t('chat.startConversationDesc', { name: serverName })}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion, index) => (
          <Card
            key={suggestion}
            className={cn(
              'transition-colors',
              disabled
                ? 'pointer-events-none opacity-50'
                : 'cursor-pointer hover:bg-muted/50'
            )}
            onClick={() => onSuggestionClick(suggestion)}
            data-testid={`suggestion-card-${index}`}
          >
            <CardContent className="px-2 py-1.5 text-xs text-muted-foreground sm:px-3 sm:py-2 sm:text-sm">
              {suggestion}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
