// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Props for custom fallback UI rendered when an error is caught */
export interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback component to render on error */
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  /** Callback fired when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Callback fired when the boundary is reset */
  onReset?: () => void;
  /** Additional CSS class for the default fallback container */
  className?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary that catches React rendering errors and displays
 * a fallback UI with retry capability.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    const { fallback } = this.props;

    if (typeof fallback === 'function') {
      return fallback({
        error: this.state.error,
        resetErrorBoundary: this.resetErrorBoundary,
      });
    }

    if (fallback !== undefined) {
      return fallback;
    }

    return (
      <DefaultFallback
        error={this.state.error}
        resetErrorBoundary={this.resetErrorBoundary}
        className={this.props.className}
      />
    );
  }
}

interface DefaultFallbackProps extends FallbackProps {
  className?: string;
}

function DefaultFallback({ error, resetErrorBoundary, className }: DefaultFallbackProps) {
  const { t } = useTranslation();
  const isDev = import.meta.env.DEV;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 p-8 text-center',
        className,
      )}
    >
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{t('error.somethingWentWrong')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('error.unexpectedError')}
        </p>
      </div>

      {isDev && (
        <pre className="max-h-40 w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs text-destructive">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      )}

      <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
        <RefreshCw className="mr-2 h-4 w-4" />
        {t('error.tryAgain')}
      </Button>
    </div>
  );
}
