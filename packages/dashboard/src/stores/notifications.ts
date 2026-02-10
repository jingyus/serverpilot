import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  dismissible?: boolean;
  createdAt: number;
}

interface NotificationsState {
  notifications: Notification[];
  add: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION = 5000;
let counter = 0;

function generateId(): string {
  return `notif-${Date.now()}-${++counter}`;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],

  add: (notification) => {
    const id = generateId();
    const entry: Notification = {
      ...notification,
      id,
      createdAt: Date.now(),
      dismissible: notification.dismissible ?? true,
    };

    set((state) => ({
      notifications: [...state.notifications, entry],
    }));

    const duration = notification.duration ?? DEFAULT_DURATION;
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }

    return id;
  },

  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clear: () => set({ notifications: [] }),
}));
