// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTeamStore } from './team';

// Mock the API client
vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { apiRequest } from '@/api/client';
const mockApiRequest = vi.mocked(apiRequest);

describe('useTeamStore', () => {
  beforeEach(() => {
    useTeamStore.setState({
      members: [],
      invitations: [],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('fetchMembers', () => {
    it('should fetch and set members', async () => {
      const mockMembers = [
        { id: 'u1', email: 'a@b.com', name: 'A', role: 'owner', createdAt: '2026-01-01' },
      ];
      mockApiRequest.mockResolvedValueOnce({ members: mockMembers, total: 1 });

      await useTeamStore.getState().fetchMembers();

      expect(mockApiRequest).toHaveBeenCalledWith('/team/members');
      expect(useTeamStore.getState().members).toEqual(mockMembers);
      expect(useTeamStore.getState().isLoading).toBe(false);
    });

    it('should set error on failure', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useTeamStore.getState().fetchMembers();

      expect(useTeamStore.getState().error).toBe('Failed to load members');
      expect(useTeamStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchInvitations', () => {
    it('should fetch and set invitations', async () => {
      const mockInvitations = [
        { id: 'inv-1', email: 'x@y.com', status: 'pending' },
      ];
      mockApiRequest.mockResolvedValueOnce({ invitations: mockInvitations, total: 1 });

      await useTeamStore.getState().fetchInvitations();

      expect(mockApiRequest).toHaveBeenCalledWith('/team/invitations');
      expect(useTeamStore.getState().invitations).toEqual(mockInvitations);
    });
  });

  describe('createInvitation', () => {
    it('should create invitation and add to list', async () => {
      const mockInvitation = {
        id: 'inv-new',
        email: 'new@test.com',
        role: 'member',
        status: 'pending',
      };
      mockApiRequest.mockResolvedValueOnce({ invitation: mockInvitation });

      const result = await useTeamStore.getState().createInvitation('new@test.com', 'member');

      expect(mockApiRequest).toHaveBeenCalledWith('/team/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
      });
      expect(result).toEqual(mockInvitation);
      expect(useTeamStore.getState().invitations).toContain(mockInvitation);
    });

    it('should set error on failure', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('fail'));

      await expect(
        useTeamStore.getState().createInvitation('new@test.com', 'member'),
      ).rejects.toThrow();

      expect(useTeamStore.getState().error).toBe('Failed to send invitation');
    });
  });

  describe('cancelInvitation', () => {
    it('should cancel invitation and update status', async () => {
      useTeamStore.setState({
        invitations: [
          { id: 'inv-1', email: 'x@y.com', status: 'pending' } as never,
        ],
      });
      mockApiRequest.mockResolvedValueOnce(undefined);

      await useTeamStore.getState().cancelInvitation('inv-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/team/invitations/inv-1', { method: 'DELETE' });
      expect(useTeamStore.getState().invitations[0].status).toBe('cancelled');
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role', async () => {
      useTeamStore.setState({
        members: [
          { id: 'm1', email: 'a@b.com', name: 'A', role: 'member', createdAt: '2026-01-01' },
        ],
      });
      mockApiRequest.mockResolvedValueOnce(undefined);

      await useTeamStore.getState().updateMemberRole('m1', 'admin');

      expect(mockApiRequest).toHaveBeenCalledWith('/team/members/m1/role', {
        method: 'PUT',
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(useTeamStore.getState().members[0].role).toBe('admin');
    });
  });

  describe('removeMember', () => {
    it('should remove member from list', async () => {
      useTeamStore.setState({
        members: [
          { id: 'm1', email: 'a@b.com', name: 'A', role: 'member', createdAt: '2026-01-01' },
          { id: 'm2', email: 'b@b.com', name: 'B', role: 'admin', createdAt: '2026-01-01' },
        ],
      });
      mockApiRequest.mockResolvedValueOnce(undefined);

      await useTeamStore.getState().removeMember('m1');

      expect(mockApiRequest).toHaveBeenCalledWith('/team/members/m1', { method: 'DELETE' });
      expect(useTeamStore.getState().members).toHaveLength(1);
      expect(useTeamStore.getState().members[0].id).toBe('m2');
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      useTeamStore.setState({ error: 'some error' });
      useTeamStore.getState().clearError();
      expect(useTeamStore.getState().error).toBeNull();
    });
  });
});
