// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { AlertCircle, MessageSquarePlus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary, type FallbackProps } from '@/components/common/ErrorBoundary';

interface ChatErrorBoundaryProps {
  children: React.ReactNode;
  onNewSession: () => void;
}

function ChatErrorFallback({ error, resetErrorBoundary, onNewSession }: FallbackProps & { onNewSession: () => void }) {
  const { t } = useTranslation();
  const isDev = import.meta.env.DEV;

  return (
    <div
      role="alert"
      data-testid="chat-error-boundary"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {t('chat.error.renderFailed')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('chat.error.renderFailedDesc')}
        </p>
      </div>

      {isDev && (
        <pre
          data-testid="chat-error-details"
          className="max-h-40 w-full max-w-lg overflow-auto rounded-md bg-muted p-3 text-left text-xs text-destructive"
        >
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={resetErrorBoundary} data-testid="chat-error-retry">
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('error.tryAgain')}
        </Button>
        <Button variant="default" size="sm" onClick={onNewSession} data-testid="chat-error-new-session">
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          {t('chat.newSession')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Error boundary specialized for the Chat message area.
 * Catches rendering errors (e.g. malformed message content, markdown parse failures)
 * and shows a friendly fallback with retry + new session actions.
 */
export function ChatErrorBoundary({ children, onNewSession }: ChatErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(props: FallbackProps) => (
        <ChatErrorFallback {...props} onNewSession={onNewSession} />
      )}
      onError={(error) => {
        console.error('[ChatErrorBoundary] Message rendering error:', error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
