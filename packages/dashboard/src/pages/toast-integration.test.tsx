// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useNotificationsStore } from '@/stores/notifications';
import { useTeamStore } from '@/stores/team';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { Team } from './Team';
import { Settings } from './Settings';

// Mock DocSourceSection to avoid dependency issues
vi.mock('@/components/knowledge/DocSourceSection', () => ({
  DocSourceSection: () => <div data-testid="doc-source-section">DocSourceSection</div>,
}));

describe('Toast Notification Integration', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] });
  });

  describe('Team page notifications', () => {
    function setupTeamStore(overrides: Partial<ReturnType<typeof useTeamStore.getState>> = {}) {
      useTeamStore.setState({
        members: [
          { id: 'owner-1', email: 'owner@test.com', name: 'Owner', role: 'owner', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'member-1', email: 'member@test.com', name: 'Member', role: 'member', createdAt: '2026-01-02T00:00:00Z' },
        ],
        invitations: [
          {
            id: 'inv-1',
            tenantId: 'tenant-1',
            email: 'pending@test.com',
            role: 'member',
            token: 'token-1',
            status: 'pending',
            invitedBy: 'owner-1',
            expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
            acceptedAt: null,
            createdAt: '2026-02-10T00:00:00Z',
            updatedAt: '2026-02-10T00:00:00Z',
          },
        ],
        isLoading: false,
        error: null,
        fetchMembers: vi.fn().mockResolvedValue(undefined),
        fetchInvitations: vi.fn().mockResolvedValue(undefined),
        createInvitation: vi.fn().mockResolvedValue(undefined),
        cancelInvitation: vi.fn().mockResolvedValue(undefined),
        updateMemberRole: vi.fn().mockResolvedValue(undefined),
        removeMember: vi.fn().mockResolvedValue(undefined),
        clearError: vi.fn(),
        ...overrides,
      });
    }

    it('shows success notification when member is removed', async () => {
      setupTeamStore();
      const user = userEvent.setup();
      render(<MemoryRouter><Team /></MemoryRouter>);

      // Click remove button on member (not owner)
      const removeButtons = screen.getAllByTitle('Remove member');
      await user.click(removeButtons[0]);

      // Confirm in the dialog
      const confirmBtn = screen.getByText('Remove');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'success' && n.title === 'Member removed'
        )).toBe(true);
      });
    });

    it('shows success notification when invitation is cancelled', async () => {
      setupTeamStore();
      const user = userEvent.setup();
      render(<MemoryRouter><Team /></MemoryRouter>);

      // Click cancel on invitation
      const cancelBtn = screen.getByText('Cancel');
      await user.click(cancelBtn);

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'success' && n.title === 'Invitation cancelled'
        )).toBe(true);
      });
    });

    it('shows success notification when invitation is sent', async () => {
      setupTeamStore();
      const user = userEvent.setup();
      render(<MemoryRouter><Team /></MemoryRouter>);

      // Open invite dialog
      await user.click(screen.getByText('Invite Member'));

      // Fill email
      const emailInput = screen.getByLabelText('Email');
      await user.type(emailInput, 'new@test.com');

      // Submit
      const sendBtn = screen.getByText('Send Invitation');
      await user.click(sendBtn);

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'success' && n.title === 'Invitation sent'
        )).toBe(true);
      });
    });

    it('shows error notification when remove fails', async () => {
      setupTeamStore({
        removeMember: vi.fn().mockRejectedValue(new Error('Remove failed')),
      });
      const user = userEvent.setup();
      render(<MemoryRouter><Team /></MemoryRouter>);

      // Click remove
      const removeButtons = screen.getAllByTitle('Remove member');
      await user.click(removeButtons[0]);

      // Confirm
      await user.click(screen.getByText('Remove'));

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'error'
        )).toBe(true);
      });
    });
  });

  describe('Settings page notifications', () => {
    function setupSettingsStore(overrides: Partial<ReturnType<typeof useSettingsStore.getState>> = {}) {
      useSettingsStore.setState({
        settings: {
          aiProvider: { provider: 'claude', apiKey: 'sk-test', model: 'claude-3' },
          userProfile: { name: 'Test', email: 'test@test.com', timezone: 'UTC' },
          notifications: { emailNotifications: true, taskCompletion: true, systemAlerts: true, operationReports: false },
          knowledgeBase: { autoLearning: false, documentSources: [] },
        },
        isLoading: false,
        error: null,
        isSaving: false,
        healthStatus: null,
        isCheckingHealth: false,
        fetchSettings: vi.fn(),
        updateAIProvider: vi.fn().mockResolvedValue(undefined),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        updateNotifications: vi.fn().mockResolvedValue(undefined),
        updateKnowledgeBase: vi.fn().mockResolvedValue(undefined),
        checkProviderHealth: vi.fn(),
        clearError: vi.fn(),
        ...overrides,
      });
    }

    beforeEach(() => {
      useAuthStore.setState({
        user: { id: 'u-1', email: 'test@test.com', name: 'Test' },
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    });

    it('shows success notification when AI provider is saved', async () => {
      setupSettingsStore();
      const user = userEvent.setup();
      render(<Settings />);

      await user.click(screen.getByText('Save AI Provider'));

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'success'
        )).toBe(true);
      });
    });

    it('shows success notification when profile is saved', async () => {
      setupSettingsStore();
      const user = userEvent.setup();
      render(<Settings />);

      await user.click(screen.getByText('Save Profile'));

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'success'
        )).toBe(true);
      });
    });

    it('shows error notification when save fails', async () => {
      setupSettingsStore({
        updateUserProfile: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const user = userEvent.setup();
      render(<Settings />);

      await user.click(screen.getByText('Save Profile'));

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.some(
          n => n.type === 'error'
        )).toBe(true);
      });
    });

    it('no longer renders inline success message (uses toast instead)', async () => {
      setupSettingsStore();
      const user = userEvent.setup();
      render(<Settings />);

      await user.click(screen.getByText('Save Profile'));

      await waitFor(() => {
        expect(useNotificationsStore.getState().notifications.length).toBeGreaterThan(0);
      });

      // Old inline success message should NOT exist
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
