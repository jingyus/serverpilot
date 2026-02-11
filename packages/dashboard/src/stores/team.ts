// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';
import { apiRequest, ApiError } from '@/api/client';
import type {
  Invitation,
  TeamMember,
  InvitationsResponse,
  InvitationResponse,
  MembersResponse,
} from '@/types/team';

interface TeamState {
  members: TeamMember[];
  invitations: Invitation[];
  isLoading: boolean;
  error: string | null;

  fetchMembers: () => Promise<void>;
  fetchInvitations: () => Promise<void>;
  createInvitation: (email: string, role: 'admin' | 'member') => Promise<Invitation>;
  cancelInvitation: (id: string) => Promise<void>;
  updateMemberRole: (id: string, role: 'admin' | 'member') => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  members: [],
  invitations: [],
  isLoading: false,
  error: null,

  fetchMembers: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<MembersResponse>('/team/members');
      set({ members: data.members, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load members';
      set({ error: message, isLoading: false });
    }
  },

  fetchInvitations: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<InvitationsResponse>('/team/invitations');
      set({ invitations: data.invitations, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load invitations';
      set({ error: message, isLoading: false });
    }
  },

  createInvitation: async (email, role) => {
    set({ error: null });
    try {
      const data = await apiRequest<InvitationResponse>('/team/invite', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      set({ invitations: [...get().invitations, data.invitation] });
      return data.invitation;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to send invitation';
      set({ error: message });
      throw err;
    }
  },

  cancelInvitation: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/team/invitations/${id}`, { method: 'DELETE' });
      set({
        invitations: get().invitations.map((inv) =>
          inv.id === id ? { ...inv, status: 'cancelled' as const } : inv,
        ),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel invitation';
      set({ error: message });
      throw err;
    }
  },

  updateMemberRole: async (id, role) => {
    set({ error: null });
    try {
      await apiRequest(`/team/members/${id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      set({
        members: get().members.map((m) =>
          m.id === id ? { ...m, role } : m,
        ),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update role';
      set({ error: message });
      throw err;
    }
  },

  removeMember: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/team/members/${id}`, { method: 'DELETE' });
      set({ members: get().members.filter((m) => m.id !== id) });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove member';
      set({ error: message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
