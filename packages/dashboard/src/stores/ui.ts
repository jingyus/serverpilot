// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface UiState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  theme: Theme;
  activeModal: string | null;
  breadcrumbs: Breadcrumb[];
  commandPaletteOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  setTheme: (theme: Theme) => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
  setBreadcrumbs: (breadcrumbs: Breadcrumb[]) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
}

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('ui_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  theme: getStoredTheme(),
  activeModal: null,
  breadcrumbs: [],
  commandPaletteOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),

  toggleMobileSidebar: () =>
    set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),

  setTheme: (theme) => {
    try {
      localStorage.setItem('ui_theme', theme);
    } catch {
      // localStorage unavailable
    }
    set({ theme });
  },

  openModal: (modalId) => set({ activeModal: modalId }),

  closeModal: () => set({ activeModal: null }),

  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
}));
