// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Team } from './Team';
import { useTeamStore } from '@/stores/team';
import type { TeamMember, Invitation } from '@/types/team';

const mockMembers: TeamMember[] = [
  { id: 'owner-1', email: 'owner@test.com', name: 'Owner', role: 'owner', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'admin-1', email: 'admin@test.com', name: 'Admin', role: 'admin', createdAt: '2026-01-02T00:00:00Z' },
  { id: 'member-1', email: 'member@test.com', name: 'Member', role: 'member', createdAt: '2026-01-03T00:00:00Z' },
];

const mockInvitations: Invitation[] = [
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
];

function renderTeam() {
  return render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>,
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useTeamStore.getState>> = {}) {
  useTeamStore.setState({
    members: mockMembers,
    invitations: mockInvitations,
    isLoading: false,
    error: null,
    fetchMembers: vi.fn().mockResolvedValue(undefined),
    fetchInvitations: vi.fn().mockResolvedValue(undefined),
    createInvitation: vi.fn().mockResolvedValue(mockInvitations[0]),
    cancelInvitation: vi.fn().mockResolvedValue(undefined),
    updateMemberRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('Team Page', () => {
  beforeEach(() => {
    setupStore();
  });

  it('should render the page title', () => {
    renderTeam();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('should render member list', () => {
    renderTeam();
    // Names appear alongside role badges, so use getAllByText
    expect(screen.getAllByText('Owner').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1);
    // "Member" appears as name, role badge, and other places
    expect(screen.getAllByText('Member').length).toBeGreaterThanOrEqual(1);
  });

  it('should show role badges', () => {
    renderTeam();
    // Check for role labels in badges
    const ownerBadges = screen.getAllByText('Owner');
    expect(ownerBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('should show pending invitations section', () => {
    renderTeam();
    expect(screen.getByText('pending@test.com')).toBeInTheDocument();
    expect(screen.getByText(/Pending Invitations/)).toBeInTheDocument();
  });

  it('should show loading spinner when loading', () => {
    setupStore({ isLoading: true });
    renderTeam();
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('should show empty state when no members', () => {
    setupStore({ members: [], invitations: [] });
    renderTeam();
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
  });

  it('should show error message', () => {
    setupStore({ error: 'Failed to load team' });
    renderTeam();
    expect(screen.getByText('Failed to load team')).toBeInTheDocument();
  });

  it('should open invite dialog', async () => {
    const user = userEvent.setup();
    renderTeam();

    await user.click(screen.getByText('Invite Member'));
    expect(screen.getByText('Invite Team Member')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('should call fetchMembers and fetchInvitations on mount', () => {
    const fetchMembers = vi.fn().mockResolvedValue(undefined);
    const fetchInvitations = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchMembers, fetchInvitations });
    renderTeam();
    expect(fetchMembers).toHaveBeenCalled();
    expect(fetchInvitations).toHaveBeenCalled();
  });

  it('should dismiss error', async () => {
    const clearError = vi.fn();
    setupStore({ error: 'Something went wrong', clearError });
    const user = userEvent.setup();
    renderTeam();

    await user.click(screen.getByText('Dismiss'));
    expect(clearError).toHaveBeenCalled();
  });
});
