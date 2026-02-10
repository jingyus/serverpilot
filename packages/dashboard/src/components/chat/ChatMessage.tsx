import { Bot, User, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

const ROLE_CONFIG = {
  user: {
    icon: User,
    align: 'justify-end' as const,
    bubble: 'bg-primary text-primary-foreground',
    iconBg: 'bg-primary/10 text-primary',
  },
  assistant: {
    icon: Bot,
    align: 'justify-start' as const,
    bubble: 'bg-muted text-foreground',
    iconBg: 'bg-blue-100 text-blue-600',
  },
  system: {
    icon: Info,
    align: 'justify-center' as const,
    bubble: 'bg-yellow-50 text-yellow-800 border border-yellow-200',
    iconBg: 'bg-yellow-100 text-yellow-600',
  },
};

export function ChatMessage({ message }: ChatMessageProps) {
  const config = ROLE_CONFIG[message.role];
  const Icon = config.icon;

  if (message.role === 'system') {
    return (
      <div className="flex justify-center px-2 py-2 sm:px-4" data-testid="chat-message-system">
        <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-xs sm:px-4 sm:text-sm', config.bubble)}>
          <Icon className="h-4 w-4 shrink-0" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div
      className={cn('flex gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3', config.align)}
      data-testid={`chat-message-${message.role}`}
    >
      {!isUser && (
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8',
            config.iconBg
          )}
        >
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      )}

      <div className={cn('max-w-[85%] space-y-1 sm:max-w-[75%]', isUser && 'items-end')}>
        <div className={cn('rounded-2xl px-3 py-2 text-sm sm:px-4 sm:py-2.5', config.bubble)}>
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          {formatDate(message.timestamp)}
        </p>
      </div>

      {isUser && (
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8',
            config.iconBg
          )}
        >
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      )}
    </div>
  );
}
