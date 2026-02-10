import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUiStore } from './ui';

describe('useUiStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      theme: 'system',
      activeModal: null,
      breadcrumbs: [],
      commandPaletteOpen: false,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('sidebar', () => {
    it('starts with sidebar expanded', () => {
      expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    });

    it('toggles sidebar collapsed state', () => {
      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarCollapsed).toBe(true);

      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    });

    it('sets sidebar collapsed directly', () => {
      useUiStore.getState().setSidebarCollapsed(true);
      expect(useUiStore.getState().sidebarCollapsed).toBe(true);

      useUiStore.getState().setSidebarCollapsed(false);
      expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('mobile sidebar', () => {
    it('starts with mobile sidebar closed', () => {
      expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
    });

    it('sets mobile sidebar open state', () => {
      useUiStore.getState().setMobileSidebarOpen(true);
      expect(useUiStore.getState().mobileSidebarOpen).toBe(true);

      useUiStore.getState().setMobileSidebarOpen(false);
      expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
    });

    it('toggles mobile sidebar', () => {
      useUiStore.getState().toggleMobileSidebar();
      expect(useUiStore.getState().mobileSidebarOpen).toBe(true);

      useUiStore.getState().toggleMobileSidebar();
      expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
    });
  });

  describe('theme', () => {
    it('defaults to system theme', () => {
      expect(useUiStore.getState().theme).toBe('system');
    });

    it('sets theme and persists to localStorage', () => {
      useUiStore.getState().setTheme('dark');
      expect(useUiStore.getState().theme).toBe('dark');
      expect(localStorage.getItem('ui_theme')).toBe('dark');
    });

    it('sets theme to light', () => {
      useUiStore.getState().setTheme('light');
      expect(useUiStore.getState().theme).toBe('light');
      expect(localStorage.getItem('ui_theme')).toBe('light');
    });

    it('sets theme back to system', () => {
      useUiStore.getState().setTheme('dark');
      useUiStore.getState().setTheme('system');
      expect(useUiStore.getState().theme).toBe('system');
      expect(localStorage.getItem('ui_theme')).toBe('system');
    });
  });

  describe('modal', () => {
    it('starts with no active modal', () => {
      expect(useUiStore.getState().activeModal).toBeNull();
    });

    it('opens a modal', () => {
      useUiStore.getState().openModal('add-server');
      expect(useUiStore.getState().activeModal).toBe('add-server');
    });

    it('closes modal', () => {
      useUiStore.getState().openModal('add-server');
      useUiStore.getState().closeModal();
      expect(useUiStore.getState().activeModal).toBeNull();
    });

    it('replaces active modal when opening new one', () => {
      useUiStore.getState().openModal('add-server');
      useUiStore.getState().openModal('delete-server');
      expect(useUiStore.getState().activeModal).toBe('delete-server');
    });
  });

  describe('breadcrumbs', () => {
    it('starts with empty breadcrumbs', () => {
      expect(useUiStore.getState().breadcrumbs).toEqual([]);
    });

    it('sets breadcrumbs', () => {
      const crumbs = [
        { label: 'Servers', href: '/servers' },
        { label: 'web-prod-01' },
      ];
      useUiStore.getState().setBreadcrumbs(crumbs);
      expect(useUiStore.getState().breadcrumbs).toEqual(crumbs);
    });

    it('replaces breadcrumbs entirely', () => {
      useUiStore.getState().setBreadcrumbs([{ label: 'Old' }]);
      useUiStore.getState().setBreadcrumbs([{ label: 'New' }]);
      expect(useUiStore.getState().breadcrumbs).toEqual([{ label: 'New' }]);
    });
  });

  describe('command palette', () => {
    it('starts closed', () => {
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });

    it('sets command palette open state', () => {
      useUiStore.getState().setCommandPaletteOpen(true);
      expect(useUiStore.getState().commandPaletteOpen).toBe(true);

      useUiStore.getState().setCommandPaletteOpen(false);
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });

    it('toggles command palette', () => {
      useUiStore.getState().toggleCommandPalette();
      expect(useUiStore.getState().commandPaletteOpen).toBe(true);

      useUiStore.getState().toggleCommandPalette();
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });
  });
});
