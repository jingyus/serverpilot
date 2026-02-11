// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Polling hook that pauses when the page is not visible.
 * Resumes immediately on visibility change and resets the timer.
 */
export function usePolling(
  callback: () => void,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  enabled: boolean = true,
) {
  const savedCallback = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const tick = useCallback(() => {
    savedCallback.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function start() {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(tick, intervalMs);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        tick(); // fetch immediately on return
        start();
      } else {
        clearInterval(timerRef.current);
      }
    }

    // Only start if page is currently visible
    if (document.visibilityState === 'visible') {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [tick, intervalMs, enabled]);
}
