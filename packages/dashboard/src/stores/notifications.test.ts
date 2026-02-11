// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useNotificationsStore } from './notifications';

describe('useNotificationsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationsStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('add', () => {
    it('adds a notification with generated id and timestamp', () => {
      useNotificationsStore.getState().add({
        type: 'success',
        title: 'Server added',
        message: 'web-prod-01 has been added successfully',
      });

      const { notifications } = useNotificationsStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('success');
      expect(notifications[0].title).toBe('Server added');
      expect(notifications[0].message).toBe('web-prod-01 has been added successfully');
      expect(notifications[0].id).toMatch(/^notif-/);
      expect(notifications[0].createdAt).toBeGreaterThan(0);
      expect(notifications[0].dismissible).toBe(true);
    });

    it('returns the notification id', () => {
      const id = useNotificationsStore.getState().add({
        type: 'info',
        title: 'Test',
      });

      expect(id).toMatch(/^notif-/);
    });

    it('adds multiple notifications', () => {
      const store = useNotificationsStore.getState();
      store.add({ type: 'success', title: 'First' });
      store.add({ type: 'error', title: 'Second' });
      store.add({ type: 'warning', title: 'Third' });

      expect(useNotificationsStore.getState().notifications).toHaveLength(3);
    });

    it('auto-dismisses after default duration', () => {
      useNotificationsStore.getState().add({
        type: 'success',
        title: 'Auto dismiss',
      });

      expect(useNotificationsStore.getState().notifications).toHaveLength(1);

      vi.advanceTimersByTime(5000);

      expect(useNotificationsStore.getState().notifications).toHaveLength(0);
    });

    it('uses custom duration for auto-dismiss', () => {
      useNotificationsStore.getState().add({
        type: 'info',
        title: 'Custom duration',
        duration: 2000,
      });

      vi.advanceTimersByTime(1999);
      expect(useNotificationsStore.getState().notifications).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(useNotificationsStore.getState().notifications).toHaveLength(0);
    });

    it('does not auto-dismiss when duration is 0', () => {
      useNotificationsStore.getState().add({
        type: 'error',
        title: 'Persistent',
        duration: 0,
      });

      vi.advanceTimersByTime(60000);
      expect(useNotificationsStore.getState().notifications).toHaveLength(1);
    });

    it('respects dismissible flag', () => {
      useNotificationsStore.getState().add({
        type: 'error',
        title: 'Not dismissible',
        dismissible: false,
        duration: 0,
      });

      expect(useNotificationsStore.getState().notifications[0].dismissible).toBe(false);
    });

    it('defaults dismissible to true', () => {
      useNotificationsStore.getState().add({
        type: 'info',
        title: 'Dismissible by default',
      });

      expect(useNotificationsStore.getState().notifications[0].dismissible).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('removes a specific notification', () => {
      const id1 = useNotificationsStore.getState().add({
        type: 'success',
        title: 'First',
        duration: 0,
      });
      useNotificationsStore.getState().add({
        type: 'error',
        title: 'Second',
        duration: 0,
      });

      useNotificationsStore.getState().dismiss(id1);

      const { notifications } = useNotificationsStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('Second');
    });

    it('does nothing when dismissing non-existent id', () => {
      useNotificationsStore.getState().add({
        type: 'info',
        title: 'Existing',
        duration: 0,
      });

      useNotificationsStore.getState().dismiss('non-existent');

      expect(useNotificationsStore.getState().notifications).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('removes all notifications', () => {
      const store = useNotificationsStore.getState();
      store.add({ type: 'success', title: 'First', duration: 0 });
      store.add({ type: 'error', title: 'Second', duration: 0 });
      store.add({ type: 'warning', title: 'Third', duration: 0 });

      useNotificationsStore.getState().clear();

      expect(useNotificationsStore.getState().notifications).toHaveLength(0);
    });

    it('works on empty notifications', () => {
      useNotificationsStore.getState().clear();
      expect(useNotificationsStore.getState().notifications).toHaveLength(0);
    });
  });

  describe('notification types', () => {
    it.each(['success', 'error', 'warning', 'info'] as const)(
      'supports %s notification type',
      (type) => {
        useNotificationsStore.getState().add({
          type,
          title: `${type} notification`,
          duration: 0,
        });

        expect(useNotificationsStore.getState().notifications[0].type).toBe(type);
      }
    );
  });
});
