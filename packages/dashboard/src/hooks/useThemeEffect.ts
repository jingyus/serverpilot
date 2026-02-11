// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect } from 'react';
import { useUiStore, type Theme } from '@/stores/ui';

/**
 * Resolves the effective theme class based on user preference.
 * When "system" is selected, defers to the OS prefers-color-scheme.
 */
export function resolveThemeClass(theme: Theme): 'dark' | 'light' {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  // system: check OS preference
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Applies the theme class to the document root element and
 * listens for OS preference changes when theme is "system".
 */
export function useThemeEffect(): void {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    function applyTheme(t: Theme) {
      const resolved = resolveThemeClass(t);
      root.classList.toggle('dark', resolved === 'dark');
    }

    applyTheme(theme);

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [theme]);
}
