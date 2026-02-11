// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach } from 'vitest';
import i18n from 'i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

/**
 * Recursively collect all leaf keys from a nested object.
 * Returns a sorted array of dot-separated paths, e.g. ["common.save", "nav.dashboard"].
 */
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

describe('i18n', () => {
  describe('translation file structure', () => {
    it('should have en.json and zh.json with matching keys', () => {
      const enKeys = collectKeys(en);
      const zhKeys = collectKeys(zh);

      // Both files must have the same set of keys
      expect(enKeys).toEqual(zhKeys);
    });

    it('should have at least 100 translation keys', () => {
      const enKeys = collectKeys(en);
      expect(enKeys.length).toBeGreaterThanOrEqual(100);
    });

    it('should have no empty translation values in en.json', () => {
      const enKeys = collectKeys(en);
      for (const key of enKeys) {
        const value = i18n.t(key, { lng: 'en' });
        expect(value, `Key "${key}" has empty value`).toBeTruthy();
      }
    });

    it('should have no empty translation values in zh.json', () => {
      const zhKeys = collectKeys(zh);
      for (const key of zhKeys) {
        const value = i18n.t(key, { lng: 'zh' });
        // zh values may fall back to en if not yet translated
        expect(value, `Key "${key}" has empty value`).toBeTruthy();
      }
    });

    it('should have all required top-level namespaces', () => {
      const namespaces = Object.keys(en);
      const required = [
        'common', 'nav', 'header', 'connection', 'error', 'status',
        'severity', 'risk', 'action', 'role', 'dashboard', 'servers',
        'serverDetail', 'chat', 'search', 'settings', 'login',
        'tasks', 'operations', 'alerts', 'auditLog', 'webhooks', 'team',
      ];
      for (const ns of required) {
        expect(namespaces, `Missing namespace "${ns}"`).toContain(ns);
      }
    });
  });

  describe('language switching', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('should default to English', () => {
      expect(i18n.language).toBe('en');
    });

    it('should translate a key in English', () => {
      expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    });

    it('should switch to Chinese and translate correctly', async () => {
      await i18n.changeLanguage('zh');
      expect(i18n.language).toBe('zh');
      expect(i18n.t('nav.dashboard')).toBe('仪表盘');
    });

    it('should switch back to English', async () => {
      await i18n.changeLanguage('zh');
      await i18n.changeLanguage('en');
      expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    });

    it('should handle interpolation', () => {
      expect(i18n.t('chat.server', { name: 'web-01' })).toBe('Server: web-01');
    });

    it('should handle interpolation in Chinese', async () => {
      await i18n.changeLanguage('zh');
      expect(i18n.t('chat.server', { name: 'web-01' })).toBe('服务器：web-01');
    });
  });

  describe('localStorage persistence', () => {
    it('should export setStoredLanguage and supportedLanguages', async () => {
      const mod = await import('./index');
      expect(typeof mod.setStoredLanguage).toBe('function');
      expect(mod.supportedLanguages).toBeInstanceOf(Array);
      expect(mod.supportedLanguages.length).toBeGreaterThanOrEqual(2);
    });

    it('should store language in localStorage', async () => {
      const { setStoredLanguage } = await import('./index');
      setStoredLanguage('zh');
      expect(localStorage.getItem('serverpilot_language')).toBe('zh');

      // Clean up
      setStoredLanguage('en');
    });
  });
});
