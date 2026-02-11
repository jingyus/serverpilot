// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const loadingVariants = cva('flex items-center justify-center', {
  variants: {
    /** Visual style of the loading indicator */
    variant: {
      spinner: '',
      skeleton: 'animate-pulse rounded-md bg-muted',
      dots: '',
    },
    /** Size of the loading indicator */
    size: {
      sm: 'gap-1.5',
      md: 'gap-2',
      lg: 'gap-3',
    },
    /** Whether the loading indicator fills its parent container */
    fullscreen: {
      true: 'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'spinner',
    size: 'md',
    fullscreen: false,
  },
});

const spinnerSizeMap = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const;

const textSizeMap = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
} as const;

const skeletonSizeMap = {
  sm: 'h-4 w-full',
  md: 'h-8 w-full',
  lg: 'h-12 w-full',
} as const;

const dotSizeMap = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-3 w-3',
} as const;

export interface LoadingProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof loadingVariants> {
  /** Optional text to display alongside the loading indicator */
  text?: string;
}

/** Spinner variant: rotating icon with optional text */
function SpinnerContent({ size, text }: { size: 'sm' | 'md' | 'lg'; text?: string }) {
  return (
    <>
      <Loader2 className={cn('animate-spin text-muted-foreground', spinnerSizeMap[size])} />
      {text && (
        <span className={cn('text-muted-foreground', textSizeMap[size])}>{text}</span>
      )}
    </>
  );
}

/** Dots variant: three bouncing dots */
function DotsContent({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const dotClass = cn('rounded-full bg-muted-foreground/60', dotSizeMap[size]);
  return (
    <>
      <span className={cn(dotClass, 'animate-bounce')} style={{ animationDelay: '0ms' }} />
      <span className={cn(dotClass, 'animate-bounce')} style={{ animationDelay: '150ms' }} />
      <span className={cn(dotClass, 'animate-bounce')} style={{ animationDelay: '300ms' }} />
    </>
  );
}

/**
 * Loading state component with multiple visual variants.
 *
 * @example
 * ```tsx
 * // Default spinner
 * <Loading />
 *
 * // Spinner with text
 * <Loading text="Loading data..." />
 *
 * // Skeleton placeholder
 * <Loading variant="skeleton" />
 *
 * // Bouncing dots
 * <Loading variant="dots" />
 *
 * // Fullscreen overlay
 * <Loading fullscreen text="Please wait..." />
 * ```
 */
const Loading = React.forwardRef<HTMLDivElement, LoadingProps>(
  ({ className, variant = 'spinner', size = 'md', fullscreen = false, text, ...props }, ref) => {
    const resolvedSize = size ?? 'md';

    return (
      <div
        ref={ref}
        role="status"
        aria-label={text ?? 'Loading'}
        className={cn(
          loadingVariants({ variant, size: resolvedSize, fullscreen }),
          variant === 'skeleton' && skeletonSizeMap[resolvedSize],
          className,
        )}
        {...props}
      >
        {variant === 'spinner' && <SpinnerContent size={resolvedSize} text={text} />}
        {variant === 'dots' && <DotsContent size={resolvedSize} />}
        {variant === 'skeleton' && <span className="sr-only">{text ?? 'Loading'}</span>}
      </div>
    );
  },
);
Loading.displayName = 'Loading';

export { Loading, loadingVariants };
