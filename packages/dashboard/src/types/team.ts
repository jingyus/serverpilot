// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

export interface InvitationsResponse {
  invitations: Invitation[];
  total: number;
}

export interface InvitationResponse {
  invitation: Invitation;
}

export interface MembersResponse {
  members: TeamMember[];
  total: number;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
