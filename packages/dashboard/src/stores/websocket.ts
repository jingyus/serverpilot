import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface WebSocketState {
  status: ConnectionStatus;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  reconnectAttempt: number;
  error: string | null;

  setStatus: (status: ConnectionStatus) => void;
  setConnected: () => void;
  setDisconnected: (error?: string) => void;
  setReconnecting: (attempt: number) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  status: 'disconnected' as ConnectionStatus,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  reconnectAttempt: 0,
  error: null,
};

export const useWebSocketStore = create<WebSocketState>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  setConnected: () =>
    set({
      status: 'connected',
      lastConnectedAt: new Date().toISOString(),
      reconnectAttempt: 0,
      error: null,
    }),

  setDisconnected: (error) =>
    set({
      status: 'disconnected',
      lastDisconnectedAt: new Date().toISOString(),
      error: error ?? null,
    }),

  setReconnecting: (attempt) =>
    set({
      status: 'reconnecting',
      reconnectAttempt: attempt,
    }),

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
